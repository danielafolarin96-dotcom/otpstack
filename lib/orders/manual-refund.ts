import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { cancelOrder } from "@/lib/5sim/client";
import { recordWalletTransaction } from "@/lib/wallet/ledger";
import { recordAdminAction } from "@/lib/audit/log";
import { recordFinanceEvent } from "@/lib/finance/ledger";

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

  // Only attempted when the number was never used (pending) -- an
  // sms_received order already delivered a working code, so there's
  // nothing to recover upstream and cancelling would be meaningless (see
  // this function's header comment). upstreamCancelSucceeded feeds the
  // finance_events reversal below: same recovered-vs-lost distinction the
  // automatic refund paths track via orders.upstream_cancel_succeeded, just
  // determined here instead of persisted on the order row.
  let upstreamCancelSucceeded = false;
  if (previousStatus === "pending") {
    try {
      await cancelOrder(claimed.fivesim_order_id);
      upstreamCancelSucceeded = true;
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

  // Reverses the revenue_recognized event written atomically at purchase
  // time — see expire-and-refund.ts's identical comment for why the fee
  // reversal is looked up rather than recomputed. Best-effort: a failure
  // here doesn't block or reverse the refund the customer already received.
  try {
    const { data: recognized } = await admin
      .from("finance_events")
      .select("provider, payment_fee_kobo")
      .eq("order_id", claimed.id)
      .eq("event_type", "revenue_recognized")
      .maybeSingle();

    await recordFinanceEvent(admin, {
      orderId: claimed.id,
      userId: claimed.user_id,
      eventType: "refund_issued",
      serviceId: claimed.service_id,
      countryCode: claimed.country_code,
      provider: recognized?.provider ?? "5sim",
      revenueKobo: -claimed.price_kobo,
      providerCostKobo: upstreamCancelSucceeded ? -claimed.upstream_cost_kobo : 0,
      paymentFeeKobo: recognized ? -recognized.payment_fee_kobo : 0,
      metadata: { reason: params.reason, previous_status: previousStatus },
    });
  } catch (err) {
    console.error(`Failed to record finance_events refund for order ${claimed.id}:`, err);
  }

  return { refunded: true };
}
