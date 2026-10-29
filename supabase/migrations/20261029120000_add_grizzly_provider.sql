-- Grizzly SMS as a second number provider next to 5sim (product decision,
-- 29 Oct 2026 — see ARCHITECTURE.md's "Providers & routing" and "Grizzly
-- integration" sections for the full flow).
--
-- Written to be applied BEFORE the code that uses it is deployed: every
-- change below is additive or backwards-compatible with the code that is
-- live today. In particular create_order_and_debit_wallet keeps every
-- existing parameter (new ones all default), and still fills orders'
-- new provider/provider_order_id columns correctly when the old code calls
-- it, so the window between "migration applied" and "new code live" is safe.
--
-- Contents:
--   1. orders: provider, provider_order_id (generic upstream id), Grizzly
--      supplier + quoted/charged USD + activation time; fivesim_order_id
--      becomes nullable (5sim-only from now on).
--   2. services.grizzly_service_code / countries.grizzly_country_id —
--      the explicit, reviewed mapping (29 Oct 2026). Null = not mapped,
--      which routes to 5sim.
--   3. provider_routes — which provider sells a service, optionally per
--      country, seeded with the Big 6 -> Grizzly plus 41 per-country
--      overrides back to 5sim.
--   4. upstream_cancel_queue — Grizzly cancels that can't run yet
--      (Grizzly locks cancel for ~5 minutes after purchase).
--   5. purchase_failures.provider.
--   6. finance_event_type 'provider_cost_recovered'.
--   7. create_order_and_debit_wallet: records provider + Grizzly fields.
--
-- Reversal (in order): restore the previous create_order_and_debit_wallet
-- from 20260923121000; drop table upstream_cancel_queue, provider_routes;
-- alter table purchase_failures drop column provider; alter table services
-- drop column grizzly_service_code; alter table countries drop column
-- grizzly_country_id; on orders drop the six new columns and set
-- fivesim_order_id not null again (only possible while no Grizzly order
-- exists). The enum value can't be dropped in Postgres; it is harmless
-- unused.

-- ── 1. orders ───────────────────────────────────────────────────────────
alter table public.orders
  add column if not exists provider text not null default '5sim',
  add column if not exists provider_order_id text,
  add column if not exists provider_supplier_id text,
  add column if not exists upstream_quoted_usd numeric,
  add column if not exists upstream_charged_usd numeric,
  add column if not exists upstream_activation_time text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_provider_check') then
    alter table public.orders
      add constraint orders_provider_check check (provider in ('5sim', 'grizzly'));
  end if;
end $$;

-- Every existing order is a 5sim order.
update public.orders
set provider_order_id = fivesim_order_id
where provider_order_id is null;

alter table public.orders alter column provider_order_id set not null;
-- 5sim and Grizzly ids are independent number spaces and could collide, so
-- uniqueness is per provider. The old fivesim_order_id unique constraint
-- stays (it only ever holds 5sim ids now).
create unique index if not exists orders_provider_order_id_unique
  on public.orders (provider, provider_order_id);
alter table public.orders alter column fivesim_order_id drop not null;

comment on column public.orders.provider is
  'Which upstream sold this number: 5sim or grizzly. Resolved from provider_routes at purchase time (lib/providers/route.ts).';
comment on column public.orders.provider_order_id is
  'The upstream order id for orders.provider (5sim order id, or Grizzly activationId). Use this, not fivesim_order_id, for any upstream call.';
comment on column public.orders.fivesim_order_id is
  'Legacy 5sim-only copy of provider_order_id. Null for Grizzly orders.';
comment on column public.orders.provider_supplier_id is
  'Grizzly only: the supplier ("provider" in Grizzly''s API, e.g. 438) the number was bought from via providerIds, so our own delivery rate per supplier can be measured. Null for 5sim (see fivesim_operator).';
comment on column public.orders.upstream_quoted_usd is
  'Grizzly only: the supplier cost we quoted and sent as maxPrice (its highest listed price step).';
comment on column public.orders.upstream_charged_usd is
  'Grizzly only: activationCost from getNumberV2 — what Grizzly actually held/charged. upstream_cost_kobo is this converted at the funding rate.';
comment on column public.orders.upstream_activation_time is
  'Grizzly only: activationTime from getNumberV2, as Grizzly sent it (no timezone). SMS punctuality is judged relative to this, on Grizzly''s own clock.';

-- ── 2. explicit Grizzly mapping (reviewed and approved 29 Oct 2026) ─────
alter table public.services add column if not exists grizzly_service_code text;
alter table public.countries add column if not exists grizzly_country_id integer;
create unique index if not exists countries_grizzly_country_id_unique
  on public.countries (grizzly_country_id)
  where grizzly_country_id is not null;

comment on column public.services.grizzly_service_code is
  'Grizzly service code (getServicesList), e.g. wa. Null = this service is never bought from Grizzly.';
comment on column public.countries.grizzly_country_id is
  'Grizzly country id (getCountries), e.g. 187. Null = not mapped, so every service in this country stays on 5sim. USA is 187 ("USA") only; Grizzly''s 12 ("USA (2)", virtual) is deliberately unmapped.';

update public.services s
set grizzly_service_code = v.code
from (values
    ('whatsapp', 'wa'), ('telegram', 'tg'), ('tiktok', 'lf'),
    ('facebook', 'fb'), ('instagram', 'ig'), ('google', 'go')
  ) as v (product, code)
where s.fivesim_product_code = v.product
  and s.grizzly_service_code is distinct from v.code;

-- Congo (ambiguous: Grizzly has both 18 "DR Congo" and 150 "Republic of
-- the Congo") and Namibia (not listed by Grizzly) are deliberately absent.
update public.countries c
set grizzly_country_id = v.grizzly_id
from (values
    ('afghanistan', 74), ('algeria', 58), ('argentina', 39), ('armenia', 148),
    ('australia', 175), ('austria', 50), ('bangladesh', 60), ('barbados', 118),
    ('bolivia', 92), ('botswana', 123), ('brazil', 73), ('burkinafaso', 152),
    ('cambodia', 24), ('cameroon', 41), ('capeverde', 186), ('colombia', 33),
    ('costarica', 93), ('czech', 63), ('ecuador', 105), ('egypt', 21),
    ('equatorialguinea', 167), ('ethiopia', 71), ('france', 78), ('gambia', 28),
    ('georgia', 128), ('germany', 43), ('ghana', 38), ('greece', 129),
    ('guatemala', 94), ('guinea', 68), ('guyana', 131), ('honduras', 88),
    ('hongkong', 14), ('india', 22), ('indonesia', 6), ('israel', 13),
    ('italy', 86), ('jamaica', 103), ('jordan', 116), ('kazakhstan', 2),
    ('kenya', 8), ('kuwait', 100), ('liberia', 135), ('malawi', 137),
    ('malaysia', 7), ('maldives', 159), ('mauritania', 114), ('mauritius', 157),
    ('mexico', 54), ('moldova', 85), ('mongolia', 72), ('morocco', 37),
    ('mozambique', 80), ('nepal', 81), ('netherlands', 48), ('nicaragua', 90),
    ('nigeria', 19), ('pakistan', 66), ('panama', 112), ('philippines', 4),
    ('poland', 15), ('portugal', 117), ('senegal', 61), ('serbia', 29),
    ('slovenia', 59), ('southafrica', 31), ('spain', 56), ('srilanka', 64),
    ('suriname', 142), ('swaziland', 106), ('sweden', 46), ('thailand', 52),
    ('togo', 99), ('tunisia', 89), ('england', 16), ('usa', 187),
    ('venezuela', 70), ('vietnam', 10)
  ) as v (code, grizzly_id)
where c.fivesim_country_code = v.code
  and c.grizzly_country_id is distinct from v.grizzly_id;

-- ── 3. provider_routes ──────────────────────────────────────────────────
-- Resolution (lib/providers/route.ts): an active (service, country) row,
-- else an active (service, any-country) row, else services.provider. A
-- route to grizzly still falls back to 5sim when the service has no
-- grizzly_service_code or the country no grizzly_country_id. There is no
-- automatic stock-based fallback: a Grizzly-routed product with no Grizzly
-- stock shows as unavailable. Set is_active = false on the six
-- (service, any-country) rows to send everything back to 5sim without a
-- deploy.
create table if not exists public.provider_routes (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.services (id) on delete cascade,
  -- null = every country (that has a mapping for this provider)
  country_id uuid references public.countries (id) on delete cascade,
  provider text not null check (provider in ('5sim', 'grizzly')),
  is_active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  constraint provider_routes_service_country_key unique nulls not distinct (service_id, country_id)
);

alter table public.provider_routes enable row level security;
-- No policies: read only through the service-role client, same as pricing_rules.

insert into public.provider_routes (service_id, country_id, provider, note)
select s.id, null, 'grizzly', 'Big 6 -> Grizzly wherever the country is mapped (29 Oct 2026)'
from public.services s
where s.fivesim_product_code in ('whatsapp', 'telegram', 'tiktok', 'facebook', 'instagram', 'google')
on conflict on constraint provider_routes_service_country_key do nothing;

-- The 41 (service, country) pairs where 5sim had sellable stock and
-- Grizzly had none, from the 29 Oct 2026 live snapshot reviewed before
-- this migration. Static overrides, not a fallback — revisit as stock moves.
insert into public.provider_routes (service_id, country_id, provider, note)
select s.id, c.id, '5sim', '5sim had stock, Grizzly didn''t — snapshot 29 Oct 2026'
from (values
    ('afghanistan', 'telegram'), ('armenia', 'whatsapp'),
    ('austria', 'tiktok'), ('austria', 'facebook'),
    ('barbados', 'whatsapp'), ('barbados', 'tiktok'), ('barbados', 'instagram'), ('barbados', 'google'),
    ('bolivia', 'tiktok'),
    ('botswana', 'whatsapp'), ('botswana', 'tiktok'),
    ('brazil', 'tiktok'),
    ('burkinafaso', 'tiktok'), ('burkinafaso', 'google'),
    ('cambodia', 'tiktok'), ('cambodia', 'google'),
    ('capeverde', 'whatsapp'), ('capeverde', 'telegram'), ('capeverde', 'tiktok'),
    ('capeverde', 'instagram'), ('capeverde', 'google'),
    ('costarica', 'whatsapp'), ('costarica', 'tiktok'), ('costarica', 'facebook'),
    ('costarica', 'instagram'), ('costarica', 'google'),
    ('egypt', 'google'),
    ('ethiopia', 'telegram'),
    ('georgia', 'instagram'),
    ('guinea', 'telegram'), ('guinea', 'tiktok'), ('guinea', 'google'),
    ('hongkong', 'facebook'),
    ('jamaica', 'whatsapp'), ('jamaica', 'google'),
    ('kenya', 'instagram'),
    ('maldives', 'whatsapp'), ('maldives', 'telegram'), ('maldives', 'tiktok'),
    ('maldives', 'instagram'), ('maldives', 'google')
  ) as v (country_code, product)
join public.countries c on c.fivesim_country_code = v.country_code
join public.services s on s.fivesim_product_code = v.product
on conflict on constraint provider_routes_service_country_key do nothing;

-- ── 4. upstream_cancel_queue ────────────────────────────────────────────
-- Grizzly refuses setStatus=8 (cancel) for ~5 minutes after purchase. Any
-- cancel we need before then — a purchase we abandon (price above quote,
-- failed order write) or an expiry cancel that still hits the lock — is
-- queued here and retried by /api/cron/expire-orders (QStash-triggered,
-- plus the existing sweeps) until it succeeds or the activation is
-- otherwise closed. Grizzly only charges when an SMS arrives, so the point
-- is to close the number before a late SMS can bill us.
create table if not exists public.upstream_cancel_queue (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('5sim', 'grizzly')),
  provider_order_id text not null,
  -- null for an abandoned purchase that never became an order
  order_id uuid references public.orders (id) on delete set null,
  reason text not null check (reason in ('price_above_quote', 'order_record_failed', 'cancel_locked')),
  not_before timestamptz not null,
  give_up_at timestamptz not null,
  attempts integer not null default 0,
  last_error text check (char_length(last_error) <= 500),
  resolved_at timestamptz,
  outcome text check (outcome in ('cancelled', 'already_closed', 'sms_arrived', 'gave_up')),
  created_at timestamptz not null default now(),
  constraint upstream_cancel_queue_provider_order_key unique (provider, provider_order_id)
);

create index if not exists upstream_cancel_queue_due_idx
  on public.upstream_cancel_queue (not_before)
  where resolved_at is null;

alter table public.upstream_cancel_queue enable row level security;
-- No policies: service-role only, same lockdown as rate_limits/purchase_failures.

-- ── 5. purchase_failures.provider ───────────────────────────────────────
-- Null when the attempt failed before a provider was resolved (frozen
-- account, concurrency cap, unknown service...). Every earlier row was 5sim.
alter table public.purchase_failures add column if not exists provider text;
update public.purchase_failures set provider = '5sim' where provider is null;

-- ── 6. finance event for a cost recovered after the refund was booked ───
-- An expiry refund whose Grizzly cancel hit the lock is booked as cost
-- lost (refund_issued with provider_cost_kobo = 0). If the queued retry
-- later closes the activation with no SMS, the cost was not lost after
-- all: a separate append-only row reverses it, since refund_issued is
-- unique per order and never updated.
alter type public.finance_event_type add value if not exists 'provider_cost_recovered';

-- ── 7. create_order_and_debit_wallet ────────────────────────────────────
-- Same drop-then-create as 20260923121000 (appending params otherwise
-- registers a second overload). p_fivesim_order_id keeps its name and
-- position so the currently deployed code keeps working, but is now the
-- upstream order id for whichever p_provider sold the number: it always
-- fills provider_order_id, and fivesim_order_id only for 5sim.
drop function if exists public.create_order_and_debit_wallet(
  uuid, uuid, text, text, text, bigint, bigint, timestamptz, jsonb, text, real, bigint, uuid, text
);

create or replace function public.create_order_and_debit_wallet(
  p_user_id uuid,
  p_service_id uuid,
  p_country_code text,
  p_fivesim_order_id text,
  p_phone_number text,
  p_price_kobo bigint,
  p_upstream_cost_kobo bigint,
  p_expires_at timestamptz,
  p_metadata jsonb default '{}'::jsonb,
  p_fivesim_operator text default null,
  p_fivesim_operator_rate real default null,
  p_payment_fee_kobo bigint default 0,
  p_fee_schedule_id uuid default null,
  p_provider text default '5sim',
  p_provider_supplier_id text default null,
  p_upstream_quoted_usd numeric default null,
  p_upstream_charged_usd numeric default null,
  p_upstream_activation_time text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  insert into public.orders (
    user_id, service_id, country_code, provider, provider_order_id, fivesim_order_id,
    phone_number, status, price_kobo, upstream_cost_kobo, expires_at,
    fivesim_operator, fivesim_operator_rate,
    provider_supplier_id, upstream_quoted_usd, upstream_charged_usd, upstream_activation_time
  ) values (
    p_user_id, p_service_id, p_country_code, p_provider, p_fivesim_order_id,
    case when p_provider = '5sim' then p_fivesim_order_id else null end,
    p_phone_number, 'pending', p_price_kobo, p_upstream_cost_kobo, p_expires_at,
    p_fivesim_operator, p_fivesim_operator_rate,
    p_provider_supplier_id, p_upstream_quoted_usd, p_upstream_charged_usd, p_upstream_activation_time
  )
  returning * into v_order;

  -- Fires the sync_wallet_balance trigger, which raises (rolling back this
  -- entire function, order insert included) if the debit would take the
  -- wallet negative.
  insert into public.wallet_transactions (
    user_id, type, amount_kobo, reference, order_id, metadata
  ) values (
    p_user_id, 'purchase', -p_price_kobo, 'purchase_' || v_order.id, v_order.id, p_metadata
  );

  insert into public.finance_events (
    order_id, user_id, event_type, service_id, country_code, provider,
    revenue_kobo, provider_cost_kobo, payment_fee_kobo, fee_schedule_id
  ) values (
    v_order.id, p_user_id, 'revenue_recognized', p_service_id, p_country_code, p_provider,
    p_price_kobo, p_upstream_cost_kobo, p_payment_fee_kobo, p_fee_schedule_id
  );

  return v_order;
end;
$$;

revoke all on function public.create_order_and_debit_wallet from public;
grant execute on function public.create_order_and_debit_wallet to service_role;
