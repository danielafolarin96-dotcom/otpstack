import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { cancelOrder } from "@/lib/5sim/client";
import { extractOtpCode } from "@/lib/5sim/status";
import { describeUpstreamCancelError, fetchUpstreamSms, firstSmsArrivedAt } from "@/lib/orders/upstream-sms";
import { recordWalletTransaction } from "@/lib/wallet/ledger";
import { recordFinanceEvent } from "@/lib/finance/ledger";

interface ExpirableOrder {
  id: string;
  user_id: string;
  fivesim_order_id: string;
  price_kobo: number;
  upstream_cost_kobo: number;
  service_id: string;
  country_code: string;
  expires_at: string;
}

export interface ExpireResult {
  // false means no refund was issued, callers must not assume
  // "expired_refunded" happened: either another path (a late-arriving SMS,
  // a manual cancel) already resolved this order between the caller's read
  // and this call, or the pre-refund 5sim check below found the SMS had
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
  // An SMS that reached 5sim at or before our own expires_at means the
  // customer's code arrived inside the window they paid for — deliver it,
  // no refund (5sim will bill us for it regardless; its cancel refuses an
  // order that has SMS). One that landed after expires_at is late by our
  // own terms, so the customer is still refunded as before. A failed check,
  // or an SMS with no parseable timestamp, also refunds as before.
  const upstreamSms = await fetchUpstreamSms(order.fivesim_order_id);
  if (upstreamSms && upstreamSms.length > 0) {
    const arrivedAt = firstSmsArrivedAt(upstreamSms);
    if (arrivedAt !== null && arrivedAt <= new Date(order.expires_at).getTime()) {
      const updates: { status: "sms_received"; completed_at: string; otp_code?: string } = {
        status: "sms_received",
        completed_at: new Date().toISOString(),
      };
      const otpCode = extractOtpCode(upstreamSms);
      if (otpCode) updates.otp_code = otpCode;

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
      console.log(`Order ${order.id} had an on-time SMS at 5sim — recorded as sms_received, no refund.`);
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

  // 5sim's own docs (https://5sim.net/docs, "Buy activation number" ->
  // Request limits: "Maximum waiting time is 15 minutes. Timeout no sms 5
  // minute") put an activation order's no-SMS auto-timeout at ~5 minutes —
  // shorter than our own 10-minute TTL, and confirmed empirically (Sept
  // 2026): every cancel we observed succeeding upstream landed within ~4
  // minutes of purchase; the one we have on record attempted at ~15
  // minutes had already flipped to TIMEOUT upstream and failed. So a
  // failure here is genuinely expected often, even with a fast sweep — see
  // the money-flow note in this change's commit message.
  let upstreamCancelSucceeded = false;
  let upstreamCancelError: string | null = null;
  try {
    await cancelOrder(order.fivesim_order_id);
    upstreamCancelSucceeded = true;
  } catch (err) {
    console.error(`Failed to cancel upstream 5sim order ${order.fivesim_order_id} on expiry:`, err);
    upstreamCancelError = describeUpstreamCancelError(err);
  }

  // Best-effort: feeds the admin Margin page's recovered-vs-lost split
  // (lib/pricing/margin-report.ts), plus 5sim's own reason when the cancel
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
      provider: recognized?.provider ?? "5sim",
      revenueKobo: -order.price_kobo,
      providerCostKobo: upstreamCancelSucceeded ? -order.upstream_cost_kobo : 0,
      paymentFeeKobo: recognized ? -recognized.payment_fee_kobo : 0,
    });
  } catch (err) {
    console.error(`Failed to record finance_events refund for order ${order.id}:`, err);
  }

  return { refunded: true };
}
