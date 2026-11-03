import type { GrizzlyFallbackServiceRow } from "@/lib/providers/grizzly-fallback-report";

export function GrizzlyFallbackByServiceTable({ rows }: { rows: GrizzlyFallbackServiceRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-line bg-paper-raised px-6 text-center">
        <p className="font-display text-base font-semibold text-ink">No Grizzly no-stock events yet</p>
        <p className="max-w-sm text-sm text-text-dim">
          This fills in the first time Grizzly rejects a purchase with operator_unavailable or
          upstream_no_numbers.
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
            <th className="px-4 py-3 font-medium">Country</th>
            <th className="px-4 py-3 font-medium">Events</th>
            <th className="px-4 py-3 font-medium">Recovered</th>
            <th className="px-4 py-3 font-medium">Lost</th>
            <th className="px-4 py-3 font-medium">Recovery rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-line last:border-0">
              <td className="px-4 py-3 text-text">{row.serviceName}</td>
              <td className="px-4 py-3 text-text-dim">{row.countryName}</td>
              <td className="px-4 py-3 font-technical">{row.total}</td>
              <td className="px-4 py-3 font-technical text-good">{row.recovered}</td>
              <td className="px-4 py-3 font-technical text-danger">{row.lost}</td>
              <td className="px-4 py-3 font-technical text-text-dim">
                {row.total === 0 ? "—" : `${Math.round((row.recovered / row.total) * 1000) / 10}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
