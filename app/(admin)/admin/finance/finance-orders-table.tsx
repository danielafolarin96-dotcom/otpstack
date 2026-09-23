import type { OrderFinanceRow } from "@/lib/finance/report";

function naira(kobo: number) {
  return `₦${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Profitability per individual number/session, worst-to-best isn't
// necessary here since callers already filter/sort by date via
// summarizeFinanceEvents (most recent first) — this is a straight render.
export function FinanceOrdersTable({ rows }: { rows: OrderFinanceRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-line bg-paper-raised px-6 text-center">
        <p className="font-display text-base font-semibold text-ink">No orders in this range</p>
        <p className="max-w-sm text-sm text-text-dim">Try a wider date range or clear the filters above.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[14px] border border-line bg-paper-raised">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-text-dim">
            <th className="px-4 py-3 font-medium">Date</th>
            <th className="px-4 py-3 font-medium">Service</th>
            <th className="px-4 py-3 font-medium">Country</th>
            <th className="px-4 py-3 font-medium">Provider</th>
            <th className="px-4 py-3 font-medium">Revenue</th>
            <th className="px-4 py-3 font-medium">Provider cost</th>
            <th className="px-4 py-3 font-medium">Payment fee</th>
            <th className="px-4 py-3 font-medium">Refund</th>
            <th className="px-4 py-3 font-medium">Gross profit</th>
            <th className="px-4 py-3 font-medium">Net profit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.orderId} className="border-b border-line last:border-0">
              <td className="whitespace-nowrap px-4 py-3 text-text-dim">{formatDate(row.createdAt)}</td>
              <td className="px-4 py-3 text-text">{row.serviceName}</td>
              <td className="px-4 py-3 text-text-dim">{row.countryName}</td>
              <td className="px-4 py-3 text-text-dim">{row.provider}</td>
              <td className="px-4 py-3 font-technical">{naira(row.revenueKobo)}</td>
              <td className="px-4 py-3 font-technical text-text-dim">{naira(row.providerCostKobo)}</td>
              <td className="px-4 py-3 font-technical text-text-dim">{naira(row.paymentFeeKobo)}</td>
              <td className="px-4 py-3 font-technical text-text-dim">
                {row.refundKobo > 0 ? naira(row.refundKobo) : "—"}
              </td>
              <td
                className={`px-4 py-3 font-technical font-medium ${
                  row.grossProfitKobo >= 0 ? "text-good" : "text-danger"
                }`}
              >
                {naira(row.grossProfitKobo)}
              </td>
              <td
                className={`px-4 py-3 font-technical font-medium ${
                  row.netProfitKobo >= 0 ? "text-good" : "text-danger"
                }`}
              >
                {naira(row.netProfitKobo)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
