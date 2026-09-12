-- Country-scaling trial (13 -> 31), requested ahead of the full Stage 4
-- scale-up since the country-expansion path (as opposed to services,
-- covered by the Stage 3 trial) had never actually been exercised.
--
-- Verified against 5sim's real, live catalog, not invented (AGENT.md rule
-- 5): fetched GET /guest/countries (153 listed) then GET
-- /guest/products/<country>/any for every one of them to get an actual
-- current product count, since the country listing alone includes
-- countries 5sim doesn't meaningfully support ordering from — 8 of the
-- 153 (bahamas, belize, chile, comoros, guadeloupe, samoa, seychelles,
-- solomonislands) return HTTP 400 from the products endpoint despite
-- being listed, and were excluded outright.
--
-- These 18 are the highest-inventory countries not already active,
-- ranging 607 down to 244 products with live stock at survey time —
-- comfortably ahead of the weakest already-active country (Ghana, 204)
-- and nowhere near the low end of the full 153 (Denmark 24, Belgium 21,
-- Djibouti 1, and the already-active Kazakhstan still at 1 — see this
-- migration's report for more on that).
insert into public.countries (id, name, fivesim_country_code, flag_emoji) values
  ('00000000-0000-0000-0000-000000000114', 'Netherlands', 'netherlands', '🇳🇱'),
  ('00000000-0000-0000-0000-000000000115', 'Argentina',   'argentina',   '🇦🇷'),
  ('00000000-0000-0000-0000-000000000116', 'Brazil',      'brazil',      '🇧🇷'),
  ('00000000-0000-0000-0000-000000000117', 'Italy',       'italy',       '🇮🇹'),
  ('00000000-0000-0000-0000-000000000118', 'Portugal',    'portugal',    '🇵🇹'),
  ('00000000-0000-0000-0000-000000000119', 'Israel',      'israel',      '🇮🇱'),
  ('00000000-0000-0000-0000-000000000120', 'France',      'france',      '🇫🇷'),
  ('00000000-0000-0000-0000-000000000121', 'Spain',       'spain',       '🇪🇸'),
  ('00000000-0000-0000-0000-000000000122', 'Germany',     'germany',     '🇩🇪'),
  ('00000000-0000-0000-0000-000000000123', 'Hong Kong',   'hongkong',    '🇭🇰'),
  ('00000000-0000-0000-0000-000000000124', 'Austria',     'austria',     '🇦🇹'),
  ('00000000-0000-0000-0000-000000000125', 'Malaysia',    'malaysia',    '🇲🇾'),
  ('00000000-0000-0000-0000-000000000126', 'Slovenia',    'slovenia',    '🇸🇮'),
  ('00000000-0000-0000-0000-000000000127', 'Sweden',      'sweden',      '🇸🇪'),
  ('00000000-0000-0000-0000-000000000128', 'Australia',   'australia',   '🇦🇺'),
  ('00000000-0000-0000-0000-000000000129', 'Czechia',     'czech',       '🇨🇿'),
  ('00000000-0000-0000-0000-000000000130', 'Cambodia',    'cambodia',    '🇰🇭'),
  ('00000000-0000-0000-0000-000000000131', 'Morocco',     'morocco',     '🇲🇦')
on conflict (fivesim_country_code) do nothing;
