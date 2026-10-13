-- Companion to orders.upstream_cancel_succeeded (20260914120000): when a
-- refund path's 5sim cancelOrder() call fails, record 5sim's own reason so
-- a lost upstream cost can be diagnosed after the fact (e.g. "order has
-- sms" vs "order expired") instead of guessed at. Written by
-- lib/orders/expire-and-refund.ts and app/api/orders/[id]/cancel/route.ts
-- via lib/orders/upstream-sms.ts's describeUpstreamCancelError — the error
-- message only (5sim path, HTTP status, response body), truncated to 500
-- chars, never request headers or the API key.
--
-- null = cancelOrder() succeeded, was never attempted (not a refunded
--        order), or the refund predates this column.
--
-- Reverse with: alter table public.orders drop column if exists upstream_cancel_error;
alter table public.orders
  add column if not exists upstream_cancel_error text;

comment on column public.orders.upstream_cancel_error is
  'Set alongside upstream_cancel_succeeded when a refund''s upstream 5sim cancelOrder() call fails: 5sim''s error message (path, status, body), truncated to 500 chars. Null when the cancel succeeded, was not attempted, or predates this column.';
