import "server-only";
import type { FiveSimSmsMessage } from "@/lib/5sim/client";
import { redactGrizzlyKey } from "@/lib/grizzly/client";

// Money bug fixed Oct 2026: four orders on 2026-10-12 had their SMS land at
// 5sim within ~90s, but our orders row never picked up the code (the
// dashboard's poll loop had died on one failed fetch). The customer then
// cancelled / the order expired, we refunded the wallet, and 5sim refused
// our cancel because the order already had an SMS — so 5sim billed us for
// a number whose code the customer was owed and we'd refunded anyway. The
// cancel route and expireAndRefundOrder now ask the provider directly,
// right before claiming the order as refunded, whether an SMS already
// arrived — see fetchUpstreamState in lib/providers/upstream.ts, which
// uses the helpers below for 5sim.

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

// What gets stored in orders.upstream_cancel_error (and the cancel queue's
// last_error). FiveSimError's message is "5sim <path> failed: <status>
// <body>" and GrizzlyError's "grizzly <action> failed: <status> <body>" —
// never a URL or request headers — but both API keys are also scrubbed
// explicitly in case some future error shape ever echoes one back.
export function describeUpstreamCancelError(err: unknown): string {
  let message = err instanceof Error ? err.message : String(err);
  const apiKey = process.env.FIVESIM_API_KEY;
  if (apiKey) message = message.split(apiKey).join("[redacted]");
  return redactGrizzlyKey(message).slice(0, UPSTREAM_CANCEL_ERROR_MAX_LENGTH);
}
