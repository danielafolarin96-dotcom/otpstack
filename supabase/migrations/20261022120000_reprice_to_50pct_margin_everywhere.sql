-- Product decision (user, 22 Oct 2026): "50% margin for all services,
-- everything". Every pricing rule now uses a 100% markup on the 5sim cost:
-- 100 / (100 + 100) * 100 = 50% margin (price = 2 x cost).
--
-- Replaces the 80.83% markup (44.7% margin) set in
-- 20260920120000_reprice_to_44_7pct_standing_margin.sql, and converts the
-- four flat_kobo service_country overrides (WhatsApp/USA, WhatsApp/Australia,
-- Telegram/UK, TikTok/UK) to the same percent markup so nothing sells below
-- 50% any more. Those flat add-ons had been letting the margin fall to the
-- 30-40% floor whenever 5sim's cost rose.
--
-- min_margin_pct is NOT changed (30 everywhere, 40 on Telegram/UK). With
-- every rule at a 100% markup the floor never binds; it stays as a safety
-- net only.
--
-- Previous values, for reversal:
--   global: tiered 80.83 on all three tiers
--   country/Nigeria, service/WhatsApp, service_country/WhatsApp+Nigeria: percent 80.83
--   service_country WhatsApp/USA flat_kobo 109443, WhatsApp/Australia
--   flat_kobo 263064, Telegram/UK flat_kobo 190000, TikTok/UK flat_kobo 1382
--
-- Idempotent: each update only touches rows that don't already match.

update public.pricing_rules
set markup_type = 'tiered',
    markup_value = '[
      {"max_cost_kobo": 50000, "markup_pct": 100},
      {"max_cost_kobo": 150000, "markup_pct": 100},
      {"max_cost_kobo": 500000, "markup_pct": 100}
    ]'::jsonb,
    updated_at = now()
where scope = 'global'
  and service_id is null
  and country_id is null
  and markup_value is distinct from '[
      {"max_cost_kobo": 50000, "markup_pct": 100},
      {"max_cost_kobo": 150000, "markup_pct": 100},
      {"max_cost_kobo": 500000, "markup_pct": 100}
    ]'::jsonb;

update public.pricing_rules
set markup_type = 'percent',
    markup_value = '100'::jsonb,
    updated_at = now()
where scope in ('country', 'service', 'service_country')
  and (markup_type is distinct from 'percent' or markup_value is distinct from '100'::jsonb);
