import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { fetchUpstreamState, finishUpstream } from "@/lib/providers/upstream";
import { asProviderName } from "@/lib/providers/policy";
import { cancelUpstreamWithRecovery } from "@/lib/orders/upstream-cancel-queue";
import { recordWalletTransaction } from "@/lib/wallet/ledger";
import { recordFinanceEvent } from "@/lib/finance/ledger";

interface ExpirableOrder {
  id: string;
  user_id: string;
  // Missing on rows from before orders.provider existed = 5sim.
  provider?: string | null;
  provider_order_id: string;
  // Grizzly only: SMS punctuality is judged against these (see
  // lib/grizzly/status.ts's smsArrivedAtOnOurClock).
  created_at?: string;
  upstream_activation_time?: string | null;
  price_kobo: number;
  upstream_cost_kobo: number;
  service_id: string;
  country_code: string;
  expires_at: string;
}

// Product decision (1 Nov 2026): a Grizzly SMS whose arrival time can't be
// established (Grizzly sent no usable dateTime, or we have no activation
// time to measure it against) is still delivered rather than refunded when
// the expiry check runs within this long after expires_at — the normal
// case for the QStash callback (TTL + 10s). Grizzly charges us for that SMS
// whether or not the customer gets it, and that soon after expiry it
// almost certainly arrived inside the hold. Later than this, an
// unprovable SMS is refunded as before.
const UNKNOWN_ARRIVAL_DELIVERY_GRACE_MS = 60_000;

export interface ExpireResult {
  // false means no refund was issued, callers must not assume
  // "expired_refunded" happened: either another path (a late-arriving SMS,
  // a manual cancel) already resolved this order between the caller's read
  // and this call, or the pre-refund upstream check below found the SMS had
  // arrived in time (smsReceived: true — the order is now sms_received).
  refunded: boolean;
  smsReceived?: boolean;
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
  // See lib/orders/upstream-sms.ts for the incident behind this pre-check.
  // An SMS that reached the provider at or before our own expires_at means
  // the customer's code arrived inside the window they paid for — deliver
  // it, no refund (the provider bills us for it regardless; neither will
  // cancel an order that has SMS). One that landed after expires_at is late
  // by our own terms, so the customer is still refunded as before. A failed
  // check, or an SMS with no trustworthy timestamp, also refunds as before.
  const upstream = await fetchUpstreamState(order);
  if (upstream?.hasSms) {
    const arrivedAt = upstream.smsArrivedAt;
    const expiresAtMs = new Date(order.expires_at).getTime();
    const deliver =
      arrivedAt !== null
        ? arrivedAt <= expiresAtMs
        : asProviderName(order.provider) === "grizzly" && Date.now() <= expiresAtMs + UNKNOWN_ARRIVAL_DELIVERY_GRACE_MS;
    if (deliver) {
      const updates: { status: "sms_received"; completed_at: string; otp_code?: string } = {
        status: "sms_received",
        completed_at: new Date().toISOString(),
      };
      if (upstream.otpCode) updates.otp_code = upstream.otpCode;

      // Same first-claim-wins guard as the expiry claim below.
      const { data: delivered, error: deliverError } = await admin
        .from("orders")
        .update(updates)
        .eq("id", order.id)
        .eq("status", "pending")
        .select()
        .maybeSingle();
      if (deliverError) throw deliverError;

      if (!delivered) {
        console.log(`Order ${order.id} was already resolved by another path before its on-time SMS was recorded.`);
        return { refunded: false };
      }
      console.log(`Order ${order.id} had an on-time SMS upstream — recorded as sms_received, no refund.`);
      await finishUpstream(order);
      return { refunded: false, smsReceived: true };
    }
  }

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

  // Cancel upstream so the number can't bill us later. If the cancel fails
  // but the provider shows the order already closed with no SMS, the cost
  // is still recovered (5sim's TIMEOUT included — confirmed against 5sim's
  // payment history, 29 Oct 2026). A Grizzly cancel still inside its
  // ~5-minute lock is queued for retry; if that retry later succeeds,
  // lib/orders/upstream-cancel-queue.ts records the recovery.
  const { succeeded: upstreamCancelSucceeded, error: upstreamCancelError } = await cancelUpstreamWithRecovery(
    admin,
    order,
  );

  // Best-effort: feeds the admin Margin page's recovered-vs-lost split
  // (lib/pricing/margin-report.ts), plus the provider's own reason when the cancel
  // failed. Not money-critical — if this write fails, the refund below
  // still happens; the order just won't be attributed to either bucket on
  // the Margin page.
  const { error: markError } = await admin
    .from("orders")
    .update({ upstream_cancel_succeeded: upstreamCancelSucceeded, upstream_cancel_error: upstreamCancelError })
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

  // Reverses the revenue_recognized event written atomically at purchase
  // time (create_order_and_debit_wallet) — looked up rather than
  // recomputed, since payment_fee_kobo isn't stored on orders and a
  // recompute against today's fee schedule could drift from what was
  // actually recognized if the schedule changed since. Provider cost is
  // only reversed when the upstream cancel actually succeeded above — same
  // recovered-vs-lost distinction lib/pricing/margin-report.ts already
  // tracks via upstream_cancel_succeeded. Best-effort: a failure here
  // doesn't block or reverse the refund the customer already received.
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
      provider: recognized?.provider ?? asProviderName(order.provider),
      revenueKobo: -order.price_kobo,
      providerCostKobo: upstreamCancelSucceeded ? -order.upstream_cost_kobo : 0,
      paymentFeeKobo: recognized ? -recognized.payment_fee_kobo : 0,
    });
  } catch (err) {
    console.error(`Failed to record finance_events refund for order ${order.id}:`, err);
  }

  return { refunded: true };
}
