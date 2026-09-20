import type { MarginReport } from "@/lib/pricing/margin-report";

function naira(kobo: number) {
  return `₦${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
}

// Supporting detail cards, demoted below the profit headline and
// by-service table (see ProfitHeadline). Returns bare cards, not its own
// grid, so the page can lay them out alongside FiveSimAccountCards.
export function MarginSummaryCards({ report }: { report: MarginReport }) {
  return (
    <>
      <div className="rounded-[14px] border border-line bg-paper-raised p-6">
        <p className="text-sm text-text-dim">Revenue kept</p>
        <p className="mt-2 font-technical text-3xl font-bold text-ink">
          {naira(report.overall.revenueKobo)}
        </p>
        <p className="mt-1 text-xs text-text-dim">{report.overall.orderCount} orders</p>
      </div>

      <div className="rounded-[14px] border border-line bg-paper-raised p-6">
        <p className="text-sm text-text-dim">Upstream cost</p>
        <p className="mt-2 font-technical text-3xl font-bold text-ink">
          {naira(report.overall.costKobo)}
        </p>
      </div>

      <div className="rounded-[14px] border border-line bg-paper-raised p-6">
        <p className="text-sm text-text-dim">Refund cost</p>
        <p className="mt-2 font-technical text-3xl font-bold text-ink">{naira(report.refunded.costKobo)}</p>
        <p className="mt-1 text-xs text-text-dim">
          {report.refunded.orderCount} refunded order{report.refunded.orderCount === 1 ? "" : "s"}
        </p>
        <div className="mt-3 flex flex-col gap-1 border-t border-line pt-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-text-dim">Recovered from 5sim</span>
            <span className="font-technical font-semibold text-ink">
              {naira(report.refunded.recovered.costKobo)} ({report.refunded.recovered.orderCount})
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-danger">Lost to 5sim</span>
            <span className="font-technical font-semibold text-danger">
              {naira(report.refunded.lost.costKobo)} ({report.refunded.lost.orderCount})
            </span>
          </div>
          {report.refunded.unknown.orderCount > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-text-dim">Unknown (predates tracking)</span>
              <span className="font-technical font-semibold text-ink">
                {naira(report.refunded.unknown.costKobo)} ({report.refunded.unknown.orderCount})
              </span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
