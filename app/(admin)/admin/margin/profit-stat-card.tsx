import type { MarginReport } from "@/lib/pricing/margin-report";
import type { ReportingEpoch } from "@/lib/pricing/reporting-epoch";

function naira(kobo: number) {
  return `₦${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}

// Demoted from the page's old hero position (see fivesim-balance-hero.tsx,
// which took that spot) — realized profit is now one of the smaller
// supporting stats, same size/styling as MarginSummaryCards' cards, so it
// sits alongside them in the detail grid instead of leading the page.
export function ProfitStatCard({ report, target }: { report: MarginReport; target: number }) {
  const positive = report.realizedProfitKobo >= 0;
  const hasOrders = report.overall.orderCount > 0;
  // Compare the same rounded value that's displayed — see
  // margin-by-service-table.tsx for why the raw float can't be compared
  // directly against a 1-decimal target.
  const displayMarginPct = Number(report.overall.marginPct.toFixed(1));
  const onTarget = !hasOrders || displayMarginPct >= target;

  return (
    <div className="rounded-[14px] border border-line bg-paper-raised p-6">
      <p className="text-sm text-text-dim">Realized profit</p>
      <p className={`mt-2 font-technical text-3xl font-bold ${positive ? "text-good" : "text-danger"}`}>
        {naira(report.realizedProfitKobo)}
      </p>
      <p className="mt-1 text-xs text-text-dim">
        {hasOrders ? (
          <>
            <span className={`font-technical font-semibold ${onTarget ? "text-ink" : "text-danger"}`}>
              {displayMarginPct.toFixed(1)}%
            </span>{" "}
            margin · target {target}%
          </>
        ) : (
          "No revenue-kept orders yet"
        )}
      </p>
    </div>
  );
}

// Reporting-epoch scope toggle, moved out of the old profit headline into
// the page's own header row — it controls what date range the WHOLE page
// (hero + stats + by-service table) reports over, not just the profit
// figure, so it no longer belongs visually tied to one demoted stat card.
export function EpochToggle({ epoch, showAllTime }: { epoch: ReportingEpoch | null; showAllTime: boolean }) {
  if (!epoch) return null;

  return (
    <div className="flex gap-4 text-sm font-medium">
      <a href="/admin/margin" className={!showAllTime ? "text-ink" : "text-text-dim hover:text-text"}>
        Since {formatDate(epoch.setAt)}
      </a>
      <a
        href="/admin/margin?view=all-time"
        className={showAllTime ? "text-ink" : "text-text-dim hover:text-text"}
      >
        All-time
      </a>
    </div>
  );
}
