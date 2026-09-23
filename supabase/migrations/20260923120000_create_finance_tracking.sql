-- Finance & Profit Tracking system (Phase 9 extension). See ARCHITECTURE.md's
-- "orders"/"wallet_transactions" tables for what already exists: revenue
-- (orders.price_kobo) and provider cost (orders.upstream_cost_kobo) are
-- already snapshotted immutably at purchase time, and refunds are already
-- represented as an order status transition + a wallet_transactions credit.
-- The one genuinely missing piece is Payment Processing Fee, which nothing
-- in this codebase tracks today (the Paystack webhook records the full
-- charged amount as the topup, never a fee).
--
-- This migration adds two tables:
--   1. payment_fee_schedules -- admin-configurable fee formula (percent +
--      flat + optional cap), versioned like pricing_rules/fx_rates so a
--      past snapshot stays reproducible even after the rate changes.
--   2. finance_events -- an append-only ledger, same discipline as
--      wallet_transactions (AGENT.md ground rule: never mutate money state
--      directly, always insert a new row). One 'revenue_recognized' row per
--      order at purchase time, one 'refund_issued' row if/when that order
--      is later refunded. Per-order and aggregate profit are always just
--      sums over this table -- a refund "automatically updates the
--      calculations" for free, and nothing already written is ever
--      overwritten.
--
-- Dimensions (service_id, country_code, provider) are denormalized onto
-- finance_events at write time rather than joined from orders/services at
-- read time -- same reasoning ARCHITECTURE.md already gives for
-- orders.country_code being plain text instead of a FK: a later catalog
-- edit (renamed service, deactivated country) must not change how a
-- historical financial event reports.

-- Only one provider (5sim) exists today, per ARCHITECTURE.md -- this column
-- exists so filtering by provider on the new Finance page (and denormalizing
-- provider onto finance_events below) doesn't require a schema change the
-- day a second provider is added.
alter table public.services
  add column if not exists provider text not null default '5sim';

create table public.payment_fee_schedules (
  id uuid primary key default gen_random_uuid(),
  -- 'default' today (only Paystack exists as a funding channel per
  -- SKILL.md) -- a distinct payment_method value can be added later
  -- (e.g. 'paystack_card' vs 'paystack_bank_transfer') without a migration.
  payment_method text not null default 'default',
  -- Basis points (1/100 of a percent), e.g. 150 = 1.5%. Integer to avoid
  -- float rounding, same reasoning as every other money field in this repo.
  percent_bps int not null,
  flat_kobo bigint not null default 0,
  -- Null = uncapped.
  cap_kobo bigint,
  is_default boolean not null default false,
  -- Versioned like fx_rates: a fee-schedule "change" is a new row, never an
  -- UPDATE to an old one, so a fee computed and snapshotted in the past
  -- stays reproducible against the schedule that was actually active then.
  effective_from timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint payment_fee_schedules_percent_bps_check check (percent_bps >= 0 and percent_bps <= 10000),
  constraint payment_fee_schedules_flat_kobo_check check (flat_kobo >= 0),
  constraint payment_fee_schedules_cap_kobo_check check (cap_kobo is null or cap_kobo >= 0)
);

create index payment_fee_schedules_method_effective_idx
  on public.payment_fee_schedules (payment_method, effective_from desc);

comment on table public.payment_fee_schedules is
  'Admin-configurable payment processing fee formula, resolved by lib/finance/fee-schedule.ts. Append-only/versioned: "the active schedule" for a payment_method is the most recent row with is_default = true and effective_from <= now(). Never UPDATE an existing row -- insert a new one so past fee snapshots stay reproducible.';

-- SEED VALUE FLAGGED FOR VERIFICATION: 1.5%, no flat fee, no cap. This is a
-- placeholder based on Paystack's commonly-published Nigeria local-card rate
-- (1.5% for local cards, with a ₦100 fee + ₦2,000 cap structure on larger
-- transactions that this simple percent-only seed deliberately does NOT
-- model) -- NOT verified against a live Paystack dashboard/API response in
-- this session. Per AGENT.md ("don't invent... Paystack API behavior"):
-- confirm your account's actual current rate card in the Paystack dashboard
-- and either edit this row's percent_bps/flat_kobo/cap_kobo directly or add
-- a new default row (see the versioning note above) before trusting the
-- Finance page's fee/net-profit numbers.
insert into public.payment_fee_schedules (payment_method, percent_bps, flat_kobo, cap_kobo, is_default)
values ('default', 150, 0, null, true);

create type public.finance_event_type as enum ('revenue_recognized', 'refund_issued');

create table public.finance_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id),
  user_id uuid not null references public.users (id),
  event_type public.finance_event_type not null,
  service_id uuid not null references public.services (id),
  country_code text not null,
  provider text not null,
  -- Signed, same convention as wallet_transactions.amount_kobo: positive at
  -- recognition, negative on a refund_issued row that reverses it.
  revenue_kobo bigint not null,
  provider_cost_kobo bigint not null,
  payment_fee_kobo bigint not null,
  fee_schedule_id uuid references public.payment_fee_schedules (id),
  created_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

-- Defensive backstop, same role as wallet_transactions.reference's unique
-- constraint: an order can only ever produce one revenue_recognized row (it
-- exists once) and at most one refund_issued row (only one of the three
-- refund code paths -- expiry sweep, manual cancel, admin refund -- can ever
-- win the claim-before-act race on a given order). A duplicate insert here
-- means a bug, not a legitimate second event.
create unique index finance_events_order_event_type_unique
  on public.finance_events (order_id, event_type);

create index finance_events_order_id_idx on public.finance_events (order_id);
create index finance_events_created_at_idx on public.finance_events (created_at desc);
create index finance_events_service_country_idx on public.finance_events (service_id, country_code);

comment on table public.finance_events is
  'Append-only financial ledger, one row per order per event (revenue_recognized at purchase, refund_issued if later refunded). Per-order or aggregate profit is always a sum over this table -- see lib/finance/report.ts. Mirrors wallet_transactions'' append-only discipline; nothing here is ever UPDATEd.';

alter table public.payment_fee_schedules enable row level security;
alter table public.finance_events enable row level security;

-- No policies for anon/authenticated on either table -- business-sensitive
-- financial data, same lockdown as pricing_rules/reporting_epochs. Every
-- read/write goes through the service-role client, gated by requireAdmin()
-- for anything admin-facing and by the order-lifecycle code paths
-- (lib/orders/purchase.ts, expire-and-refund.ts, manual-refund.ts, the
-- manual-cancel route) for writes.

-- ── backfill for orders that already exist ─────────────────────────────
-- Historical orders never had finance_events -- backfill one
-- revenue_recognized row per existing order (using the same immutable
-- price_kobo/upstream_cost_kobo/country_code/status data the Margin page
-- already reports from), and a paired refund_issued row for orders already
-- in a refunded status. payment_fee_kobo is deliberately set to 0 here, NOT
-- computed from the schedule above -- payment fees were never tracked
-- before this migration, so backfilling a fee based on today's schedule
-- would fabricate history rather than record it. metadata marks these rows
-- explicitly so this is never mistaken for a real zero-fee outcome.
insert into public.finance_events (
  order_id, user_id, event_type, service_id, country_code, provider,
  revenue_kobo, provider_cost_kobo, payment_fee_kobo, fee_schedule_id, created_at, metadata
)
select
  o.id,
  o.user_id,
  'revenue_recognized',
  o.service_id,
  o.country_code,
  coalesce(s.provider, '5sim'),
  o.price_kobo,
  o.upstream_cost_kobo,
  0,
  null,
  o.created_at,
  '{"backfilled": true, "note": "payment_fee_kobo not tracked before this migration -- left at 0 rather than estimated retroactively"}'::jsonb
from public.orders o
join public.services s on s.id = o.service_id;

-- Paired reversal for orders already refunded, using the same
-- recovered-vs-lost distinction lib/pricing/margin-report.ts already tracks
-- via upstream_cancel_succeeded: provider cost is only reversed when the
-- upstream cancel actually succeeded (cost recovered from 5sim); otherwise
-- it stays a real, unrecovered loss. payment_fee_kobo has nothing to
-- reverse since the recognized row's fee was backfilled at 0.
insert into public.finance_events (
  order_id, user_id, event_type, service_id, country_code, provider,
  revenue_kobo, provider_cost_kobo, payment_fee_kobo, fee_schedule_id, created_at, metadata
)
select
  o.id,
  o.user_id,
  'refund_issued',
  o.service_id,
  o.country_code,
  coalesce(s.provider, '5sim'),
  -o.price_kobo,
  case when o.upstream_cancel_succeeded = true then -o.upstream_cost_kobo else 0 end,
  0,
  null,
  coalesce(o.completed_at, o.created_at),
  '{"backfilled": true}'::jsonb
from public.orders o
join public.services s on s.id = o.service_id
where o.status in ('expired_refunded', 'cancelled_refunded');
