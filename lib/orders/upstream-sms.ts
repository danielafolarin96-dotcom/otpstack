import "server-only";
import { checkOrder, type FiveSimSmsMessage } from "@/lib/5sim/client";

// Money bug fixed Oct 2026: four orders on 2026-10-12 had their SMS land at
// 5sim within ~90s, but our orders row never picked up the code (the
// dashboard's poll loop had died on one failed fetch). The customer then
// cancelled / the order expired, we refunded the wallet, and 5sim refused
// our cancel because the order already had an SMS — so 5sim billed us for
// a number whose code the customer was owed and we'd refunded anyway. The
// cancel route and expireAndRefundOrder now ask 5sim directly, right before
// claiming the order as refunded, whether an SMS already arrived.
//
// Returns the order's sms array (empty when nothing has arrived), or null
// when the check itself failed — callers fall back to their pre-fix
// behaviour (refund) on null rather than blocking a refund on 5sim being
// reachable.
export async function fetchUpstreamSms(fivesimOrderId: string): Promise<FiveSimSmsMessage[] | null> {
  try {
    const fivesimOrder = await checkOrder(fivesimOrderId);
    return fivesimOrder.sms ?? [];
  } catch (err) {
    console.error(`Pre-refund 5sim check failed for order ${fivesimOrderId}:`, err);
    return null;
  }
}

// Earliest arrival time across the order's SMS entries, in epoch ms.
// `created_at` is the field observed on real populated sms entries (live
// /user/check calls, Oct 2026); `date` is the older documented name, kept
// as a fallback. Null when no entry carries a parseable timestamp — callers
// must treat that as "not proven on time", not as "on time".
export function firstSmsArrivedAt(sms: FiveSimSmsMessage[]): number | null {
  let earliest: number | null = null;
  for (const message of sms) {
    const raw = message.created_at ?? message.date;
    if (!raw) continue;
    const ms = new Date(raw).getTime();
    if (Number.isNaN(ms)) continue;
    if (earliest === null || ms < earliest) earliest = ms;
  }
  return earliest;
}

const UPSTREAM_CANCEL_ERROR_MAX_LENGTH = 500;

// What gets stored in orders.upstream_cancel_error. FiveSimError's message
// is "5sim <path> failed: <status> <body>" — path and response body only,
// never the request headers — but the API key is also scrubbed explicitly
// in case some future error shape ever echoes it back.
export function describeUpstreamCancelError(err: unknown): string {
  let message = err instanceof Error ? err.message : String(err);
  const apiKey = process.env.FIVESIM_API_KEY;
  if (apiKey) message = message.split(apiKey).join("[redacted]");
  return message.slice(0, UPSTREAM_CANCEL_ERROR_MAX_LENGTH);
}
