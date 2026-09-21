import type { ServiceMarginRow } from "@/lib/pricing/margin-report";

function naira(kobo: number) {
  return `₦${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
}

export function MarginByServiceTable({ rows, target }: { rows: ServiceMarginRow[]; target: number }) {
  if (rows.length === 0) {
    return (
      <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-line bg-paper-raised px-6 text-center">
        <p className="font-display text-base font-semibold text-ink">No revenue-kept orders yet</p>
        <p className="max-w-sm text-sm text-text-dim">
          This fills in once orders start landing as pending, delivered, or banned.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[14px] border border-line bg-paper-raised">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-text-dim">
            <th className="px-4 py-3 font-medium">Service</th>
            <th className="px-4 py-3 font-medium">Orders</th>
            <th className="px-4 py-3 font-medium">Revenue</th>
            <th className="px-4 py-3 font-medium">Cost</th>
            <th className="px-4 py-3 font-medium">Profit</th>
            <th className="px-4 py-3 font-medium">Margin</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            // Compare the same rounded value that's displayed — otherwise
            // a row can show "44.7%" (rounded from 44.698...) yet be
            // colored as below a 44.7% target, which reads as a bug.
            const displayMarginPct = Number(row.marginPct.toFixed(1));
            const belowTarget = displayMarginPct < target;
            return (
              <tr key={row.serviceId} className="border-b border-line last:border-0">
                <td className="px-4 py-3 text-text">{row.serviceName}</td>
                <td className="px-4 py-3 text-text-dim">{row.orderCount}</td>
                <td className="px-4 py-3 font-technical">{naira(row.revenueKobo)}</td>
                <td className="px-4 py-3 font-technical text-text-dim">{naira(row.costKobo)}</td>
                <td
                  className={`px-4 py-3 font-technical font-medium ${
                    row.profitKobo >= 0 ? "text-good" : "text-danger"
                  }`}
                >
                  {naira(row.profitKobo)}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full px-2.5 py-1 font-technical text-xs font-medium ${
                      belowTarget ? "bg-danger/15 text-danger" : "bg-good/15 text-good"
                    }`}
                  >
                    {displayMarginPct.toFixed(1)}%
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
