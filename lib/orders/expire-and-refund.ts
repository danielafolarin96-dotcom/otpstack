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

// ARCHITECTURE.md's order lifecycle step 5: a still-pending order past its
// expires_at gets cancelled upstream and refunded. Shared by the
// /api/cron/expire-orders sweep and the status-check route's own fallback
// (the cron can't actually fire yet — no Vercel project connected — so a
// user polling their own expired order is currently the only path that
// reliably resolves it; see the cron route's comment).
export async function expireAndRefundOrder(
  admin: SupabaseClient<Database>,
  order: ExpirableOrder,
): Promise<void> {
  try {
    await cancelOrder(order.fivesim_order_id);
  } catch (err) {
    // Best-effort — 5sim's own 15-minute hold likely already lapsed by the
    // time our stricter 10-minute TTL fires, so a failure here is expected
    // more often than not. Still refund the user regardless.
    console.error(`Failed to cancel upstream 5sim order ${order.fivesim_order_id} on expiry:`, err);
  }

  const { error: updateError } = await admin
    .from("orders")
    .update({ status: "expired_refunded", completed_at: new Date().toISOString() })
    .eq("id", order.id);
  if (updateError) throw updateError;

  await recordWalletTransaction(admin, {
    userId: order.user_id,
    type: "refund",
    amountKobo: order.price_kobo,
    reference: `refund_expired_${order.id}`,
    orderId: order.id,
  });
}
