import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshFxRate } from "@/lib/fx/refresh";

// Scheduled via vercel.json's crons config, per ARCHITECTURE.md's pricing
// engine step 5 ("refreshed regularly — never a hardcoded constant"). Same
// CRON_SECRET auth pattern as expire-orders (see that route for the
// caveat about verifying it against current Vercel docs).
//
// Deliberately does not fall back to a stale or guessed rate on failure:
// if the upstream FX API errors or returns something implausible,
// refreshFxRate throws before writing anything, so the previous fx_rates
// row stays the one fetchLatestFxRate reads as "latest" — pricing keeps
// working off the last known-good rate rather than being poisoned by a
// bad response.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  try {
    const row = await refreshFxRate(admin);
    return NextResponse.json({ inserted: row });
  } catch (err) {
    console.error("Failed to refresh USD_NGN fx rate:", err);
    return NextResponse.json({ error: "Failed to refresh fx rate" }, { status: 500 });
  }
}
