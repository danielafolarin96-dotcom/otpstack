import { createAdminClient } from "@/lib/supabase/admin";
import { summarizeGrizzlyFallback, type GrizzlyFallbackEventInput } from "@/lib/providers/grizzly-fallback-report";
import { GrizzlyFallbackFilters } from "./grizzly-fallback-filters";
import { GrizzlyFallbackSummaryCards } from "./grizzly-fallback-summary-cards";
import { GrizzlyFallbackByServiceTable } from "./grizzly-fallback-by-service-table";
import { GrizzlyFallbackEventsTable } from "./grizzly-fallback-events-table";

// The only two purchase_failures.reason values isGrizzlyNoStockFailure
// (lib/orders/purchase.ts) will ever retry on 5sim for — every other
// Grizzly failure (balance, price-above-quote, unusable response) is a
// real problem, not "no stock," and never gets logged here.
const NO_STOCK_REASONS = ["operator_unavailable", "upstream_no_numbers"] as const;

export default async function AdminGrizzlyFallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ service?: string; outcome?: string }>;
}) {
  const { service: serviceId, outcome } = await searchParams;
  const admin = createAdminClient();

  // purchase_failures.service_id deliberately has no foreign key (it can
  // name a service that doesn't exist, from a malformed request body — see
  // the create_purchase_failures migration), so service/country names are
  // resolved via lookup maps here rather than a PostgREST embed.
  const [{ data: services }, { data: countries }, { data: failures }] = await Promise.all([
    admin.from("services").select("id, name").order("name"),
    admin.from("countries").select("fivesim_country_code, name"),
    admin
      .from("purchase_failures")
      .select(
        "id, created_at, service_id, country_code, operator, reason, message, recovered_by_fallback, recovered_order_id",
      )
      .eq("provider", "grizzly")
      .in("reason", NO_STOCK_REASONS)
      .order("created_at", { ascending: false }),
  ]);

  const serviceNameById = new Map((services ?? []).map((s) => [s.id, s.name]));
  const countryNameByCode = new Map((countries ?? []).map((c) => [c.fivesim_country_code, c.name]));

  const events: GrizzlyFallbackEventInput[] = (failures ?? []).map((f) => ({
    id: f.id,
    createdAt: f.created_at,
    serviceId: f.service_id,
    serviceName: (f.service_id && serviceNameById.get(f.service_id)) || "Unknown",
    countryCode: f.country_code,
    countryName: (f.country_code && countryNameByCode.get(f.country_code)) || f.country_code || "Unknown",
    operator: f.operator,
    reason: f.reason,
    message: f.message,
    recoveredByFallback: f.recovered_by_fallback,
    recoveredOrderId: f.recovered_order_id,
  }));

  const report = summarizeGrizzlyFallback(events);

  // Filters narrow the event table only — the summary cards and by-service
  // breakdown above always reflect full history, so a narrowed view never
  // makes the headline numbers look better or worse than they are.
  let filteredEvents = events;
  if (serviceId) filteredEvents = filteredEvents.filter((e) => e.serviceId === serviceId);
  if (outcome === "recovered") filteredEvents = filteredEvents.filter((e) => e.recoveredByFallback);
  if (outcome === "lost") filteredEvents = filteredEvents.filter((e) => !e.recoveredByFallback);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Grizzly fallback</h1>
        <p className="text-sm text-text-dim">
          Every time Grizzly reported no stock for a Big-6 service, and whether the automatic 5sim retry
          actually recovered the sale.
        </p>
      </div>

      <GrizzlyFallbackSummaryCards summary={report.summary} />

      <div>
        <h2 className="mb-3 font-display text-lg font-bold text-ink">By service &amp; country</h2>
        <GrizzlyFallbackByServiceTable rows={report.byServiceCountry} />
      </div>

      <div>
        <h2 className="mb-3 font-display text-lg font-bold text-ink">Events</h2>
        <GrizzlyFallbackFilters services={services ?? []} selected={{ serviceId, outcome }} />
        <div className="mt-4">
          <GrizzlyFallbackEventsTable events={filteredEvents} />
        </div>
      </div>
    </div>
  );
}
