-- Visibility for the Grizzly->5sim no-stock fallback (lib/orders/purchase.ts
-- quoteAndBuy/isGrizzlyNoStockFailure, added 2 Nov 2026). Until now a
-- Grizzly failure the fallback successfully recovered via 5sim left no
-- trace anywhere but a console.log line -- purchase_failures only ever saw
-- the failures that stayed failures (app/api/orders/route.ts's catch-all).
-- This adds the missing half: purchaseNumber itself now also records a
-- purchase_failures row when it recovers a Grizzly no-stock failure by
-- falling back to 5sim, so "how often is Grizzly actually failing, and how
-- often are we quietly covering for it" is visible in one table instead of
-- split between logs and guesswork. Read by the new /admin/grizzly-fallback
-- page.
--
-- recovered_by_fallback = true rows are not real failures from the
-- customer's point of view -- the order went through, just not on the
-- provider the route table says it should have. http_status is 200 for
-- these; nothing failed outward. False (the default) covers every other
-- row, including Grizzly failures where the 5sim fallback also had nothing
-- (those still throw and go through the existing route.ts path untouched).
--
-- Reversal: alter table public.purchase_failures
--   drop column recovered_by_fallback, drop column recovered_order_id;

alter table public.purchase_failures
  add column if not exists recovered_by_fallback boolean not null default false,
  add column if not exists recovered_order_id uuid references public.orders (id) on delete set null;

comment on column public.purchase_failures.recovered_by_fallback is
  'True when this was a Grizzly no-stock failure (reason operator_unavailable/upstream_no_numbers, provider grizzly) that purchaseNumber recovered by falling back to 5sim -- the customer still got a number. False for every other row, including Grizzly failures where the fallback also had nothing.';
comment on column public.purchase_failures.recovered_order_id is
  'The order actually created by the 5sim fallback, when recovered_by_fallback is true. Null otherwise.';

create index if not exists purchase_failures_recovered_by_fallback_idx
  on public.purchase_failures (recovered_by_fallback, created_at desc)
  where recovered_by_fallback;
