import type { ReportingEpoch } from "@/lib/pricing/reporting-epoch";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}

// Toggle between the default (since-epoch) and all-time views — plain
// links + a searchParam, not client state, so this stays a server
// component like the rest of this page. Never hides or deletes anything:
// ?view=all-time re-runs the same summarizeMargin with no cutoff.
export function ReportingEpochBanner({
  epoch,
  showAllTime,
}: {
  epoch: ReportingEpoch | null;
  showAllTime: boolean;
}) {
  if (!epoch) {
    return (
      <div className="rounded-[14px] border border-line bg-paper-raised px-4 py-3 text-sm text-text-dim">
        All-time — no reporting epoch set.
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-line bg-paper-raised px-4 py-3">
      <p className="text-sm text-text-dim">
        {showAllTime ? (
          "All-time"
        ) : (
          <>
            Since <span className="font-medium text-ink">{formatDate(epoch.setAt)}</span>
          </>
        )}
      </p>

      <div className="flex gap-4 text-xs font-medium">
        <a href="/admin/margin" className={!showAllTime ? "text-signal" : "text-text-dim hover:text-text"}>
          Since {formatDate(epoch.setAt)}
        </a>
        <a href="/admin/margin?view=all-time" className={showAllTime ? "text-signal" : "text-text-dim hover:text-text"}>
          All-time
        </a>
      </div>
    </div>
  );
}
