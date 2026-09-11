-- Corrects three Phase 3 seed mistakes, discovered by verifying against
-- 5sim's real, live API (GET /guest/countries, GET /guest/products/nigeria/any)
-- while building the Phase 4 client — these codes don't exist on 5sim at
-- all, so any order against them would fail outright:
--   - 'russia' and 'ukraine' are not valid 5sim country keys
--   - 'spotify' is not a 5sim product at all (confirmed: no match, no
--     partial match for "spot"/"music" either)
-- Updated in place (not deleted/reinserted) since ids may already be
-- referenced elsewhere (pricing_rules, and now orders).

update public.countries
set name = 'Kazakhstan', fivesim_country_code = 'kazakhstan', flag_emoji = '🇰🇿'
where fivesim_country_code = 'russia';

update public.countries
set name = 'Vietnam', fivesim_country_code = 'vietnam', flag_emoji = '🇻🇳'
where fivesim_country_code = 'ukraine';

update public.services
set name = 'Snapchat', fivesim_product_code = 'snapchat', category = 'Social', icon_key = 'snapchat'
where fivesim_product_code = 'spotify';
