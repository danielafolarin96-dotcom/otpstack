-- Money-losing bug fix (see commit message): the daily expire-orders sweep
-- meant expireAndRefundOrder's cancelOrder() call almost always fired long
-- after 5sim's own order had already timed out upstream, so 5sim kept the
-- money while we still refunded the customer's wallet. Fixing the sweep
-- frequency (separate change, this repo's cron/workflow config) addresses
-- the lag; this migration adds the column needed to actually observe
-- whether it worked, order by order, instead of assuming.
--
-- null = not a refunded order (still pending, sms_received, or banned) or
--        predates this column and was never backfilled.
-- true = cancelOrder() succeeded — the upstream cost was actually
--        recovered from 5sim, not just written off.
-- false = cancelOrder() was attempted and failed (5sim's own window had
--         already lapsed, or some other upstream error) — the upstream
--         cost is a real loss, not just an accounting refund.
alter table public.orders
  add column if not exists upstream_cancel_succeeded boolean;

comment on column public.orders.upstream_cancel_succeeded is
  'Set by lib/orders/expire-and-refund.ts and the manual-cancel route when an order is refunded: whether the upstream 5sim cancelOrder() call actually succeeded (true = cost recovered) or failed (false = cost lost to 5sim). Null for non-refunded orders and refunds that predate this column.';

-- One-time backfill for the 12 orders refunded before this column existed
-- (all of them, as of this migration — see the live Margin page's
-- ₦3,466.17 refund-cost figure this fix is responding to). Values below
-- were confirmed by querying 5sim's own /user/check/{id} for each
-- fivesim_order_id live (Sept 14 2026): a CANCELED status upstream means
-- our cancel call landed and 5sim's side actually agrees the order is
-- cancelled (cost recovered); TIMEOUT means 5sim had already expired the
-- order internally before our (then-daily) sweep got to it, so our cancel
-- call failed and the cost was never recovered. This is a one-time,
-- hand-verified correction — not a general pattern to repeat; from here
-- on the application code sets this column itself at refund time.
update public.orders set upstream_cancel_succeeded = true
where fivesim_order_id in (
  '1091623301', '1091184030', '1091181004', '1091131491',
  '1090849490', '1090834200', '1090708849', '1090636869',
  '1090636419', '1090247964', '1090221906'
) and status in ('expired_refunded', 'cancelled_refunded');

update public.orders set upstream_cancel_succeeded = false
where fivesim_order_id in ('1090837536')
and status in ('expired_refunded', 'cancelled_refunded');
