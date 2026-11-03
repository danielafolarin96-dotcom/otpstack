import type { GrizzlyFallbackSummary } from "@/lib/providers/grizzly-fallback-report";

export function GrizzlyFallbackSummaryCards({ summary }: { summary: GrizzlyFallbackSummary }) {
  return (
    <div className="grid gap-6 sm:grid-cols-3">
      <div className="rounded-[14px] border border-line bg-paper-raised p-6">
        <p className="text-sm text-text-dim">Grizzly no-stock events</p>
        <p className="mt-2 font-technical text-3xl font-bold text-ink">{summary.total.toLocaleString("en-NG")}</p>
        <p className="mt-1 text-xs text-text-dim">All time — operator_unavailable / upstream_no_numbers</p>
      </div>

      <div className="rounded-[14px] border border-line bg-paper-raised p-6">
        <p className="text-sm text-text-dim">Recovered via 5sim</p>
        <p className="mt-2 font-technical text-3xl font-bold text-good">
          {summary.recovered.toLocaleString("en-NG")}
        </p>
        <p className="mt-1 text-xs text-text-dim">
          {summary.total === 0 ? "No events yet" : `${summary.recoveryRatePct}% recovery rate`}
        </p>
      </div>

      <div className="rounded-[14px] border border-line bg-paper-raised p-6">
        <p className="text-sm text-text-dim">Lost (5sim had nothing either)</p>
        <p className="mt-2 font-technical text-3xl font-bold text-danger">
          {summary.lost.toLocaleString("en-NG")}
        </p>
        <p className="mt-1 text-xs text-text-dim">Customer saw &quot;no numbers available&quot;</p>
      </div>
    </div>
  );
}
