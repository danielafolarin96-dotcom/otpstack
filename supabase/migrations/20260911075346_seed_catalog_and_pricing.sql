-- Phase 3: curated launch catalog (~18 services x 13 countries), one
-- fx_rates placeholder row, and pricing_rules demonstrating all four
-- scopes. Idempotent so this migration can be re-run: services/countries/
-- pricing_rules dedupe via ON CONFLICT on their real unique constraints,
-- fx_rates via an existence check (it has no unique constraint by design
-- — see the schema migration).
--
-- Reference only, not verified against 5sim's live catalog (no 5sim
-- client exists until Phase 4) — fivesim_product_code / fivesim_country_code
-- values are best-effort guesses at 5sim's naming and must be confirmed
-- against a real account before Phase 4 wires purchases against them.
-- Fixed ids below are just for readability/cross-referencing within this
-- seed file, not a meaningful convention beyond that.

insert into public.services (id, name, fivesim_product_code, category, icon_key) values
  ('00000000-0000-0000-0000-000000000001', 'WhatsApp',   'whatsapp',   'Messaging',    'whatsapp'),
  ('00000000-0000-0000-0000-000000000002', 'Telegram',   'telegram',   'Messaging',    'telegram'),
  ('00000000-0000-0000-0000-000000000003', 'Google',     'google',     'Productivity', 'google'),
  ('00000000-0000-0000-0000-000000000004', 'Facebook',   'facebook',   'Social',       'facebook'),
  ('00000000-0000-0000-0000-000000000005', 'Instagram',  'instagram',  'Social',       'instagram'),
  ('00000000-0000-0000-0000-000000000006', 'TikTok',     'tiktok',     'Social',       'tiktok'),
  ('00000000-0000-0000-0000-000000000007', 'Twitter',    'twitter',    'Social',       'twitter'),
  ('00000000-0000-0000-0000-000000000008', 'Discord',    'discord',    'Messaging',    'discord'),
  ('00000000-0000-0000-0000-000000000009', 'Amazon',     'amazon',     'Shopping',     'amazon'),
  ('00000000-0000-0000-0000-000000000010', 'Microsoft',  'microsoft',  'Productivity', 'microsoft'),
  ('00000000-0000-0000-0000-000000000011', 'Apple',      'apple',      'Productivity', 'apple'),
  ('00000000-0000-0000-0000-000000000012', 'Uber',       'uber',       'Travel',       'uber'),
  ('00000000-0000-0000-0000-000000000013', 'Airbnb',     'airbnb',     'Travel',       'airbnb'),
  ('00000000-0000-0000-0000-000000000014', 'PayPal',     'paypal',     'Finance',      'paypal'),
  ('00000000-0000-0000-0000-000000000015', 'Netflix',    'netflix',    'Entertainment','netflix'),
  ('00000000-0000-0000-0000-000000000016', 'Spotify',    'spotify',    'Entertainment','spotify'),
  ('00000000-0000-0000-0000-000000000017', 'Tinder',     'tinder',     'Dating',       'tinder'),
  ('00000000-0000-0000-0000-000000000018', 'LinkedIn',   'linkedin',   'Productivity', 'linkedin')
on conflict (fivesim_product_code) do nothing;

insert into public.countries (id, name, fivesim_country_code, flag_emoji) values
  ('00000000-0000-0000-0000-000000000101', 'Nigeria',        'nigeria',      '🇳🇬'),
  ('00000000-0000-0000-0000-000000000102', 'United States',  'usa',          '🇺🇸'),
  ('00000000-0000-0000-0000-000000000103', 'United Kingdom', 'england',      '🇬🇧'),
  ('00000000-0000-0000-0000-000000000104', 'Ghana',          'ghana',        '🇬🇭'),
  ('00000000-0000-0000-0000-000000000105', 'Kenya',          'kenya',        '🇰🇪'),
  ('00000000-0000-0000-0000-000000000106', 'South Africa',   'southafrica',  '🇿🇦'),
  ('00000000-0000-0000-0000-000000000107', 'Egypt',          'egypt',        '🇪🇬'),
  ('00000000-0000-0000-0000-000000000108', 'India',          'india',        '🇮🇳'),
  ('00000000-0000-0000-0000-000000000109', 'Indonesia',      'indonesia',    '🇮🇩'),
  ('00000000-0000-0000-0000-000000000110', 'Philippines',    'philippines',  '🇵🇭'),
  ('00000000-0000-0000-0000-000000000111', 'Russia',         'russia',       '🇷🇺'),
  ('00000000-0000-0000-0000-000000000112', 'Ukraine',        'ukraine',      '🇺🇦'),
  ('00000000-0000-0000-0000-000000000113', 'Poland',         'poland',       '🇵🇱')
on conflict (fivesim_country_code) do nothing;

-- Placeholder fx rate — no live refresh job exists until Phase 4's 5sim
-- integration (or a dedicated fx cron). Pricing engine always reads the
-- latest row for a pair, so replacing this is just inserting a newer row.
-- fx_rates has no unique constraint (multiple snapshots per pair over
-- time are the intended design), so idempotency here is a plain existence
-- check rather than ON CONFLICT.
insert into public.fx_rates (pair, rate, source)
select 'USD_NGN', 1600, 'placeholder-seed'
where not exists (select 1 from public.fx_rates where pair = 'USD_NGN');

-- Pricing rules across all four scopes, chosen so some cases are decided
-- by the markup formula and some by the 60% margin floor — see
-- lib/pricing/calculate.test.ts for the exact math on each.
insert into public.pricing_rules (scope, service_id, country_id, markup_type, markup_value, min_margin_pct, priority) values
  -- Global fallback: tiered by upstream cost, decreasing markup as cost
  -- rises. Top tier (140%) undershoots the 60% floor on purpose.
  ('global', null, null, 'tiered',
   '[{"max_cost_kobo": 50000, "markup_pct": 200}, {"max_cost_kobo": 150000, "markup_pct": 160}, {"max_cost_kobo": 500000, "markup_pct": 140}]'::jsonb,
   60, 10),
  -- Country override: Nigeria gets a flat-kobo markup instead of percent.
  ('country', null, '00000000-0000-0000-0000-000000000101', 'flat_kobo', '200000'::jsonb, 60, 20),
  -- Service override: WhatsApp gets a flat percent everywhere.
  ('service', '00000000-0000-0000-0000-000000000001', null, 'percent', '180'::jsonb, 60, 30),
  -- Most specific: WhatsApp in Nigeria beats both the service and country
  -- rules above.
  ('service_country', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000101', 'percent', '250'::jsonb, 60, 40)
on conflict (scope, coalesce(service_id, '00000000-0000-0000-0000-000000000000'), coalesce(country_id, '00000000-0000-0000-0000-000000000000'))
do nothing;
