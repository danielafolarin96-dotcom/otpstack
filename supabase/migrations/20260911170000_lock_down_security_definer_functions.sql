-- Phase 6 RLS/security review finding: `revoke all on function ... from
-- public` (used in the create_order_and_debit_wallet and check_rate_limit
-- migrations) does NOT revoke the separate, direct EXECUTE grants Supabase
-- gives the `anon` and `authenticated` roles via a database-level default
-- privilege on every new function in the public schema. Revoking from the
-- PUBLIC pseudo-role only removes what PUBLIC itself would otherwise grant
-- everyone by inheritance — it leaves anon/authenticated's own grants
-- untouched.
--
-- Confirmed live and exploitable before this migration:
--   curl .../rest/v1/rpc/create_order_and_debit_wallet (with only the anon
--   apikey, no auth) executed successfully as far as the orders FK check —
--   i.e. any unauthenticated caller could invoke it, including with a
--   negative p_price_kobo to *credit* an arbitrary wallet with fabricated
--   money, bypassing Paystack entirely. Same story for check_rate_limit
--   (lower severity — it can only inflate/exhaust a counter, not move
--   money — but still meant to be internal-only).
--
-- handle_new_user and sync_wallet_balance are `returns trigger` functions,
-- which PostgREST never exposes via REST regardless of grants (confirmed:
-- calling either RPC 404s, "not found in the schema cache") — not
-- practically exploitable, but locked down here too for defense in depth
-- and to match the principle that only service_role should ever be able
-- to invoke any of these.
revoke all on function public.create_order_and_debit_wallet from public, anon, authenticated;
grant execute on function public.create_order_and_debit_wallet to service_role;

revoke all on function public.check_rate_limit from public, anon, authenticated;
grant execute on function public.check_rate_limit to service_role;

revoke all on function public.handle_new_user from public, anon, authenticated;
grant execute on function public.handle_new_user to service_role;

revoke all on function public.sync_wallet_balance from public, anon, authenticated;
grant execute on function public.sync_wallet_balance to service_role;
