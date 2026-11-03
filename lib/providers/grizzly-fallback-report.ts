// Summarizes purchase_failures rows for the Grizzly->5sim no-stock fallback
// (lib/orders/purchase.ts's isGrizzlyNoStockFailure + the recordPurchaseFailure
// call that logs a recovered attempt) into the shape /admin/grizzly-fallback
// renders. Pure function, no DB access — the page does the querying
// (provider = 'grizzly' and reason in ('operator_unavailable',
// 'upstream_no_numbers')) and hands the rows here.

export interface GrizzlyFallbackEventInput {
  id: string;
  createdAt: string;
  serviceId: string | null;
  serviceName: string;
  countryCode: string | null;
  countryName: string;
  operator: string | null;
  reason: string;
  message: string | null;
  recoveredByFallback: boolean;
  recoveredOrderId: string | null;
}

export interface GrizzlyFallbackSummary {
  total: number;
  recovered: number;
  lost: number;
  // Percent, one decimal place. 0 when total is 0 — nothing to divide.
  recoveryRatePct: number;
}

export interface GrizzlyFallbackServiceRow {
  // serviceId|countryCode — stable React key, not shown.
  key: string;
  serviceName: string;
  countryCode: string;
  countryName: string;
  total: number;
  recovered: number;
  lost: number;
}

export interface GrizzlyFallbackReport {
  summary: GrizzlyFallbackSummary;
  // Most-failures-first, so the worst (service, country) pairs — the ones
  // most worth a provider_routes override back to 5sim — sort to the top.
  byServiceCountry: GrizzlyFallbackServiceRow[];
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function summarizeGrizzlyFallback(events: GrizzlyFallbackEventInput[]): GrizzlyFallbackReport {
  let recovered = 0;
  const buckets = new Map<string, GrizzlyFallbackServiceRow>();

  for (const event of events) {
    if (event.recoveredByFallback) recovered += 1;

    const key = `${event.serviceId ?? "unknown"}|${event.countryCode ?? "unknown"}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.total += 1;
      if (event.recoveredByFallback) existing.recovered += 1;
      else existing.lost += 1;
    } else {
      buckets.set(key, {
        key,
        serviceName: event.serviceName,
        countryCode: event.countryCode ?? "unknown",
        countryName: event.countryName,
        total: 1,
        recovered: event.recoveredByFallback ? 1 : 0,
        lost: event.recoveredByFallback ? 0 : 1,
      });
    }
  }

  const total = events.length;
  const byServiceCountry = Array.from(buckets.values()).sort((a, b) => b.total - a.total);

  return {
    summary: {
      total,
      recovered,
      lost: total - recovered,
      recoveryRatePct: total === 0 ? 0 : round1((recovered / total) * 100),
    },
    byServiceCountry,
  };
}
