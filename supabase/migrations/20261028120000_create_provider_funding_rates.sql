-- Product decision (user, 28 Oct 2026): price from what a dollar of
-- provider balance really costs us, not the market rate. Topping up 5sim
-- (and Grizzly) goes through intermediaries whose fees put our real cost
-- at ~N1,562 per USD, while fx_rates' daily market USD_NGN sits ~N1,353.
--
-- The pricing engine (lib/pricing/engine.ts) converts USD costs at
--   effective rate = max(latest fx_rates USD_NGN, latest funding rate for
--                        the service's provider)
-- so a funding rate can only raise the conversion, never lower it below
-- market. A provider with no row here just prices at the market rate.
--
-- Versioned like pricing_rules: to change a rate, insert a new row with a
-- later effective_from — never update or delete an old one, so past rates
-- stay auditable. The engine reads the latest row per (provider, pair)
-- whose effective_from is not in the future.
--
-- Reversal: drop table public.provider_funding_rates; (the engine then
-- needs reverting to market-only too, or every pricing read errors).

create table if not exists public.provider_funding_rates (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  pair text not null default 'USD_NGN',
  ngn_per_usd numeric not null check (ngn_per_usd > 0),
  effective_from timestamptz not null default now(),
  note text
);

create index if not exists provider_funding_rates_provider_pair_effective_idx
  on public.provider_funding_rates (provider, pair, effective_from desc);

-- No policies for anon/authenticated, same as fx_rates: cost data is
-- business-sensitive and only ever read through the service-role client.
alter table public.provider_funding_rates enable row level security;

-- Idempotent seed: skips a provider that already has an identical row.
insert into public.provider_funding_rates (provider, pair, ngn_per_usd, note)
select v.provider, 'USD_NGN', 1562, 'real top-up cost incl. fees, 28 Oct 2026'
from (values ('5sim'), ('grizzly')) as v (provider)
where not exists (
  select 1
  from public.provider_funding_rates p
  where p.provider = v.provider
    and p.pair = 'USD_NGN'
    and p.ngn_per_usd = 1562
);
