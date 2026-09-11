export interface ResolvablePricingRule {
  id: string;
  scope: "global" | "service" | "country" | "service_country";
  service_id: string | null;
  country_id: string | null;
  priority: number;
}

// Given every pricing_rules row (the table is small — a handful of scopes
// per service/country — so fetching it all once and filtering in memory
// beats building a fragile PostgREST OR-filter string), picks the most
// specific applicable rule for a (service, country) pair. Resolution
// order per ARCHITECTURE.md: service_country > service > country > global,
// which the seed data's `priority` values already encode — this just
// picks the highest priority among whatever applies.
export function resolvePricingRule<T extends ResolvablePricingRule>(
  allRules: T[],
  serviceId: string,
  countryId: string,
): T | null {
  const applicable = allRules.filter(
    (r) =>
      r.scope === "global" ||
      (r.scope === "service" && r.service_id === serviceId) ||
      (r.scope === "country" && r.country_id === countryId) ||
      (r.scope === "service_country" && r.service_id === serviceId && r.country_id === countryId),
  );

  if (applicable.length === 0) return null;

  return applicable.reduce((best, r) => (r.priority > best.priority ? r : best));
}
