import type { MarginReport } from "@/lib/pricing/margin-report";

function naira(kobo: number) {
  return `₦${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
}

export function MarginSummaryCards({ report, target }: { report: MarginReport; target: number }) {
  const onTarget = report.overall.orderCount === 0 || report.overall.marginPct >= target;

  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
      <div
        className={`rounded-[14px] border p-6 ${
          onTarget ? "border-line bg-paper-raised" : "border-danger bg-danger/5"
        }`}
      >
        <p className="text-sm text-text-dim">Realized margin</p>
        <p className={`mt-2 font-technical text-3xl font-bold ${onTarget ? "text-ink" : "text-danger"}`}>
          {report.overall.orderCount === 0 ? "—" : `${report.overall.marginPct.toFixed(1)}%`}
        </p>
        <p className="mt-1 text-xs text-text-dim">
          {report.overall.orderCount === 0
            ? "No revenue-kept orders yet"
            : `Target: ${target}%${onTarget ? "" : " — below target"}`}
        </p>
      </div>

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
        <p className="mt-1 text-xs text-text-dim">On those same orders</p>
      </div>

      <div className="rounded-[14px] border border-line bg-paper-raised p-6">
        <p className="text-sm text-text-dim">Refund cost</p>
        <p className="mt-2 font-technical text-3xl font-bold text-ink">{naira(report.refunded.costKobo)}</p>
        <p className="mt-1 text-xs text-text-dim">
          {report.refunded.orderCount} refunded order{report.refunded.orderCount === 1 ? "" : "s"} — we
          still paid 5sim, not netted above
        </p>
      </div>
    </div>
  );
}
