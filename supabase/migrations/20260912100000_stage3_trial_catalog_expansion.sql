-- Stage 3 catalog-expansion trial: 27 additional services (18 -> 45),
-- verified against 5sim's real, live catalog (GET /guest/products/<country>/any
-- across all 13 currently-active countries) rather than invented — see
-- AGENT.md rule 5. Every code below was confirmed present with Qty > 0 in
-- at least 10 of the 13 active countries at survey time (Sept 2026);
-- exact per-country availability still varies and is resolved live at
-- price time (lib/pricing/catalog.ts already renders "Unavailable" for a
-- service/country pair 5sim doesn't currently offer — no schema change
-- needed for that).
--
-- icon_key targets simple-icons' real slug, which sometimes differs from
-- 5sim's product code (grabtaxi -> icon slug "grab"). Several picks have
-- no current Simple Icons match at all (openai, alibaba, bolt, careem,
-- yahoo, bumble, grindr, happn) and are included anyway — lib/icons/lookup.ts
-- returns null for these and the UI falls back to the neutral icon tile,
-- which is the designed-for behavior, not a defect.
insert into public.services (id, name, fivesim_product_code, category, icon_key) values
  ('00000000-0000-0000-0000-000000000019', 'Steam',       'steam',       'Entertainment',  'steam'),
  ('00000000-0000-0000-0000-000000000020', 'Twitch',      'twitch',      'Entertainment',  'twitch'),
  ('00000000-0000-0000-0000-000000000021', 'OpenAI',      'openai',      'Productivity',   'openai'),
  ('00000000-0000-0000-0000-000000000022', 'Signal',      'signal',      'Messaging',      'signal'),
  ('00000000-0000-0000-0000-000000000023', 'Viber',       'viber',       'Messaging',      'viber'),
  ('00000000-0000-0000-0000-000000000024', 'WeChat',      'wechat',      'Messaging',      'wechat'),
  ('00000000-0000-0000-0000-000000000025', 'LINE',        'line',        'Messaging',      'line'),
  ('00000000-0000-0000-0000-000000000026', 'eBay',        'ebay',        'Shopping',       'ebay'),
  ('00000000-0000-0000-0000-000000000027', 'Alibaba',     'alibaba',     'Shopping',       'alibaba'),
  ('00000000-0000-0000-0000-000000000028', 'AliExpress',  'aliexpress',  'Shopping',       'aliexpress'),
  ('00000000-0000-0000-0000-000000000029', 'Grab',        'grabtaxi',    'Travel',         'grab'),
  ('00000000-0000-0000-0000-000000000030', 'Bolt',        'bolt',        'Travel',         'bolt'),
  ('00000000-0000-0000-0000-000000000031', 'Careem',      'careem',      'Travel',         'careem'),
  ('00000000-0000-0000-0000-000000000032', 'Glovo',       'glovo',       'Food & Delivery','glovo'),
  ('00000000-0000-0000-0000-000000000033', 'Deliveroo',   'deliveroo',   'Food & Delivery','deliveroo'),
  ('00000000-0000-0000-0000-000000000034', 'Foodpanda',   'foodpanda',   'Food & Delivery','foodpanda'),
  ('00000000-0000-0000-0000-000000000035', 'Zomato',      'zomato',      'Food & Delivery','zomato'),
  ('00000000-0000-0000-0000-000000000036', 'Adidas',      'adidas',      'Shopping',       'adidas'),
  ('00000000-0000-0000-0000-000000000037', 'Nike',        'nike',        'Shopping',       'nike'),
  ('00000000-0000-0000-0000-000000000038', 'Fiverr',      'fiverr',      'Productivity',   'fiverr'),
  ('00000000-0000-0000-0000-000000000039', 'Yahoo',       'yahoo',       'Productivity',   'yahoo'),
  ('00000000-0000-0000-0000-000000000040', 'Proton Mail', 'protonmail',  'Productivity',   'protonmail'),
  ('00000000-0000-0000-0000-000000000041', 'KakaoTalk',   'kakaotalk',   'Messaging',      'kakaotalk'),
  ('00000000-0000-0000-0000-000000000042', 'Bumble',      'bumble',      'Dating',         'bumble'),
  ('00000000-0000-0000-0000-000000000043', 'Grindr',      'grindr',      'Dating',         'grindr'),
  ('00000000-0000-0000-0000-000000000044', 'Happn',       'happn',       'Dating',         'happn'),
  ('00000000-0000-0000-0000-000000000045', 'Shopee',      'shopee',      'Shopping',       'shopee')
on conflict (fivesim_product_code) do nothing;

-- Pre-existing gap, found while wiring up the simple-icons npm package for
-- this stage: Twitter rebranded to X, and Simple Icons dropped the
-- "twitter" slug in favor of "x" — the old icon_key never matched (the
-- CDN this used to hit 404'd on it too, confirmed live), so this tile has
-- silently been falling back to the plain ink-initial tile in production
-- already. "x" is a real, current Simple Icons slug, so this is a one-line
-- fix, not a design decision — the service's name stays "Twitter".
update public.services set icon_key = 'x' where fivesim_product_code = 'twitter';
