import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { expireAndRefundOrder } from "@/lib/orders/expire-and-refund";

// Per ARCHITECTURE.md's order lifecycle step 5 (3-minute TTL — see
// lib/orders/purchase.ts's ORDER_TTL_MINUTES). Auth here checks
// `Authorization: Bearer $CRON_SECRET`, Vercel's documented pattern for
// securing cron routes — also what lib/qstash/client.ts forwards to this
// same route for its one-shot per-order callback (see the orderId param
// below).
//
// Trigger sources, layered (all safe to overlap — expireAndRefundOrder's
// `eq("status", "pending")` claim means only one caller ever wins a given
// order, see that file):
//   1. .github/workflows/expire-orders.yml — GitHub Actions, every 5
//      minutes (its documented floor; GitHub does not guarantee exact-time
//      firing and can run several minutes late under load). Primary sweep
//      while this project is on Vercel's Hobby plan, which only allows a
//      daily Vercel cron.
//   2. vercel.json's own cron — "0 3 * * *", once a day. A 24h backstop
//      only; was the ONLY sweep mechanism until Sept 2026, which is what
//      let pending orders sit up to a day past expires_at before this
//      route ever ran, well past 5sim's own order timeout — see this
//      change's commit message and expireAndRefundOrder's comment for the
//      resulting money-losing bug and its fix.
//   3. The status-check route's own fallback, triggered whenever a user's
//      dashboard happens to poll an order past its expires_at.
// A tighter, more reliable external pinger (e.g. Upstash QStash on a
// 2-minute schedule) is recommended over relying on GitHub Actions alone —
// see the commit message for this change.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  // ?orderId= — set by lib/qstash/client.ts's scheduleOrderExpiry, which
  // schedules one of these calls per order at exactly purchase_time + TTL
  // (see lib/orders/purchase.ts). Scopes this sweep to that one row
  // instead of every expired order, so a QStash-triggered call never waits
  // behind other orders' cancel calls the way the whole-sweep path below
  // (still used by the GitHub Actions/daily-cron backstops, unchanged)
  // does when several orders expire in the same window. Still requires
  // status='pending' and past expires_at — same atomic claim as the
  // whole-sweep path, just scoped to one id.
  const { searchParams } = new URL(request.url);
  const orderId = searchParams.get("orderId");

  let query = admin.from("orders").select("*").eq("status", "pending").lt("expires_at", new Date().toISOString());
  if (orderId) {
    query = query.eq("id", orderId);
  }
  const { data: expiredOrders, error } = await query;

  if (error) {
    console.error("Failed to fetch expired orders:", error);
    return NextResponse.json({ error: "Failed to fetch expired orders" }, { status: 500 });
  }

  const results = { processed: 0, skipped: 0, failed: 0 };
  for (const order of expiredOrders ?? []) {
    try {
      const { refunded } = await expireAndRefundOrder(admin, order);
      if (refunded) {
        results.processed += 1;
      } else {
        // Already resolved by another path (see expireAndRefundOrder's
        // comment) — not a failure, just nothing for this sweep to do.
        results.skipped += 1;
      }
    } catch (err) {
      console.error(`Failed to expire/refund order ${order.id}:`, err);
      results.failed += 1;
    }
  }

  return NextResponse.json(results);
}

// QStash's `publishJSON` delivers via HTTP POST by default (confirmed
// against the installed @upstash/qstash SDK: `method = "POST"` is its
// hardcoded default, and neither lib/qstash/client.ts's scheduleOrderExpiry
// nor this route's GitHub Actions/daily-cron callers override it) — so the
// one-shot per-order callback that function schedules hits this route as a
// POST, not a GET. Sharing the same handler keeps every trigger source
// (GitHub Actions and the daily Vercel cron both call with GET; QStash
// calls with POST) working off one code path rather than duplicating the
// sweep logic.
export const POST = GET;
