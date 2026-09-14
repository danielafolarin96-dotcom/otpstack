import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { cancelOrder } from "@/lib/5sim/client";
import { recordWalletTransaction } from "@/lib/wallet/ledger";

interface ExpirableOrder {
  id: string;
  user_id: string;
  fivesim_order_id: string;
  price_kobo: number;
}

export interface ExpireResult {
  // false means another path (a late-arriving SMS, a manual cancel) already
  // resolved this order between the caller's read and this call — no
  // refund was issued, callers must not assume "expired_refunded" happened.
  refunded: boolean;
}

// ARCHITECTURE.md's order lifecycle step 5: a still-pending order past its
// expires_at gets cancelled upstream and refunded. Shared by the
// /api/cron/expire-orders sweep (fired externally on a 1-2 minute cadence —
// see .github/workflows/expire-orders.yml and this repo's cron notes; the
// once-a-day Vercel cron in vercel.json is a 24h backstop only, since
// Vercel Hobby doesn't allow a tighter schedule) and the status-check
// route's own fallback.
//
// Audit fix: this used to update orders.status unconditionally, so a
// late-arriving SMS (resolved concurrently by the status-poll route) or a
// concurrent manual cancel could get silently overwritten back to
// expired_refunded, and still get refunded on top of whatever that other
// path already did. The UPDATE below only affects the row if it's still
// 'pending' at the moment it runs, and everything downstream (the upstream
// cancel call, the refund) only happens if we actually won that race.
export async function expireAndRefundOrder(
  admin: SupabaseClient<Database>,
  order: ExpirableOrder,
): Promise<ExpireResult> {
  const { data: claimed, error: claimError } = await admin
    .from("orders")
    .update({ status: "expired_refunded", completed_at: new Date().toISOString() })
    .eq("id", order.id)
    .eq("status", "pending")
    .select()
    .maybeSingle();

  if (claimError) throw claimError;

  if (!claimed) {
    console.log(
      `Order ${order.id} was already resolved by another path before the expiry sweep reached it — skipping refund.`,
    );
    return { refunded: false };
  }

  // 5sim's own docs (https://5sim.net/docs, "Buy activation number" ->
  // Request limits: "Maximum waiting time is 15 minutes. Timeout no sms 5
  // minute") put an activation order's no-SMS auto-timeout at ~5 minutes —
  // shorter than our own 10-minute TTL, and confirmed empirically (Sept
  // 2026): every cancel we observed succeeding upstream landed within ~4
  // minutes of purchase; the one we have on record attempted at ~15
  // minutes had already flipped to TIMEOUT upstream and failed. So a
  // failure here is genuinely expected often, even with a fast sweep — see
  // the money-flow note in this change's commit message.
  let upstreamCancelSucceeded = false;
  try {
    await cancelOrder(order.fivesim_order_id);
    upstreamCancelSucceeded = true;
  } catch (err) {
    console.error(`Failed to cancel upstream 5sim order ${order.fivesim_order_id} on expiry:`, err);
  }

  // Best-effort: feeds the admin Margin page's recovered-vs-lost split
  // (lib/pricing/margin-report.ts). Not money-critical — if this write
  // fails, the refund below still happens; the order just won't be
  // attributed to either bucket on the Margin page.
  const { error: markError } = await admin
    .from("orders")
    .update({ upstream_cancel_succeeded: upstreamCancelSucceeded })
    .eq("id", order.id);
  if (markError) {
    console.error(`Failed to record upstream_cancel_succeeded for order ${order.id}:`, markError);
  }

  await recordWalletTransaction(admin, {
    userId: order.user_id,
    type: "refund",
    amountKobo: order.price_kobo,
    reference: `refund_expired_${order.id}`,
    orderId: order.id,
  });

  return { refunded: true };
}
