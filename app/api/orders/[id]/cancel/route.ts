import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { cancelOrder } from "@/lib/5sim/client";
import { recordWalletTransaction } from "@/lib/wallet/ledger";

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
  try {
    await cancelOrder(order.fivesim_order_id);
    upstreamCancelSucceeded = true;
  } catch (err) {
    // Continue regardless — the user still gets refunded even if 5sim's
    // own cancel call fails; we're not going to keep charging them for a
    // number they no longer want.
    console.error(`Failed to cancel upstream 5sim order ${order.fivesim_order_id}:`, err);
  }

  // Best-effort — feeds the admin Margin page's recovered-vs-lost split
  // (lib/pricing/margin-report.ts), same as lib/orders/expire-and-refund.ts.
  const { error: markError } = await admin
    .from("orders")
    .update({ upstream_cancel_succeeded: upstreamCancelSucceeded })
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

  return NextResponse.json({ ok: true });
}
