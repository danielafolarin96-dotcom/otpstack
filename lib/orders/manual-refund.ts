import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { cancelOrder } from "@/lib/5sim/client";
import { recordWalletTransaction } from "@/lib/wallet/ledger";
import { recordAdminAction } from "@/lib/audit/log";

export interface ManualRefundResult {
  // false means the order was already resolved (expired, cancelled,
  // refunded, or banned) by the time this ran — no refund was issued.
  refunded: boolean;
}

// Admin-triggered refund, outside the automatic expiry/cancel paths (see
// expire-and-refund.ts and app/api/orders/[id]/cancel/route.ts) — same
// claim-before-act discipline: only an order still in a refundable status
// at the moment this UPDATE runs gets refunded, so this can never stack a
// second refund on top of whatever the automatic paths already did.
//
// Unlike those paths, a manual refund is also valid for an already
// sms_received order (a dispute — the code arrived but didn't actually
// work) as well as pending. Two separate conditional claims, not one
// .in(["pending","sms_received"]) update, so this always knows for
// certain which status it actually won the race against: pending gets a
// best-effort upstream cancel (the number was never used); sms_received
// skips it outright (the number already delivered a real code — cancelling
// it upstream would be meaningless and 5sim may reject it).
//
// Recorded as wallet_transactions.type = "admin_adjustment", not "refund"
// — deliberately distinct from the automatic paths in both the user's own
// transaction history and admin_audit_log, per explicit product decision.
export async function manualRefundOrder(
  admin: SupabaseClient<Database>,
  params: { orderId: string; adminId: string; reason: string },
): Promise<ManualRefundResult> {
  const completedAt = new Date().toISOString();

  const pendingClaim = await admin
    .from("orders")
    .update({ status: "cancelled_refunded", completed_at: completedAt })
    .eq("id", params.orderId)
    .eq("status", "pending")
    .select()
    .maybeSingle();
  if (pendingClaim.error) throw pendingClaim.error;

  let claimed = pendingClaim.data;
  let previousStatus: "pending" | "sms_received" | null = claimed ? "pending" : null;

  if (!claimed) {
    const smsClaim = await admin
      .from("orders")
      .update({ status: "cancelled_refunded", completed_at: completedAt })
      .eq("id", params.orderId)
      .eq("status", "sms_received")
      .select()
      .maybeSingle();
    if (smsClaim.error) throw smsClaim.error;
    claimed = smsClaim.data;
    previousStatus = claimed ? "sms_received" : null;
  }

  if (!claimed) {
    console.log(
      `Order ${params.orderId} was already resolved (or never existed) by the time the manual refund ran — skipping.`,
    );
    return { refunded: false };
  }

  if (previousStatus === "pending") {
    try {
      await cancelOrder(claimed.fivesim_order_id);
    } catch (err) {
      console.error(
        `Failed to cancel upstream 5sim order ${claimed.fivesim_order_id} on manual refund:`,
        err,
      );
    }
  }

  await recordWalletTransaction(admin, {
    userId: claimed.user_id,
    type: "admin_adjustment",
    amountKobo: claimed.price_kobo,
    reference: `admin_refund_${claimed.id}`,
    orderId: claimed.id,
    metadata: { reason: params.reason },
  });

  await recordAdminAction(admin, {
    adminId: params.adminId,
    action: "order.manual_refund",
    targetType: "order",
    targetId: claimed.id,
    reason: params.reason,
    metadata: {
      previous_status: previousStatus,
      amount_kobo: claimed.price_kobo,
      user_id: claimed.user_id,
    },
  });

  return { refunded: true };
}
