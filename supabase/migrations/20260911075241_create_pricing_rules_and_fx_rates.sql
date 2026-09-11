-- Phase 3: pricing_rules (the markup engine's config) + fx_rates.
-- See ARCHITECTURE.md's "pricing_rules"/"fx_rates" tables and "Pricing
-- engine" section, and CLAUDE.md's 60% target margin.

create type public.pricing_rule_scope as enum (
  'global',
  'service',
  'country',
  'service_country'
);

create type public.pricing_markup_type as enum (
  'percent',
  'flat_kobo',
  'tiered'
);

create table public.pricing_rules (
  id uuid primary key default gen_random_uuid(),
  scope public.pricing_rule_scope not null,
  service_id uuid references public.services (id) on delete cascade,
  country_id uuid references public.countries (id) on delete cascade,
  markup_type public.pricing_markup_type not null,
  -- Percent: a plain number, e.g. 65 meaning 65%.
  -- Flat_kobo: a plain integer, the flat markup in kobo.
  -- Tiered: an array of {"max_cost_kobo": .., "markup_pct": ..}, ascending
  -- by max_cost_kobo — see lib/pricing/calculate.ts for how it's applied.
  markup_value jsonb not null,
  min_margin_pct numeric not null default 60,
  -- Resolution order per ARCHITECTURE.md: service_country > service >
  -- country > global. Fixed convention (also enforced by the admin editor,
  -- which derives this from scope rather than taking free-form input):
  -- global=10, country=20, service=30, service_country=40.
  priority int not null,
  updated_at timestamptz not null default now(),
  constraint pricing_rules_scope_columns_check check (
    (scope = 'global' and service_id is null and country_id is null)
    or (scope = 'service' and service_id is not null and country_id is null)
    or (scope = 'country' and service_id is null and country_id is not null)
    or (scope = 'service_country' and service_id is not null and country_id is not null)
  )
);

-- At most one rule per (scope, service, country) combination. A plain
-- UNIQUE constraint wouldn't catch duplicate global/service/country rows
-- since NULL never equals NULL — coalescing to a sentinel UUID makes
-- "no service" / "no country" a comparable value instead.
create unique index pricing_rules_unique_scope_target
  on public.pricing_rules (
    scope,
    coalesce(service_id, '00000000-0000-0000-0000-000000000000'),
    coalesce(country_id, '00000000-0000-0000-0000-000000000000')
  );

create table public.fx_rates (
  id uuid primary key default gen_random_uuid(),
  pair text not null,
  rate numeric not null,
  source text not null,
  fetched_at timestamptz not null default now()
);

create index fx_rates_pair_fetched_at_idx on public.fx_rates (pair, fetched_at desc);

alter table public.pricing_rules enable row level security;
alter table public.fx_rates enable row level security;

-- No policies for anon/authenticated on either table — margin/markup
-- config and fx data are business-sensitive, not user data. The pricing
-- engine (lib/pricing/engine.ts) and the admin pricing editor both read
-- and write these exclusively through the service-role client
-- (lib/supabase/admin.ts), with is_admin re-checked inside every admin
-- server action per SECURITY.md.
