/**
 * Placeholder delivery-odds data for the landing page's "Delivery odds"
 * section.
 *
 * 5sim's /guest/prices endpoint genuinely returns a "rate" field (delivery
 * percentage, per country/product/operator, omitted below 20% or on too few
 * orders) — see ARCHITECTURE.md's 5sim integration section. It is per
 * OPERATOR, not per country, and how that rolls up to a single per-country
 * number for this section (best operator, weighted average, something
 * else) is an open decision flagged there, not made here.
 *
 * Until that's decided, these numbers are illustrative only. Countries are
 * ordered with US, Canada and UK first per product direction; the rest
 * follow in no particular priority.
 */
export const DELIVERY_ODDS_SERVICES = ["tiktok", "instagram", "snapchat", "discord"] as const;
export type DeliveryOddsService = (typeof DELIVERY_ODDS_SERVICES)[number];

export const DELIVERY_ODDS_SERVICE_LABELS: Record<DeliveryOddsService, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  snapchat: "Snapchat",
  discord: "Discord",
};

export interface DeliveryOddsEntry {
  countryCode: string;
  countryName: string;
  flag: string;
  ratePct: number;
}

const BASE_ORDER: Omit<DeliveryOddsEntry, "ratePct">[] = [
  { countryCode: "US", countryName: "United States", flag: "🇺🇸" },
  { countryCode: "CA", countryName: "Canada", flag: "🇨🇦" },
  { countryCode: "GB", countryName: "United Kingdom", flag: "🇬🇧" },
  { countryCode: "NG", countryName: "Nigeria", flag: "🇳🇬" },
  { countryCode: "KE", countryName: "Kenya", flag: "🇰🇪" },
  { countryCode: "ID", countryName: "Indonesia", flag: "🇮🇩" },
];

const RATES_BY_SERVICE: Record<DeliveryOddsService, number[]> = {
  tiktok: [96, 94, 91, 87, 74, 60],
  instagram: [94, 92, 89, 84, 70, 55],
  snapchat: [93, 90, 86, 80, 66, 50],
  discord: [95, 92, 88, 83, 71, 57],
};

export function getDeliveryOdds(service: DeliveryOddsService): DeliveryOddsEntry[] {
  const rates = RATES_BY_SERVICE[service];
  return BASE_ORDER.map((entry, i) => ({ ...entry, ratePct: rates[i] }));
}
