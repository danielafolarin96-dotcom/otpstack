-- Phase 4: orders (a rented number). See ARCHITECTURE.md's "orders" table
-- and "Order lifecycle" section.
--
-- Naming note: same fix as FIVESIM_API_KEY / fivesim_product_code —
-- ARCHITECTURE.md writes `5sim_order_id`, renamed to `fivesim_order_id`
-- since a leading digit forces quoted Postgres identifiers.
--
-- country_code is deliberately plain text, not a FK to countries — matches
-- ARCHITECTURE.md exactly (unlike orders.service_id, which is a real FK).
-- Keeps the order's country stable even if the countries row is later
-- deactivated or edited.

create type public.order_status as enum (
  'pending',
  'sms_received',
  'expired_refunded',
  'cancelled_refunded',
  'banned'
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  service_id uuid not null references public.services (id),
  country_code text not null,
  fivesim_order_id text not null unique,
  phone_number text not null,
  status public.order_status not null default 'pending',
  price_kobo bigint not null,
  upstream_cost_kobo bigint not null,
  otp_code text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index orders_user_id_created_at_idx on public.orders (user_id, created_at desc);

-- Matches the cron's exact query (status = 'pending' and expires_at in the
-- past) and the status-check route's fallback expiry check.
create index orders_pending_expiry_idx on public.orders (expires_at) where status = 'pending';

alter table public.orders enable row level security;

create policy "users can read their own orders"
  on public.orders
  for select
  to authenticated
  using (user_id = auth.uid());

-- No insert/update/delete policy for authenticated or anon — every write
-- (purchase, status-poll updates, expiry, cancel) happens server-side
-- through the service-role client (lib/orders/purchase.ts,
-- lib/orders/expire-and-refund.ts), same lockdown pattern as
-- wallet_transactions and pricing_rules.

-- wallet_transactions.order_id was left without a FK in the Phase 2
-- migration because orders didn't exist yet — add it now that it does.
alter table public.wallet_transactions
  add constraint wallet_transactions_order_id_fkey
  foreign key (order_id) references public.orders (id);

-- ── negative-balance guard ───────────────────────────────────────────────
-- Two concurrent purchase requests could both pass an application-level
-- "balance >= price" check before either debit lands (a genuine race, not
-- covered by Phase 6's abuse-prevention rate limits — this is basic
-- correctness). Since every balance change is required to go through this
-- trigger, enforcing the invariant here — not in application code — makes
-- it impossible to bypass: whichever debit would take the balance negative
-- fails the whole transaction, ledger insert included.
create or replace function public.sync_wallet_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance bigint;
begin
  update public.wallets
  set balance_kobo = balance_kobo + new.amount_kobo,
      updated_at = now()
  where user_id = new.user_id
  returning balance_kobo into new_balance;

  if not found then
    raise exception 'sync_wallet_balance: no wallet row for user_id %', new.user_id;
  end if;

  if new_balance < 0 then
    raise exception 'sync_wallet_balance: balance would go negative for user_id % (attempted %)', new.user_id, new.amount_kobo;
  end if;

  return new;
end;
$$;
