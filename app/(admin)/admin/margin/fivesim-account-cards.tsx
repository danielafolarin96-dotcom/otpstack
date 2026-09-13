import type { FiveSimProfile } from "@/lib/5sim/client";
import type { MarginReport } from "@/lib/pricing/margin-report";
import { convertToNgnKobo } from "@/lib/pricing/calculate";

// Below this many average-cost orders' worth of runway, the balance card
// switches to the same danger styling MarginSummaryCards uses for a
// below-target margin — ARCHITECTURE.md's admin panel section frames the
// live 5sim balance as being there "so the founder knows when to top up
// upstream," so this is the "when" made concrete. 20 is a judgment call,
// not a documented contract — there's no per-day order-volume figure
// anywhere in this codebase to size a time-based runway instead, so this
// counts orders rather than days. Revisit once real volume trends exist.
const LOW_RUNWAY_ORDER_THRESHOLD = 20;

function naira(kobo: number) {
  return `₦${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
}

export function FiveSimAccountCards({
  profile,
  profileError,
  ngnRate,
  report,
}: {
  profile: FiveSimProfile | null;
  profileError: string | null;
  ngnRate: number | null;
  report: MarginReport;
}) {
  // Real total ever paid to 5sim: refunded orders' upstream cost is not
  // netted into report.overall (see margin-report.ts — 5sim doesn't refund
  // us when we refund a customer), but it's still money that left the 5sim
  // balance, so it belongs in both the spend total and the runway estimate
  // below. report.overall.costKobo alone (the "Upstream cost" card above)
  // undercounts actual 5sim spend for that reason.
  const totalSpentKobo = report.overall.costKobo + report.refunded.costKobo;
  const totalOrders = report.overall.orderCount + report.refunded.orderCount;
  const avgCostPerOrderKobo = totalOrders > 0 ? totalSpentKobo / totalOrders : null;

  const realizedProfitKobo = report.overall.revenueKobo - report.overall.costKobo - report.refunded.costKobo;

  const balanceKobo =
    profile && ngnRate !== null ? convertToNgnKobo(profile.balance, ngnRate) : null;

  const estimatedOrdersRemaining =
    balanceKobo !== null && avgCostPerOrderKobo !== null && avgCostPerOrderKobo > 0
      ? balanceKobo / avgCostPerOrderKobo
      : null;

  const lowRunway =
    estimatedOrdersRemaining !== null && estimatedOrdersRemaining < LOW_RUNWAY_ORDER_THRESHOLD;

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      {profileError ? (
        <div className="rounded-[14px] border border-danger bg-danger/5 p-6">
          <p className="text-sm text-text-dim">5sim balance</p>
          <p className="mt-2 text-sm text-danger">Couldn&apos;t reach 5sim: {profileError}</p>
        </div>
      ) : (
        <div
          className={`rounded-[14px] border p-6 ${
            lowRunway ? "border-danger bg-danger/5" : "border-line bg-ink"
          }`}
        >
          <p className={`text-sm ${lowRunway ? "text-text-dim" : "text-paper/70"}`}>5sim balance</p>
          <p
            className={`mt-2 font-technical text-3xl font-bold ${
              lowRunway ? "text-danger" : "text-paper"
            }`}
          >
            {profile ? `$${profile.balance.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "—"}
          </p>
          <p className={`mt-1 text-xs ${lowRunway ? "text-danger" : "text-paper/70"}`}>
            {profile && balanceKobo !== null
              ? `≈ ${naira(balanceKobo)} at today's rate`
              : "NGN estimate unavailable — no fx_rates entry"}
          </p>
          {estimatedOrdersRemaining !== null && (
            <p className={`mt-1 text-xs ${lowRunway ? "text-danger" : "text-paper/70"}`}>
              {lowRunway
                ? `Only ~${Math.floor(estimatedOrdersRemaining)} orders of runway left at the current average cost — top up soon`
                : `~${Math.floor(estimatedOrdersRemaining)} orders of runway at the current average cost`}
            </p>
          )}
        </div>
      )}

      <div className="rounded-[14px] border border-line bg-paper-raised p-6">
        <p className="text-sm text-text-dim">Realized profit</p>
        <p className="mt-2 font-technical text-3xl font-bold text-ink">{naira(realizedProfitKobo)}</p>
        <p className="mt-1 text-xs text-text-dim">
          Revenue kept minus upstream cost minus refund cost ({naira(totalSpentKobo)} paid to 5sim in
          total across {totalOrders} order{totalOrders === 1 ? "" : "s"})
        </p>
      </div>
    </div>
  );
}
