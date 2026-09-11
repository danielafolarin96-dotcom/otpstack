import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkOrder } from "@/lib/5sim/client";
import { extractOtpCode, mapFiveSimOrderToStatus, type OrderStatus } from "@/lib/5sim/status";
import { expireAndRefundOrder } from "@/lib/orders/expire-and-refund";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

interface OrderRow {
  id: string;
  user_id: string;
  status: string;
  fivesim_order_id: string;
  phone_number: string;
  otp_code: string | null;
  expires_at: string;
  price_kobo: number;
}

function serialize(order: OrderRow) {
  return {
    id: order.id,
    status: order.status,
    phoneNumber: order.phone_number,
    otpCode: order.otp_code,
    expiresAt: order.expires_at,
  };
}

async function refetchOrder(admin: SupabaseClient<Database>, id: string): Promise<OrderRow> {
  const { data, error } = await admin.from("orders").select("*").eq("id", id).single();
  if (error) throw error;
  return data as unknown as OrderRow;
}

// Polled by the dashboard's active-number panel every few seconds while an
// order is pending, per ARCHITECTURE.md's order lifecycle step 3.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
    return NextResponse.json({ order: serialize(order) });
  }

  // The cron that's supposed to sweep expired orders can't fire on its own
  // yet (no Vercel project connected — see app/api/cron/expire-orders's
  // comment), so a user polling their own expired order is what actually
  // resolves it today.
  if (new Date(order.expires_at).getTime() <= Date.now()) {
    const { refunded } = await expireAndRefundOrder(admin, order);
    if (refunded) {
      return NextResponse.json({ order: { ...serialize(order), status: "expired_refunded" } });
    }
    // Someone else (e.g. this same order's sms_received update below, on a
    // near-simultaneous request) already resolved it — report what it
    // actually became, not what we assumed.
    return NextResponse.json({ order: serialize(await refetchOrder(admin, order.id)) });
  }

  let fivesimOrder;
  try {
    fivesimOrder = await checkOrder(order.fivesim_order_id);
  } catch (err) {
    console.error(`Failed to check 5sim order ${order.fivesim_order_id}:`, err);
    return NextResponse.json({ order: serialize(order) }); // degrade gracefully, keep last known state
  }

  const mappedStatus = mapFiveSimOrderToStatus(fivesimOrder);
  if (mappedStatus === order.status) {
    return NextResponse.json({ order: serialize(order) });
  }

  // "banned" deliberately gets no refund here — see ARCHITECTURE.md's
  // status enum: expired_refunded/cancelled_refunded are the only refund
  // paths, banned is its own terminal state. Only sms_received and banned
  // can reach this branch (cancelled/expired are handled by the cancel
  // route and the fallback above, not by 5sim spontaneously reporting them
  // mid-poll).
  const otpCode = mappedStatus === "sms_received" ? extractOtpCode(fivesimOrder.sms) : null;
  // mappedStatus can't be "pending" here — the equality check above would
  // have already returned if it matched order.status, which is "pending"
  // in this branch (line 48 returned early otherwise) — so completed_at
  // always applies, no need to branch on it.
  const updates: { status: OrderStatus; otp_code?: string; completed_at: string } = {
    status: mappedStatus,
    completed_at: new Date().toISOString(),
  };
  if (otpCode) updates.otp_code = otpCode;

  // Audit fix: only apply this update if the order is still 'pending' right
  // now — otherwise the cron/expiry fallback could have resolved it
  // (expired_refunded) between our read above and this write, and we'd
  // overwrite that with sms_received despite the user having already been
  // refunded for it.
  const { data: updated, error: updateError } = await admin
    .from("orders")
    .update(updates)
    .eq("id", order.id)
    .eq("status", "pending")
    .select()
    .maybeSingle();
  if (updateError) throw updateError;

  if (!updated) {
    console.log(
      `Order ${order.id} was already resolved by another path during status poll — reporting its actual state instead of overwriting it.`,
    );
    return NextResponse.json({ order: serialize(await refetchOrder(admin, order.id)) });
  }

  return NextResponse.json({ order: serialize(updated) });
}
