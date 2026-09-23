import { createAdminClient } from "@/lib/supabase/admin";
import { summarizeFinanceEvents, type FinanceEventInput } from "@/lib/finance/report";
import { resolveDateRangePreset, type DateRangePreset } from "@/lib/finance/date-range";
import { FinanceFilters } from "./finance-filters";
import { FinanceSummaryCards } from "./finance-summary-cards";
import { FinanceOrdersTable } from "./finance-orders-table";

const PRESETS: readonly DateRangePreset[] = ["today", "7d", "30d", "month", "custom"];

export default async function AdminFinancePage({
  searchParams,
}: {
  searchParams: Promise<{
    preset?: string;
    from?: string;
    to?: string;
    country?: string;
    service?: string;
    provider?: string;
  }>;
}) {
  const { preset: presetParam, from, to, country, service: serviceId, provider } = await searchParams;
  const preset: DateRangePreset = PRESETS.includes(presetParam as DateRangePreset)
    ? (presetParam as DateRangePreset)
    : "30d";

  const admin = createAdminClient();

  // finance_events is fetched in full and summarized in JS (not filtered by
  // date in the query itself) — see lib/finance/report.ts's comment: a
  // refund can land outside the display window even when its order was
  // created inside it, and that pairing has to stay intact for an accurate
  // per-order picture. Same unbounded-fetch-then-aggregate pattern the
  // Margin page already uses for `orders`. services/countries are small,
  // curated catalogs (see ARCHITECTURE.md) — fetched in full for a
  // id -> display-name lookup, not paginated.
  const [{ data: events }, { data: services }, { data: countries }] = await Promise.all([
    admin.from("finance_events").select("*"),
    admin.from("services").select("id, name, provider"),
    admin.from("countries").select("fivesim_country_code, name"),
  ]);

  const serviceById = new Map((services ?? []).map((s) => [s.id, s]));
  const countryByCode = new Map((countries ?? []).map((c) => [c.fivesim_country_code, c]));

  const eventInputs: FinanceEventInput[] = (events ?? []).map((e) => ({
    orderId: e.order_id,
    eventType: e.event_type,
    serviceId: e.service_id,
    serviceName: serviceById.get(e.service_id)?.name ?? "Unknown",
    countryCode: e.country_code,
    countryName: countryByCode.get(e.country_code)?.name ?? e.country_code,
    provider: e.provider,
    revenueKobo: e.revenue_kobo,
    providerCostKobo: e.provider_cost_kobo,
    paymentFeeKobo: e.payment_fee_kobo,
    createdAt: e.created_at,
  }));

  const { fromDate, toDate } = resolveDateRangePreset(preset, new Date(), { from, to });

  const report = summarizeFinanceEvents(eventInputs, {
    fromDate,
    toDate,
    countryCode: country || null,
    serviceId: serviceId || null,
    provider: provider || null,
  });

  const providers = Array.from(new Set((services ?? []).map((s) => s.provider))).sort();
  const countryOptions = Array.from(
    new Map((countries ?? []).map((c) => [c.fivesim_country_code, c.name])).entries(),
  ).sort((a, b) => a[1].localeCompare(b[1]));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Finance</h1>
        <p className="text-sm text-text-dim">
          Revenue, provider cost, payment fees, and refunds — from real transaction data, not the selling
          price alone.
        </p>
      </div>

      <FinanceFilters
        services={services ?? []}
        countries={countryOptions}
        providers={providers}
        selected={{ preset, from, to, country, serviceId, provider }}
      />

      <FinanceSummaryCards totals={report.totals} />

      <div>
        <h2 className="mb-3 font-display text-lg font-bold text-ink">Per number / session</h2>
        <FinanceOrdersTable rows={report.rows} />
      </div>
    </div>
  );
}
