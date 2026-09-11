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
// /api/cron/expire-orders sweep and the status-check route's own fallback
// (the cron can't actually fire yet — no Vercel project connected — so a
// user polling their own expired order is currently the only path that
// reliably resolves it; see the cron route's comment).
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

  try {
    await cancelOrder(order.fivesim_order_id);
  } catch (err) {
    // Best-effort — 5sim's own 15-minute hold likely already lapsed by the
    // time our stricter 10-minute TTL fires, so a failure here is expected
    // more often than not. Still refund the user regardless.
    console.error(`Failed to cancel upstream 5sim order ${order.fivesim_order_id} on expiry:`, err);
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
