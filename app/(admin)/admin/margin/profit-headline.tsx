import type { MarginReport } from "@/lib/pricing/margin-report";
import type { ReportingEpoch } from "@/lib/pricing/reporting-epoch";

function naira(kobo: number) {
  return `₦${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}

// The page's visual lead: the actual naira profit, colored --good/--danger
// by sign, not the margin percentage. Also carries the reporting-epoch
// date range + toggle (formerly its own banner) since that's the scope the
// profit figure is measured over.
export function ProfitHeadline({
  report,
  target,
  epoch,
  showAllTime,
}: {
  report: MarginReport;
  target: number;
  epoch: ReportingEpoch | null;
  showAllTime: boolean;
}) {
  const positive = report.realizedProfitKobo >= 0;
  const hasOrders = report.overall.orderCount > 0;
  const onTarget = !hasOrders || report.overall.marginPct >= target;

  return (
    <div className="rounded-[14px] border border-line bg-paper-raised p-6 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <p className="text-sm text-text-dim">Realized profit</p>
          <p
            className={`mt-1 font-technical text-4xl font-bold sm:text-5xl ${
              positive ? "text-good" : "text-danger"
            }`}
          >
            {naira(report.realizedProfitKobo)}
          </p>
          <p className="mt-2 text-sm text-text-dim">
            {hasOrders ? (
              <>
                <span className={`font-technical font-semibold ${onTarget ? "text-ink" : "text-danger"}`}>
                  {report.overall.marginPct.toFixed(1)}%
                </span>{" "}
                margin · target {target}%
              </>
            ) : (
              "No revenue-kept orders yet"
            )}
          </p>
        </div>

        {epoch && (
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
        )}
      </div>
    </div>
  );
}
