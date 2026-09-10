-- Phase 2: wallet_transactions ledger (append-only, source of truth for
-- wallets.balance_kobo) + the trigger that keeps balance_kobo in sync.
-- See ARCHITECTURE.md "wallet_transactions" and SECURITY.md "Wallet integrity".

create type public.wallet_transaction_type as enum (
  'topup',
  'purchase',
  'refund',
  'admin_adjustment'
);

create table public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  type public.wallet_transaction_type not null,
  amount_kobo bigint not null,
  reference text not null unique,
  -- orders doesn't exist until Phase 4 — plain uuid for now. The FK to
  -- orders.id gets added alongside that migration.
  order_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index wallet_transactions_user_id_created_at_idx
  on public.wallet_transactions (user_id, created_at desc);

alter table public.wallet_transactions enable row level security;

create policy "users can read their own transactions"
  on public.wallet_transactions
  for select
  to authenticated
  using (user_id = auth.uid());

-- No insert/update/delete policy for authenticated or anon: every ledger
-- write happens server-side through the service-role client
-- (lib/supabase/admin.ts + lib/wallet/ledger.ts), which bypasses RLS.
-- Direct client writes are denied outright — same pattern as wallets in
-- the Phase 1 migration.

-- ── balance derivation ──────────────────────────────────────────────────
-- wallet_transactions is append-only and the source of truth; balance_kobo
-- is a running total kept in sync here so reads stay O(1) instead of
-- summing the ledger on every read. SECURITY DEFINER so this works
-- regardless of which role performs the triggering insert.
create function public.sync_wallet_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.wallets
  set balance_kobo = balance_kobo + new.amount_kobo,
      updated_at = now()
  where user_id = new.user_id;

  if not found then
    -- Every user gets a wallet row at signup (Phase 1's handle_new_user
    -- trigger) — a missing wallet here means something is badly wrong.
    -- Fail loudly and roll back the ledger insert rather than silently
    -- losing money.
    raise exception 'sync_wallet_balance: no wallet row for user_id %', new.user_id;
  end if;

  return new;
end;
$$;

create trigger on_wallet_transaction_created
  after insert on public.wallet_transactions
  for each row execute function public.sync_wallet_balance();
