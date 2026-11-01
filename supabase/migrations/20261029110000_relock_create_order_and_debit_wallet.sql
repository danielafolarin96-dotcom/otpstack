-- Security fix (found 29 Oct 2026 while reviewing the Grizzly migration).
-- 20260923121000_wire_finance_events_into_purchase_rpc dropped and
-- re-created create_order_and_debit_wallet, which gave the new function
-- Supabase's default EXECUTE grants for anon and authenticated again and
-- silently undid 20260911170000_lock_down_security_definer_functions.
-- Its `revoke all ... from public` alone does not remove those grants.
-- That re-opened the hole described in 20260911170000: anyone with the
-- public anon key could call the RPC directly, including with a negative
-- p_price_kobo to credit a wallet. Checked before the fix: no abuse found
-- (no positive 'purchase' wallet rows, no non-positive order prices, every
-- wallet balance reconciles with its ledger).
--
-- Already applied to production on 29 Oct 2026 via the Supabase connector;
-- this file records it. Any future drop/re-create of a SECURITY DEFINER
-- function must revoke from public, anon AND authenticated.
revoke all on function public.create_order_and_debit_wallet(
  uuid, uuid, text, text, text, bigint, bigint, timestamptz, jsonb, text, real, bigint, uuid, text
) from public, anon, authenticated;
grant execute on function public.create_order_and_debit_wallet(
  uuid, uuid, text, text, text, bigint, bigint, timestamptz, jsonb, text, real, bigint, uuid, text
) to service_role;
