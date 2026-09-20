import { createAdminClient } from "@/lib/supabase/admin";
import { getProfile, type FiveSimProfile } from "@/lib/5sim/client";
import { fetchLatestFxRate } from "@/lib/pricing/engine";
import { summarizeMargin, TARGET_MARGIN_PCT } from "@/lib/pricing/margin-report";
import { fetchCurrentReportingEpoch } from "@/lib/pricing/reporting-epoch";
import { MarginSummaryCards } from "./margin-summary-cards";
import { MarginByServiceTable } from "./margin-by-service-table";
import { FiveSimAccountCards } from "./fivesim-account-cards";
import { ProfitHeadline } from "./profit-headline";

export default async function AdminMarginPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  const showAllTime = view === "all-time";

  const admin = createAdminClient();

  const [{ data: orders }, epoch] = await Promise.all([
    admin
      .from("orders")
      .select(
        "status, price_kobo, upstream_cost_kobo, upstream_cancel_succeeded, service_id, created_at, services(name)",
      ),
    fetchCurrentReportingEpoch(admin),
  ]);

  // Reporting-epoch feature: defaults to only counting orders since the
  // epoch was set (see lib/pricing/reporting-epoch.ts) so the headline
  // numbers reflect the fixed system, not diluted by the already-
  // understood pre-fix losses. Nothing here deletes or hides any row —
  // ?view=all-time re-runs the exact same summarizeMargin with no cutoff
  // to reach full history. If no epoch has ever been set, there's nothing
  // to filter by, so this is all-time regardless of the view param.
  const sinceEpochAt = !showAllTime && epoch ? epoch.setAt : null;

  const report = summarizeMargin(
    (orders ?? []).map((o) => ({
      status: o.status,
      priceKobo: o.price_kobo,
      upstreamCostKobo: o.upstream_cost_kobo,
      upstreamCancelSucceeded: o.upstream_cancel_succeeded,
      serviceId: o.service_id,
      serviceName: o.services?.name ?? "Unknown",
      createdAt: o.created_at,
    })),
    { sinceEpochAt },
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
      <h1 className="font-display text-2xl font-bold text-ink">Margin</h1>

      <ProfitHeadline report={report} target={TARGET_MARGIN_PCT} epoch={epoch} showAllTime={showAllTime} />

      <div>
        <h2 className="mb-3 font-display text-lg font-bold text-ink">By service</h2>
        <MarginByServiceTable rows={report.byService} target={TARGET_MARGIN_PCT} />
      </div>

      <div>
        <h2 className="mb-3 font-display text-lg font-bold text-ink">Detail</h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <MarginSummaryCards report={report} />
          <FiveSimAccountCards
            profile={profile}
            profileError={profileError}
            ngnRate={ngnRate}
            report={report}
            epochStartBalanceUsd={epoch && !showAllTime ? epoch.fivesimBalanceUsd : null}
          />
        </div>
      </div>
    </div>
  );
}
