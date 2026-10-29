import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { OrderStatus } from "@/lib/5sim/status";
import { fetchUpstreamState, finishUpstream } from "@/lib/providers/upstream";
import { asProviderName, customerCanCancel } from "@/lib/providers/policy";
import { expireAndRefundOrder } from "@/lib/orders/expire-and-refund";
import { recordWalletTransaction } from "@/lib/wallet/ledger";
import { recordFinanceEvent } from "@/lib/finance/ledger";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type OrderRow = Database["public"]["Tables"]["orders"]["Row"];

function serialize(order: OrderRow) {
  return {
    id: order.id,
    status: order.status,
    phoneNumber: order.phone_number,
    otpCode: order.otp_code,
    expiresAt: order.expires_at,
    canCancel: customerCanCancel(order.provider),
  };
}

async function refetchOrder(admin: SupabaseClient<Database>, id: string): Promise<OrderRow> {
  const { data, error } = await admin.from("orders").select("*").eq("id", id).single();
  if (error) throw error;
  return data as OrderRow;
}

// Polled by the dashboard's active-number panel every few seconds while an
// order is pending, per ARCHITECTURE.md's order lifecycle step 3. Works
// for both providers via lib/providers/upstream.ts.
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

  // A user polling their own expired order also resolves it, as a fallback
  // to the QStash callback and the backstop sweeps.
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

  const upstream = await fetchUpstreamState(order);
  if (!upstream) {
    return NextResponse.json({ order: serialize(order) }); // degrade gracefully, keep last known state
  }

  const mappedStatus = upstream.status;
  if (mappedStatus === order.status) {
    return NextResponse.json({ order: serialize(order) });
  }

  // "banned" deliberately gets no refund here — see ARCHITECTURE.md's
  // status enum: expired_refunded/cancelled_refunded are the only refund
  // paths, banned is its own terminal state.
  const otpCode = mappedStatus === "sms_received" ? upstream.otpCode : null;
  // mappedStatus can't be "pending" here (the equality check above
  // returned), so completed_at always applies.
  const updates: {
    status: OrderStatus;
    otp_code?: string;
    completed_at: string;
    upstream_cancel_succeeded?: boolean;
  } = {
    status: mappedStatus,
    completed_at: new Date().toISOString(),
  };
  if (otpCode) updates.otp_code = otpCode;
  const closedUpstream = mappedStatus === "expired_refunded" || mappedStatus === "cancelled_refunded";
  // The provider closed the order itself with no SMS, so it never charged
  // us (decision 6, 29 Oct 2026): the cost is recovered, nothing to cancel.
  if (closedUpstream) updates.upstream_cancel_succeeded = upstream.closedWithoutSms;

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

  if (mappedStatus === "sms_received") {
    await finishUpstream(order);
  }

  // Money bug fixed Sept 2026: a provider's own TIMEOUT/CANCELED can arrive
  // before our TTL fallback or a manual cancel gets a chance to run, and
  // used to be written as a refunded status without ever crediting the
  // wallet. Same reference format as the other refund paths
  // (refund_expired_<id> / refund_cancelled_<id>), so a near-simultaneous
  // refund of this exact order by one of them is a safe no-op here, not a
  // double refund.
  if (closedUpstream) {
    await recordWalletTransaction(admin, {
      userId: updated.user_id,
      type: "refund",
      amountKobo: updated.price_kobo,
      reference: `refund_${mappedStatus === "expired_refunded" ? "expired" : "cancelled"}_${updated.id}`,
      orderId: updated.id,
    });

    // Reverses the revenue_recognized event, like every other refund path
    // (this branch used to skip it). Best-effort: never blocks the refund.
    try {
      const { data: recognized } = await admin
        .from("finance_events")
        .select("provider, payment_fee_kobo")
        .eq("order_id", updated.id)
        .eq("event_type", "revenue_recognized")
        .maybeSingle();

      await recordFinanceEvent(admin, {
        orderId: updated.id,
        userId: updated.user_id,
        eventType: "refund_issued",
        serviceId: updated.service_id,
        countryCode: updated.country_code,
        provider: recognized?.provider ?? asProviderName(updated.provider),
        revenueKobo: -updated.price_kobo,
        providerCostKobo: upstream.closedWithoutSms ? -updated.upstream_cost_kobo : 0,
        paymentFeeKobo: recognized ? -recognized.payment_fee_kobo : 0,
      });
    } catch (err) {
      console.error(`Failed to record finance_events refund for order ${updated.id}:`, err);
    }
  }

  return NextResponse.json({ order: serialize(updated) });
}
