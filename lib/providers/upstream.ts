import "server-only";
import { cancelOrder as cancelFiveSimOrder, checkOrder as checkFiveSimOrder } from "@/lib/5sim/client";
import { extractOtpCode, mapFiveSimOrderToStatus, type OrderStatus } from "@/lib/5sim/status";
import { cancelActivation, finishActivation, getActivationState } from "@/lib/grizzly/client";
import { smsArrivedAtOnOurClock } from "@/lib/grizzly/status";
import { firstSmsArrivedAt } from "@/lib/orders/upstream-sms";
import { asProviderName } from "./policy";

// One provider-neutral view of an order's upstream side, so the status
// poll, manual cancel, expiry and the cancel queue share the same logic
// for 5sim and Grizzly instead of each branching on provider.

export interface UpstreamOrderRef {
  // Missing = a row from before orders.provider existed, i.e. 5sim.
  provider?: string | null;
  provider_order_id: string;
  // Grizzly only, for judging SMS punctuality on Grizzly's own clock.
  created_at?: string;
  upstream_activation_time?: string | null;
}

export interface UpstreamState {
  // What the upstream says the order is now, in our status enum.
  status: OrderStatus;
  hasSms: boolean;
  otpCode: string | null;
  // When the first SMS arrived, on our clock (epoch ms). Null when there is
  // no SMS or no trustworthy timestamp — callers treat null as "not proven
  // on time".
  smsArrivedAt: number | null;
  // Closed upstream (cancelled or timed out) with no SMS. Neither provider
  // charges for these: Grizzly only debits when an SMS arrives, and 5sim's
  // payment history shows no debit for TIMEOUT/CANCELED orders (checked
  // 29 Oct 2026 — see ARCHITECTURE.md). So the upstream cost is recovered.
  closedWithoutSms: boolean;
}

// null = the check itself failed (logged). Callers fall back to the
// behaviour they had before upstream checks existed, never block a refund
// on the provider being reachable.
export async function fetchUpstreamState(order: UpstreamOrderRef): Promise<UpstreamState | null> {
  const provider = asProviderName(order.provider);
  try {
    if (provider === "grizzly") {
      const state = await getActivationState(order.provider_order_id);
      if (state.state === "received") {
        return {
          status: "sms_received",
          hasSms: true,
          otpCode: state.code || state.text,
          smsArrivedAt: order.created_at
            ? smsArrivedAtOnOurClock(
                { created_at: order.created_at, upstream_activation_time: order.upstream_activation_time ?? null },
                state.smsDateTime,
              )
            : null,
          closedWithoutSms: false,
        };
      }
      const cancelled = state.state === "cancelled";
      return {
        status: cancelled ? "cancelled_refunded" : "pending",
        hasSms: false,
        otpCode: null,
        smsArrivedAt: null,
        closedWithoutSms: cancelled,
      };
    }

    const fivesimOrder = await checkFiveSimOrder(order.provider_order_id);
    const sms = fivesimOrder.sms ?? [];
    const hasSms = sms.length > 0;
    return {
      status: mapFiveSimOrderToStatus(fivesimOrder),
      hasSms,
      otpCode: extractOtpCode(sms),
      smsArrivedAt: hasSms ? firstSmsArrivedAt(sms) : null,
      closedWithoutSms: !hasSms && (fivesimOrder.status === "CANCELED" || fivesimOrder.status === "TIMEOUT"),
    };
  } catch (err) {
    console.error(`Upstream ${provider} check failed for order ${order.provider_order_id}:`, err);
    return null;
  }
}

// Throws on failure — see lib/orders/upstream-cancel.ts for what callers
// do then (status re-check, cancel queue).
export async function cancelUpstream(order: UpstreamOrderRef): Promise<void> {
  if (asProviderName(order.provider) === "grizzly") {
    await cancelActivation(order.provider_order_id);
    return;
  }
  await cancelFiveSimOrder(order.provider_order_id);
}

// Marks a delivered order complete upstream. Grizzly only (setStatus 6);
// 5sim's /user/finish has never been exercised live (lib/5sim/client.ts),
// so 5sim behaviour stays exactly as before: nothing. Best-effort, never
// throws — the provider charges on SMS arrival either way.
export async function finishUpstream(order: UpstreamOrderRef): Promise<void> {
  if (asProviderName(order.provider) !== "grizzly") return;
  try {
    await finishActivation(order.provider_order_id);
  } catch (err) {
    console.error(`Failed to finish Grizzly activation ${order.provider_order_id}:`, err);
  }
}

// Shared with the 5sim-era callers; scrubs both providers' keys.
export { describeUpstreamCancelError as describeUpstreamError } from "@/lib/orders/upstream-sms";
