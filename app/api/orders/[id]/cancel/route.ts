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

  try {
    await cancelOrder(order.fivesim_order_id);
  } catch (err) {
    // Continue regardless — the user still gets refunded even if 5sim's
    // own cancel call fails; we're not going to keep charging them for a
    // number they no longer want.
    console.error(`Failed to cancel upstream 5sim order ${order.fivesim_order_id}:`, err);
  }

  const { error: updateError } = await admin
    .from("orders")
    .update({ status: "cancelled_refunded", completed_at: new Date().toISOString() })
    .eq("id", order.id);
  if (updateError) {
    console.error("Failed to update order after cancel:", updateError);
    return NextResponse.json({ error: "Failed to cancel order" }, { status: 500 });
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
