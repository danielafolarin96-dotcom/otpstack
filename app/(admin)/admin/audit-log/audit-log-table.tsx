type AuditLogRow = {
  id: string;
  action: string;
  target_type: string;
  target_id: string;
  reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  users: { email: string; username: string; full_name: string } | null;
};

const ACTION_META: Record<string, { label: string; className: string }> = {
  "pricing_rule.create": { label: "Pricing rule created", className: "bg-good/15 text-good" },
  "pricing_rule.delete": { label: "Pricing rule deleted", className: "bg-danger/15 text-danger" },
  "user.freeze": { label: "Account frozen", className: "bg-danger/15 text-danger" },
  "user.unfreeze": { label: "Account unfrozen", className: "bg-good/15 text-good" },
  "order.manual_refund": { label: "Manual refund", className: "bg-amber/15 text-amber" },
};

function formatNaira(kobo: number) {
  return `₦${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
}

// Each action writes a different metadata shape (see lib/audit/log.ts's
// callers) — this turns that into a short readable line instead of a raw
// JSON dump. Falls back to JSON for any action added later that isn't
// handled here yet, so the page never breaks on an unrecognized shape.
function formatDetails(action: string, metadata: Record<string, unknown>): string {
  switch (action) {
    case "pricing_rule.create":
    case "pricing_rule.delete": {
      const scope = String(metadata.scope ?? "—");
      const markupType = String(metadata.markup_type ?? "—");
      const markupValue = metadata.markup_value;
      const minMargin = metadata.min_margin_pct;
      return `scope: ${scope} · markup: ${markupType} ${
        typeof markupValue === "object" ? JSON.stringify(markupValue) : String(markupValue)
      } · min margin: ${minMargin}%`;
    }
    case "user.freeze":
    case "user.unfreeze": {
      const prev = metadata.previous_state ? "frozen" : "active";
      const next = metadata.new_state ? "frozen" : "active";
      return `${prev} → ${next}`;
    }
    case "order.manual_refund": {
      const amount = typeof metadata.amount_kobo === "number" ? formatNaira(metadata.amount_kobo) : "—";
      return `${amount} refunded (was ${metadata.previous_status ?? "—"})`;
    }
    default:
      return JSON.stringify(metadata);
  }
}

export function AuditLogTable({ entries }: { entries: AuditLogRow[] }) {
  if (entries.length === 0) {
    return (
      <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-line bg-paper-raised px-6 text-center">
        <p className="font-display text-lg font-semibold text-ink">No entries match</p>
        <p className="max-w-sm text-sm text-text-dim">
          Try clearing a filter, or check back once an admin takes an action.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[14px] border border-line bg-paper-raised">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-text-dim">
            <th className="px-4 py-3 font-medium">When</th>
            <th className="px-4 py-3 font-medium">Admin</th>
            <th className="px-4 py-3 font-medium">Action</th>
            <th className="px-4 py-3 font-medium">Target</th>
            <th className="px-4 py-3 font-medium">Details</th>
            <th className="px-4 py-3 font-medium">Reason</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const meta = ACTION_META[entry.action] ?? {
              label: entry.action,
              className: "bg-slate/15 text-slate",
            };
            return (
              <tr key={entry.id} className="border-b border-line last:border-0 align-top">
                <td className="px-4 py-3 text-text-dim">
                  {new Date(entry.created_at).toLocaleString("en-NG", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col">
                    <span className="text-text">
                      {entry.users?.full_name || entry.users?.username || "—"}
                    </span>
                    <span className="text-xs text-text-dim">{entry.users?.email ?? "—"}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${meta.className}`}>
                    {meta.label}
                  </span>
                </td>
                <td className="px-4 py-3 font-technical text-xs text-text-dim">
                  {entry.target_type} · {entry.target_id.slice(0, 8)}
                </td>
                <td className="px-4 py-3 text-text-dim">{formatDetails(entry.action, entry.metadata)}</td>
                <td className="px-4 py-3 max-w-xs text-text-dim">{entry.reason ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
