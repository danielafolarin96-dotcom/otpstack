import type { GrizzlyFallbackEventInput } from "@/lib/providers/grizzly-fallback-report";

const REASON_LABELS: Record<string, string> = {
  operator_unavailable: "Supplier dropped out of stock before purchase",
  upstream_no_numbers: "getNumberV2 rejected with NO_NUMBERS",
};

export function GrizzlyFallbackEventsTable({ events }: { events: GrizzlyFallbackEventInput[] }) {
  if (events.length === 0) {
    return (
      <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-line bg-paper-raised px-6 text-center">
        <p className="font-display text-base font-semibold text-ink">No events match</p>
        <p className="max-w-sm text-sm text-text-dim">Try clearing a filter.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[14px] border border-line bg-paper-raised">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-text-dim">
            <th className="px-4 py-3 font-medium">When</th>
            <th className="px-4 py-3 font-medium">Service</th>
            <th className="px-4 py-3 font-medium">Country</th>
            <th className="px-4 py-3 font-medium">Supplier</th>
            <th className="px-4 py-3 font-medium">Reason</th>
            <th className="px-4 py-3 font-medium">Outcome</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id} className="border-b border-line last:border-0 align-top">
              <td className="px-4 py-3 text-text-dim">
                {new Date(event.createdAt).toLocaleString("en-NG", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </td>
              <td className="px-4 py-3 text-text">{event.serviceName}</td>
              <td className="px-4 py-3 text-text-dim">{event.countryName}</td>
              <td className="px-4 py-3 font-technical text-text-dim">{event.operator ?? "—"}</td>
              <td className="px-4 py-3 text-text-dim">{REASON_LABELS[event.reason] ?? event.reason}</td>
              <td className="px-4 py-3">
                {event.recoveredByFallback ? (
                  <div className="flex flex-col gap-1">
                    <span className="w-fit rounded-full bg-good/15 px-2.5 py-1 text-xs font-medium text-good">
                      Recovered via 5sim
                    </span>
                    {event.recoveredOrderId && (
                      <span className="font-technical text-xs text-text-dim">
                        order {event.recoveredOrderId.slice(0, 8)}
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="w-fit rounded-full bg-danger/15 px-2.5 py-1 text-xs font-medium text-danger">
                    Lost — no number sold
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
