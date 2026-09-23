import type { FinanceTotals } from "@/lib/finance/report";

function naira(kobo: number) {
  return `₦${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
}

function Stat({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string;
  tone?: "good" | "danger";
  sub?: string;
}) {
  return (
    <div className="rounded-[14px] border border-line bg-paper-raised p-6">
      <p className="text-sm text-text-dim">{label}</p>
      <p
        className={`mt-2 font-technical text-2xl font-bold ${
          tone === "good" ? "text-good" : tone === "danger" ? "text-danger" : "text-ink"
        }`}
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-text-dim">{sub}</p>}
    </div>
  );
}

// The 8 figures ARCHITECTURE.md's Finance & Profit Tracking spec calls for:
// Total Revenue, Total Provider Costs, Total Payment Fees, Total Refunds,
// Gross Profit, Net Profit, Gross Margin %, Net Margin %. All are sums over
// finance_events (see lib/finance/report.ts) for whatever filter/date range
// is currently selected — never the selling price alone.
export function FinanceSummaryCards({ totals }: { totals: FinanceTotals }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Stat label="Total revenue" value={naira(totals.revenueKobo)} sub={`${totals.orderCount} orders`} />
      <Stat label="Total provider costs" value={naira(totals.providerCostKobo)} />
      <Stat label="Total payment fees" value={naira(totals.paymentFeeKobo)} />
      <Stat
        label="Total refunds"
        value={naira(totals.refundKobo)}
        sub={`${totals.refundedOrderCount} refunded order${totals.refundedOrderCount === 1 ? "" : "s"}`}
      />
      <Stat
        label="Gross profit"
        value={naira(totals.grossProfitKobo)}
        tone={totals.grossProfitKobo >= 0 ? "good" : "danger"}
        sub={`Revenue − provider cost`}
      />
      <Stat
        label="Net profit"
        value={naira(totals.netProfitKobo)}
        tone={totals.netProfitKobo >= 0 ? "good" : "danger"}
        sub={`Revenue − provider cost − fees − refunds`}
      />
      <Stat label="Gross margin" value={`${totals.grossMarginPct.toFixed(1)}%`} />
      <Stat label="Net margin" value={`${totals.netMarginPct.toFixed(1)}%`} />
    </div>
  );
}
