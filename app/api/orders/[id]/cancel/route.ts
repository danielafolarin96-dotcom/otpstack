import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cancelOrder } from "@/lib/5sim/client";
import { recordWalletTransaction } from "@/lib/wallet/ledger";
import { recordFinanceEvent } from "@/lib/finance/ledger";
import { extractOtpCode } from "@/lib/5sim/status";
import { describeUpstreamCancelError, fetchUpstreamSms } from "@/lib/orders/upstream-sms";

// Manual cancel-for-refund, per ARCHITECTURE.md's order lifecycle step 6 —
// only while the order is still pending and not yet expired.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: order, error } = await admin.from("orders").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!order || order.user_id !== user.id) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.status !== "pending") {
    return NextResponse.json({ error: "Only a still-pending order can be cancelled" }, { status: 409 });
  }
  if (new Date(order.expires_at).getTime() <= Date.now()) {
    return NextResponse.json({ error: "This order has already expired" }, { status: 409 });
  }

  // See lib/orders/upstream-sms.ts for the incident behind this pre-check:
  // if the code already reached 5sim (our own poll just hadn't picked it
  // up), the customer gets the code instead of a refund — 5sim refuses to
  // cancel an order that has SMS and bills us for it either way. The
  // expiry check above means any SMS found here arrived inside the window.
  // A failed check falls through to the ordinary cancel + refund below.
  const upstreamSms = await fetchUpstreamSms(order.fivesim_order_id);
  if (upstreamSms && upstreamSms.length > 0) {
    const updates: { status: "sms_received"; completed_at: string; otp_code?: string } = {
      status: "sms_received",
      completed_at: new Date().toISOString(),
    };
    const otpCode = extractOtpCode(upstreamSms);
    if (otpCode) updates.otp_code = otpCode;

    // Same first-claim-wins guard as the cancel claim below.
    const { data: delivered, error: deliverError } = await admin
      .from("orders")
      .update(updates)
      .eq("id", order.id)
      .eq("status", "pending")
      .select()
      .maybeSingle();

    if (deliverError) {
      console.error("Failed to record on-time SMS during cancel:", deliverError);
      return NextResponse.json({ error: "Failed to cancel order" }, { status: 500 });
    }
    if (!delivered) {
      console.log(`Order ${order.id} was already resolved by another path — cancel request rejected.`);
      return NextResponse.json({ error: "This order was already resolved" }, { status: 409 });
    }

    console.log(`Order ${order.id} had an SMS at 5sim when cancel was requested — delivered, no refund.`);
    return NextResponse.json({
      ok: true,
      order: {
        id: delivered.id,
        status: delivered.status,
        phoneNumber: delivered.phone_number,
        otpCode: delivered.otp_code,
        expiresAt: delivered.expires_at,
      },
    });
  }

  // Audit fix: the checks above only look at what we read a moment ago —
  // the cron/status-poll expiry fallback could resolve this exact order
  // concurrently (e.g. it just crossed expires_at on another request).
  // This conditional update is what actually and atomically claims the
  // order: it only succeeds if status is still 'pending' right now, and we
  // only touch 5sim/the wallet if we won that race.
  const { data: claimed, error: claimError } = await admin
    .from("orders")
    .update({ status: "cancelled_refunded", completed_at: new Date().toISOString() })
    .eq("id", order.id)
    .eq("status", "pending")
    .select()
    .maybeSingle();

  if (claimError) {
    console.error("Failed to update order after cancel:", claimError);
    return NextResponse.json({ error: "Failed to cancel order" }, { status: 500 });
  }
  if (!claimed) {
    console.log(`Order ${order.id} was already resolved by another path — cancel request rejected.`);
    return NextResponse.json({ error: "This order was already resolved" }, { status: 409 });
  }

  let upstreamCancelSucceeded = false;
  let upstreamCancelError: string | null = null;
  try {
    await cancelOrder(order.fivesim_order_id);
    upstreamCancelSucceeded = true;
  } catch (err) {
    // Continue regardless — the user still gets refunded even if 5sim's
    // own cancel call fails; we're not going to keep charging them for a
    // number they no longer want.
    console.error(`Failed to cancel upstream 5sim order ${order.fivesim_order_id}:`, err);
    upstreamCancelError = describeUpstreamCancelError(err);
  }

  // Best-effort — feeds the admin Margin page's recovered-vs-lost split
  // (lib/pricing/margin-report.ts), same as lib/orders/expire-and-refund.ts.
  const { error: markError } = await admin
    .from("orders")
    .update({ upstream_cancel_succeeded: upstreamCancelSucceeded, upstream_cancel_error: upstreamCancelError })
    .eq("id", order.id);
  if (markError) {
    console.error(`Failed to record upstream_cancel_succeeded for order ${order.id}:`, markError);
  }

  try {
    await recordWalletTransaction(admin, {
      userId: order.user_id,
      type: "refund",
      amountKobo: order.price_kobo,
      reference: `refund_cancelled_${order.id}`,
      orderId: order.id,
    });
  } catch (err) {
    console.error("Order cancelled but refund failed:", err);
    return NextResponse.json(
      { error: "Order cancelled but refund failed — contact support" },
      { status: 500 },
    );
  }

  // Reverses the revenue_recognized event written atomically at purchase
  // time — see lib/orders/expire-and-refund.ts's identical comment for why
  // the fee reversal is looked up rather than recomputed. Best-effort: a
  // failure here doesn't block or reverse the refund the customer already
  // received.
  try {
    const { data: recognized } = await admin
      .from("finance_events")
      .select("provider, payment_fee_kobo")
      .eq("order_id", order.id)
      .eq("event_type", "revenue_recognized")
      .maybeSingle();

    await recordFinanceEvent(admin, {
      orderId: order.id,
      userId: order.user_id,
      eventType: "refund_issued",
      serviceId: order.service_id,
      countryCode: order.country_code,
      provider: recognized?.provider ?? "5sim",
      revenueKobo: -order.price_kobo,
      providerCostKobo: upstreamCancelSucceeded ? -order.upstream_cost_kobo : 0,
      paymentFeeKobo: recognized ? -recognized.payment_fee_kobo : 0,
    });
  } catch (err) {
    console.error(`Failed to record finance_events refund for order ${order.id}:`, err);
  }

  return NextResponse.json({ ok: true });
}
