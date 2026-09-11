import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { recordWalletTransaction } from "./ledger";

// ₦500, see the "top-up match" growth decision: match a user's first real
// top-up 1:1 up to this fixed amount, not a percentage and not repeated on
// later top-ups. Deliberately small and bounded -- keeps worst-case cash
// exposure per new user to roughly this amount's upstream-cost share
// (~40%, i.e. ~₦200) once actually redeemed on a number, not the full ₦500.
const FIRST_TOPUP_MATCH_KOBO = 50_000;

export interface FirstTopupMatchResult {
  granted: boolean;
}

// Call this after a real Paystack top-up has been recorded via
// recordWalletTransaction. Grants a one-time ₦500 credit on a user's very
// first successful top-up only.
//
// Deliberately reuses the existing `admin_adjustment` wallet_transaction
// type rather than adding a new enum value -- no schema migration needed,
// and it's tagged in `metadata` (reason: "signup_topup_match_promo") so
// admin margin reporting can filter promo-funded credit out of real
// revenue. See ARCHITECTURE.md's wallet_transactions type enum.
//
// Idempotent by construction, not by a guard the caller has to get right:
// the reference is deterministic per user
// (`promo_first_topup_match_<userId>`), so recordWalletTransaction's
// existing unique-violation-as-no-op handling means calling this more
// than once for the same user (a retried webhook, a race between two
// near-simultaneous top-ups, or recovering from a transient failure on a
// prior attempt) can never grant the match twice. Safe -- and necessary --
// to call unconditionally after every successful top-up record, not just
// ones this call believes are "new".
export async function maybeGrantFirstTopupMatch(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<FirstTopupMatchResult> {
  const { count, error } = await supabase
    .from("wallet_transactions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("type", "topup");

  if (error) throw error;

  // The top-up that triggered this call has already been recorded by the
  // time this runs, so "this was their first top-up" is count === 1, not
  // 0. Anything else (0 means something is wrong upstream; >1 means this
  // genuinely isn't their first) skips the match.
  if ((count ?? 0) !== 1) {
    return { granted: false };
  }

  const result = await recordWalletTransaction(supabase, {
    userId,
    type: "admin_adjustment",
    amountKobo: FIRST_TOPUP_MATCH_KOBO,
    reference: `promo_first_topup_match_${userId}`,
    metadata: {
      reason: "signup_topup_match_promo",
      promo: "first_topup_match_500",
    },
  });

  return { granted: result.inserted };
}
