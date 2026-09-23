import type { FiveSimProfile } from "@/lib/5sim/client";
import type { MarginReport } from "@/lib/pricing/margin-report";
import { convertToNgnKobo } from "@/lib/pricing/calculate";

// Below this many average-cost orders' worth of runway, the balance card
// switches to danger styling — ARCHITECTURE.md's admin panel section frames
// the live 5sim balance as being there "so the founder knows when to top up
// upstream," so this is the "when" made concrete. 20 is a judgment call,
// not a documented contract — there's no per-day order-volume figure
// anywhere in this codebase to size a time-based runway instead, so this
// counts orders rather than days. Revisit once real volume trends exist.
const LOW_RUNWAY_ORDER_THRESHOLD = 20;

function naira(kobo: number) {
  return `₦${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
}

// The page's visual lead (moved here from the old detail-grid card, per
// explicit request: the 5sim balance/runway is "the first thing I see,
// since that's what tells me if I need to act" — realized profit is now
// the smaller, demoted stat, see profit-stat-card.tsx).
export function FiveSimBalanceHero({
  profile,
  profileError,
  ngnRate,
  report,
  epochStartBalanceUsd,
}: {
  profile: FiveSimProfile | null;
  profileError: string | null;
  ngnRate: number | null;
  report: MarginReport;
  // The 5sim balance recorded when the current reporting epoch was set — a
  // reference point ("started at $X, now at $Y"), not used in any
  // calculation here. Null when viewing all-time or when no epoch is set.
  epochStartBalanceUsd: number | null;
}) {
  // Real total ever paid to 5sim: refunded orders' upstream cost is not
  // netted into report.overall (see margin-report.ts — 5sim doesn't refund
  // us when we refund a customer), but it's still money that left the 5sim
  // balance, so it belongs in both the spend total and the runway estimate
  // below. report.overall.costKobo alone undercounts actual 5sim spend for
  // that reason.
  const totalSpentKobo = report.overall.costKobo + report.refunded.costKobo;
  const totalOrders = report.overall.orderCount + report.refunded.orderCount;
  const avgCostPerOrderKobo = totalOrders > 0 ? totalSpentKobo / totalOrders : null;

  const balanceKobo = profile && ngnRate !== null ? convertToNgnKobo(profile.balance, ngnRate) : null;

  const estimatedOrdersRemaining =
    balanceKobo !== null && avgCostPerOrderKobo !== null && avgCostPerOrderKobo > 0
      ? balanceKobo / avgCostPerOrderKobo
      : null;

  const lowRunway =
    estimatedOrdersRemaining !== null && estimatedOrdersRemaining < LOW_RUNWAY_ORDER_THRESHOLD;

  if (profileError) {
    return (
      <div className="rounded-[14px] border border-danger bg-danger/5 p-6 sm:p-8">
        <p className="text-sm text-text-dim">5sim balance</p>
        <p className="mt-2 text-sm text-danger">Couldn&apos;t reach 5sim: {profileError}</p>
      </div>
    );
  }

  return (
    <div className={`rounded-[14px] border p-6 sm:p-8 ${lowRunway ? "border-danger bg-danger/5" : "border-line bg-ink"}`}>
      <p className={`text-sm ${lowRunway ? "text-text-dim" : "text-paper/70"}`}>5sim balance</p>
      <p
        className={`mt-1 font-technical text-4xl font-bold sm:text-5xl ${
          lowRunway ? "text-danger" : "text-paper"
        }`}
      >
        {profile ? `$${profile.balance.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "—"}
      </p>
      <p className={`mt-2 text-sm ${lowRunway ? "text-danger" : "text-paper/70"}`}>
        {profile && balanceKobo !== null
          ? `≈ ${naira(balanceKobo)} at today's rate`
          : "NGN estimate unavailable — no fx_rates entry"}
      </p>
      {estimatedOrdersRemaining !== null && (
        <p className={`mt-1 text-sm ${lowRunway ? "text-danger" : "text-paper/70"}`}>
          {lowRunway
            ? `Only ~${Math.floor(estimatedOrdersRemaining)} orders of runway left at the current average cost — top up soon`
            : `~${Math.floor(estimatedOrdersRemaining)} orders of runway at the current average cost`}
        </p>
      )}
      {epochStartBalanceUsd !== null && (
        <p className={`mt-1 text-sm ${lowRunway ? "text-danger" : "text-paper/70"}`}>
          Baseline: ${epochStartBalanceUsd.toLocaleString("en-US", { minimumFractionDigits: 2 })}
        </p>
      )}
    </div>
  );
}
