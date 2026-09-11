import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { expireAndRefundOrder } from "@/lib/orders/expire-and-refund";

// Scheduled via vercel.json's crons config, per ARCHITECTURE.md's order
// lifecycle step 5. Two things worth flagging:
//
// 1. Auth here checks `Authorization: Bearer $CRON_SECRET`, which is
//    Vercel's documented pattern for securing cron routes when CRON_SECRET
//    is set as a project env var — verify this against current Vercel
//    docs before relying on it in production; unlike the 5sim/Paystack
//    pieces in this codebase, this wasn't built against a live example.
// 2. This route cannot actually fire on its own schedule yet — no Vercel
//    project is connected to this repo (checked earlier: no vercel.json,
//    no deployment). Until it is, lib/orders/expire-and-refund.ts's other
//    caller — the status-check route's fallback — is what actually
//    resolves expired orders, triggered whenever a user's own dashboard
//    happens to poll them.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: expiredOrders, error } = await admin
    .from("orders")
    .select("*")
    .eq("status", "pending")
    .lt("expires_at", new Date().toISOString());

  if (error) {
    console.error("Failed to fetch expired orders:", error);
    return NextResponse.json({ error: "Failed to fetch expired orders" }, { status: 500 });
  }

  const results = { processed: 0, failed: 0 };
  for (const order of expiredOrders ?? []) {
    try {
      await expireAndRefundOrder(admin, order);
      results.processed += 1;
    } catch (err) {
      console.error(`Failed to expire/refund order ${order.id}:`, err);
      results.failed += 1;
    }
  }

  return NextResponse.json(results);
}
