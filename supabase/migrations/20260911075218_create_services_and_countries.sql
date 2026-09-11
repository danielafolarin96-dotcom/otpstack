-- Phase 3: curated services + countries catalog. See ARCHITECTURE.md's
-- "services" and "countries" tables.
--
-- Naming note: ARCHITECTURE.md writes these as `5sim_product_code` /
-- `5sim_country_code`, but a leading digit needs a quoted identifier in
-- Postgres (workable, but forces bracket-notation everywhere in
-- TypeScript). Following the same fix already applied to
-- 5SIM_API_KEY -> FIVESIM_API_KEY, these are `fivesim_product_code` /
-- `fivesim_country_code` instead.

create table public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  fivesim_product_code text not null unique,
  category text not null,
  icon_key text not null default '',
  is_active boolean not null default true
);

create table public.countries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  fivesim_country_code text not null unique,
  flag_emoji text not null,
  is_active boolean not null default true
);

alter table public.services enable row level security;
alter table public.countries enable row level security;

-- Curated catalog metadata — not sensitive, needs to be readable by
-- unauthenticated landing-page visitors as well as logged-in users, so
-- both anon and authenticated get read access. No client role gets
-- insert/update/delete: catalog curation happens server-side only (admin
-- panel, Phase 5), same pattern as every other table so far.
create policy "anyone can read services"
  on public.services
  for select
  to anon, authenticated
  using (true);

create policy "anyone can read countries"
  on public.countries
  for select
  to anon, authenticated
  using (true);
