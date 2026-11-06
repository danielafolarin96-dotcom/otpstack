-- Catalog expansion: +50 countries (80 -> 130), including Canada per
-- explicit request.
--
-- Verified against 5sim's real, live catalog (AGENT.md rule 5; same
-- methodology as the earlier country-scaling trial and Stage 4 scale-up):
-- fetched GET /guest/countries (153 listed, unchanged since the Stage 4
-- survey), excluded the 80 already active, and called
-- GET /guest/products/<country>/any for each of the 73 remaining
-- candidates to get a live distinct-product count. 8 return HTTP 400
-- despite being listed -- bahamas, belize, chile, comoros, guadeloupe,
-- samoa, seychelles, solomonislands -- the exact same 8 excluded in the
-- country-scaling trial; still excluded here. That leaves 65 valid
-- candidates; took the top 50 by live product count.
--
-- Canada ranks #1 of all 65 (217 live products) -- it didn't need to be
-- force-included, it's genuinely the strongest country not yet active.
-- Weakest pick here is Cyprus at 145 products -- comfortably ahead of
-- several already-active countries re-checked the same way just now
-- (Congo 192, Ghana 204, Nigeria 212). One already-active country,
-- Kazakhstan, now 400s on this same endpoint -- it may have gone fully
-- dead on 5sim's side since it was added; flagged for the user, not
-- touched here (out of scope for a country-addition migration).
--
-- All 50 are 5sim-only (grizzly_country_id left null, same as every other
-- country added since the Grizzly integration -- see 20261029120000's
-- comment: Grizzly mapping is a separate, deliberately reviewed pass, not
-- something to do opportunistically here). No provider_routes or
-- pricing_rules changes needed: pickProvider (lib/providers/route.ts)
-- already falls back to services.provider ('5sim') for any country with
-- no grizzly mapping, and pricing_rules has a single global rule with no
-- per-country row required.
insert into public.countries (name, fivesim_country_code, flag_emoji) values
  ('Canada', 'canada', '🇨🇦'),
  ('Azerbaijan', 'azerbaijan', '🇦🇿'),
  ('Peru', 'peru', '🇵🇪'),
  ('Tanzania', 'tanzania', '🇹🇿'),
  ('Burundi', 'burundi', '🇧🇮'),
  ('Laos', 'laos', '🇱🇦'),
  ('Paraguay', 'paraguay', '🇵🇾'),
  ('Benin', 'benin', '🇧🇯'),
  ('Bahrain', 'bahrain', '🇧🇭'),
  ('Haiti', 'haiti', '🇭🇹'),
  ('Bulgaria', 'bulgaria', '🇧🇬'),
  ('Sierra Leone', 'sierraleone', '🇸🇱'),
  ('Madagascar', 'madagascar', '🇲🇬'),
  ('Estonia', 'estonia', '🇪🇪'),
  ('Saint Lucia', 'saintlucia', '🇱🇨'),
  ('El Salvador', 'salvador', '🇸🇻'),
  ('Taiwan', 'taiwan', '🇹🇼'),
  ('Lithuania', 'lithuania', '🇱🇹'),
  ('North Macedonia', 'northmacedonia', '🇲🇰'),
  ('Croatia', 'croatia', '🇭🇷'),
  ('Uganda', 'uganda', '🇺🇬'),
  ('Lesotho', 'lesotho', '🇱🇸'),
  ('Gabon', 'gabon', '🇬🇦'),
  ('Finland', 'finland', '🇫🇮'),
  ('Latvia', 'latvia', '🇱🇻'),
  ('Romania', 'romania', '🇷🇴'),
  ('Luxembourg', 'luxembourg', '🇱🇺'),
  ('Albania', 'albania', '🇦🇱'),
  ('Slovakia', 'slovakia', '🇸🇰'),
  ('Zambia', 'zambia', '🇿🇲'),
  ('Ireland', 'ireland', '🇮🇪'),
  ('Dominican Republic', 'dominicana', '🇩🇴'),
  ('Hungary', 'hungary', '🇭🇺'),
  ('Angola', 'angola', '🇦🇴'),
  ('Papua New Guinea', 'papuanewguinea', '🇵🇬'),
  ('Timor-Leste', 'easttimor', '🇹🇱'),
  ('Chad', 'chad', '🇹🇩'),
  ('Kyrgyzstan', 'kyrgyzstan', '🇰🇬'),
  ('Uruguay', 'uruguay', '🇺🇾'),
  ('Montenegro', 'montenegro', '🇲🇪'),
  ('Bosnia and Herzegovina', 'bih', '🇧🇦'),
  ('Rwanda', 'rwanda', '🇷🇼'),
  ('Tajikistan', 'tajikistan', '🇹🇯'),
  ('Uzbekistan', 'uzbekistan', '🇺🇿'),
  ('Macau', 'macau', '🇲🇴'),
  ('Puerto Rico', 'puertorico', '🇵🇷'),
  ('Réunion', 'reunion', '🇷🇪'),
  ('Saint Kitts and Nevis', 'saintkittsandnevis', '🇰🇳'),
  ('Antigua and Barbuda', 'antiguaandbarbuda', '🇦🇬'),
  ('Cyprus', 'cyprus', '🇨🇾')
on conflict (fivesim_country_code) do nothing;
