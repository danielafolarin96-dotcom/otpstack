import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile, type FiveSimProfile } from "@/lib/5sim/client";
import { fetchLatestFxRate } from "@/lib/pricing/engine";
import { summarizeMargin, TARGET_MARGIN_PCT } from "@/lib/pricing/margin-report";
import { MarginSummaryCards } from "./margin-summary-cards";
import { MarginByServiceTable } from "./margin-by-service-table";
import { FiveSimAccountCards } from "./fivesim-account-cards";

export default async function AdminMarginPage() {
  const admin = createAdminClient();

  const { data: orders } = await admin
    .from("orders")
    .select("status, price_kobo, upstream_cost_kobo, upstream_cancel_succeeded, service_id, services(name)");

  const report = summarizeMargin(
    (orders ?? []).map((o) => ({
      status: o.status,
      priceKobo: o.price_kobo,
      upstreamCostKobo: o.upstream_cost_kobo,
      upstreamCancelSucceeded: o.upstream_cancel_succeeded,
      serviceId: o.service_id,
      serviceName: o.services?.name ?? "Unknown",
    })),
  );

  // Live server-side call, every render — ARCHITECTURE.md's admin panel
  // section calls for "current 5sim account balance (server-side check, so
  // the founder knows when to top up upstream)," which rules out caching
  // this. Same degrade-gracefully pattern as the Overview page: a 5sim
  // outage or a missing fx_rates row shouldn't take down the whole margin
  // report, just the account card's live pieces.
  let profile: FiveSimProfile | null = null;
  let profileError: string | null = null;
  try {
    profile = await getProfile();
  } catch (err) {
    profileError = err instanceof Error ? err.message : "Unknown error";
  }

  let ngnRate: number | null = null;
  try {
    ngnRate = await fetchLatestFxRate(admin, "USD_NGN");
  } catch {
    ngnRate = null;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Margin</h1>
        <p className="text-sm text-text-dim">
          Realized gross margin against the {TARGET_MARGIN_PCT}% target, from what orders actually
          charged and actually cost — not the quote-time floor. 5sim&apos;s charged price can drift
          from the quote by purchase time (see lib/orders/purchase.ts), so this is what actually
          landed.
        </p>
      </div>

      <MarginSummaryCards report={report} target={TARGET_MARGIN_PCT} />

      <FiveSimAccountCards profile={profile} profileError={profileError} ngnRate={ngnRate} report={report} />

      <div>
        <h2 className="mb-3 font-display text-lg font-bold text-ink">By service</h2>
        <p className="mb-3 text-sm text-text-dim">Worst margin first — these are the first to check.</p>
        <MarginByServiceTable rows={report.byService} target={TARGET_MARGIN_PCT} />
      </div>
    </div>
  );
}
