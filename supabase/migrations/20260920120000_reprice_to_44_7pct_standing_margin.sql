-- Product decision: reprice the default pricing cascade (global fallback,
-- Nigeria country override, WhatsApp service override, and the
-- WhatsApp+Nigeria service_country override) to a standing ~44.7% realized
-- margin, agreed with the user — see scripts/apply-margin-reprice.mjs,
-- committed alongside this migration, which is what was actually run
-- against production to make this change live.
--
-- 80.83% markup -> 80.83 / (100 + 80.83) * 100 = 44.70% margin. This does
-- NOT touch min_margin_pct (still 30, per
-- 20260912090000_lower_min_margin_floor_to_30.sql) — 44.7% is a markup
-- target the formula now aims for, well above the 30% floor it can still
-- fall back to; it is not a floor change itself.
--
-- Deliberately excluded, untouched by this migration or the script:
-- WhatsApp/USA and WhatsApp/Australia (both flat_kobo service_country
-- overrides, added after the original seed via the admin pricing UI, not
-- present in any migration) — those stay governed by their own flat_kobo
-- value and the 30% floor. TikTok/UK's flat_kobo override is also
-- untouched here on purpose: it's recomputed from a live 5sim cost lookup
-- each time the script runs, so a static migration value would go stale
-- immediately — re-run the script to refresh it, don't hardcode it here.
--
-- Backfill only: this codifies a config change that was already applied
-- directly against the live database (out-of-band, never previously
-- captured in a migration) — the update predates this file. Written
-- against the fixed catalog ids from the original seed
-- (20260911075346_seed_catalog_and_pricing.sql), not pricing_rules.id,
-- since those row ids are gen_random_uuid() and differ per environment.
--
-- Idempotent: only updates rows whose markup doesn't already match, safe
-- to re-run, and reversible (re-run with the original values below to
-- restore the pre-reprice formulas).
--   global:                    tiered  [200, 160, 140]  -> 80.83 flat across all tiers
--   country / Nigeria:         flat_kobo 200000          -> percent 80.83
--   service / WhatsApp:        percent 180               -> percent 80.83
--   service_country / WhatsApp+Nigeria: percent 250       -> percent 80.83

update public.pricing_rules
set markup_type = 'tiered',
    markup_value = '[
      {"max_cost_kobo": 50000, "markup_pct": 80.83},
      {"max_cost_kobo": 150000, "markup_pct": 80.83},
      {"max_cost_kobo": 500000, "markup_pct": 80.83}
    ]'::jsonb,
    updated_at = now()
where scope = 'global'
  and service_id is null
  and country_id is null
  and markup_value is distinct from '[
      {"max_cost_kobo": 50000, "markup_pct": 80.83},
      {"max_cost_kobo": 150000, "markup_pct": 80.83},
      {"max_cost_kobo": 500000, "markup_pct": 80.83}
    ]'::jsonb;

update public.pricing_rules
set markup_type = 'percent',
    markup_value = '80.83'::jsonb,
    updated_at = now()
where scope = 'country'
  and service_id is null
  and country_id = '00000000-0000-0000-0000-000000000101' -- Nigeria
  and (markup_type is distinct from 'percent' or markup_value is distinct from '80.83'::jsonb);

update public.pricing_rules
set markup_type = 'percent',
    markup_value = '80.83'::jsonb,
    updated_at = now()
where scope = 'service'
  and service_id = '00000000-0000-0000-0000-000000000001' -- WhatsApp
  and country_id is null
  and (markup_type is distinct from 'percent' or markup_value is distinct from '80.83'::jsonb);

update public.pricing_rules
set markup_type = 'percent',
    markup_value = '80.83'::jsonb,
    updated_at = now()
where scope = 'service_country'
  and service_id = '00000000-0000-0000-0000-000000000001' -- WhatsApp
  and country_id = '00000000-0000-0000-0000-000000000101' -- Nigeria
  and (markup_type is distinct from 'percent' or markup_value is distinct from '80.83'::jsonb);
