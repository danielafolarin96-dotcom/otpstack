import "server-only";
import { Client } from "@upstash/qstash";

// Thin wrapper around @upstash/qstash, same one-file-per-integration shape
// as lib/5sim/client.ts/lib/fx/client.ts — the one deliberate difference
// from those two is using the official SDK instead of a plain fetch call,
// since QStash's REST contract (the exact Upstash-Forward-* header-prefix
// convention for forwarding a custom Authorization header to the
// destination) wasn't something to guess at on a money-recovery path per
// AGENT.md's "don't invent API behavior" rule — the SDK's documented
// `headers` option on publishJSON covers exactly this, verified against
// the upstash-qstash-js skill installed alongside the QStash Marketplace
// integration (see .agents/skills/upstash-qstash-js).
function qstashClient(): Client {
  return new Client({ token: process.env.QSTASH_TOKEN! });
}

// Schedules a one-shot call back to our own /api/cron/expire-orders for
// exactly this order, `delaySeconds` from now — see that route's `orderId`
// query param. Fires once, independent of any other order, which is what
// makes this safe against the batching/lag problem a recurring sweep has
// (see lib/orders/expire-and-refund.ts's comment and the commit message
// for this change): a callback scheduled for exactly purchase_time + TTL
// doesn't wait behind other orders' cancel calls the way a shared-tick
// sweep processing every expired order sequentially would.
//
// Best-effort — same pattern as lib/orders/purchase.ts's
// safeCancelUpstream: if scheduling fails (QStash unreachable, APP_URL
// unset in this environment, local dev where QStash can't reach
// localhost), the order still exists and the unchanged GitHub Actions
// (5-minute floor) and daily Vercel cron backstops still eventually catch
// it — just slower, same as before this change existed. Never throws.
export async function scheduleOrderExpiry(orderId: string, delaySeconds: number): Promise<void> {
  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    console.error("scheduleOrderExpiry: APP_URL is not set — falling back to the GitHub Actions/daily cron backstops only.");
    return;
  }

  try {
    await qstashClient().publishJSON({
      url: `${appUrl}/api/cron/expire-orders?orderId=${encodeURIComponent(orderId)}`,
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
      delay: delaySeconds,
      body: {},
    });
  } catch (err) {
    console.error(`Failed to schedule QStash expiry callback for order ${orderId}:`, err);
  }
}
