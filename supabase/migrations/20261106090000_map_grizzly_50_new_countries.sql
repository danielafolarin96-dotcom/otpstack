-- Map Grizzly SMS country ids onto the 50 countries added in
-- 20261106080000_expand_catalog_50_countries.sql (per the user's follow-up
-- request: "hope grizzly is also mapping the new 50 countries").
--
-- Verified live, AGENT.md rule 5 (never invent provider behavior):
-- grizzlysms.com's public, unauthenticated pages render Grizzly's own data
-- server-side into window.__NUXT__ -- no GRIZZLY_API_KEY involved. For each
-- of the 50 countries, loaded
--   https://grizzlysms.com/<service>?country=<slug>
-- for all Big 6 services (whatsapp, telegram, tiktok, facebook, instagram,
-- gmail -- confirmed matching grizzly_service_code's wa/tg/lf/fb/ig/go via
-- each page's embedded service.external_id) and read
-- window.__NUXT__.data[0].currentCountry {count, button_status,
-- external_id}. All 300 checks (50 countries x 6 services) came back
-- button_status: true with count in the thousands to low millions -- every
-- one of the 50 has live, buyable Grizzly stock across the full Big 6 right
-- now. (A few individual checks hit a transient "Failed to fetch" --
-- unrelated to a browser-tab/device reconnect mid-survey -- and were
-- immediately retried with the same live-stock result; no country was
-- excluded for an actual stock reason, unlike the original 78-country
-- mapping in 20261029120000, which did exclude some.)
--
-- external_id (Grizzly's numeric country id) was cross-checked two
-- independent ways for every country: the per-(service,country)
-- currentCountry.external_id below, and the global country list
-- (window.__NUXT__.state.countries.countriesList) -- both agreed in every
-- case. Two naming differences from our fivesim_country_code: fivesim's
-- 'macau' is Grizzly's "Macao" (external_id 20), and fivesim's 'salvador'
-- (El Salvador) is Grizzly's "Salvador" (external_id 101).
--
-- Effect (money-logic, AGENT.md rule 2): the Big 6's provider_routes rows
-- default to 'grizzly' for any country, but pickProvider
-- (lib/providers/route.ts) forces that back to 5sim when grizzly_country_id
-- is null. These 50 countries were 5sim-only until now, so this migration
-- actually shifts their Big 6 purchases from 5sim to Grizzly going forward
-- -- which is the documented design (provider-evaluation.md: "integrate
-- Grizzly as the main provider for WhatsApp, Telegram, TikTok, Facebook,
-- Instagram and Google"), not a new decision. Worth watching: this grows
-- Grizzly's order volume further, right as 5sim can't be topped up -- the
-- proactive provider-balance check shipped in 61b7a58
-- (checkProviderCanAfford, lib/orders/purchase.ts) is what catches a
-- drained Grizzly account cleanly now.
--
-- No provider_routes or pricing_rules changes needed -- same reasoning as
-- 20261106080000: pickProvider already falls back correctly, and
-- pricing_rules' single global rule covers every catalog entry.
update public.countries c
set grizzly_country_id = v.grizzly_id
from (values
    ('albania', 155), ('angola', 76), ('antiguaandbarbuda', 169),
    ('azerbaijan', 35), ('bahrain', 145), ('benin', 120), ('bih', 108),
    ('bulgaria', 83), ('burundi', 119), ('canada', 36), ('chad', 42),
    ('croatia', 45), ('cyprus', 77), ('dominicana', 109), ('easttimor', 91),
    ('estonia', 34), ('finland', 163), ('gabon', 154), ('haiti', 26),
    ('hungary', 84), ('ireland', 23), ('kyrgyzstan', 11), ('laos', 25),
    ('latvia', 49), ('lesotho', 136), ('lithuania', 44), ('luxembourg', 165),
    ('macau', 20), ('madagascar', 17), ('montenegro', 171),
    ('northmacedonia', 183), ('papuanewguinea', 79), ('paraguay', 87),
    ('peru', 65), ('puertorico', 97), ('reunion', 146), ('romania', 32),
    ('rwanda', 140), ('saintkittsandnevis', 134), ('saintlucia', 164),
    ('salvador', 101), ('sierraleone', 115), ('slovakia', 141),
    ('taiwan', 55), ('tajikistan', 143), ('tanzania', 9), ('uganda', 75),
    ('uruguay', 156), ('uzbekistan', 40), ('zambia', 147)
  ) as v (code, grizzly_id)
where c.fivesim_country_code = v.code
  and c.grizzly_country_id is distinct from v.grizzly_id;
