// TEMPORARY: placeholder upstream costs, standing in for 5sim's real price
// feed until Phase 4 builds lib/5sim/client.ts and a live polling job
// (see ARCHITECTURE.md's "Pricing engine" step 1). Not real 5sim prices —
// rough, made-up figures only meant to exercise the pricing engine
// end-to-end. Same cost is used for a service across every country (no
// per-country upstream cost until there's a real feed); the pricing
// *rules* still vary correctly by country where a country/service_country
// rule exists.
//
// Delete this file once Phase 4 wires a real per-(service,country) cost
// source, and update lib/pricing/catalog.ts to use that instead.
import type { UpstreamCost } from "./engine";

export const MOCK_UPSTREAM_COSTS: Record<string, UpstreamCost> = {
  whatsapp: { amount: 0.35, currency: "USD" },
  telegram: { amount: 0.12, currency: "USD" },
  google: { amount: 0.45, currency: "USD" },
  facebook: { amount: 0.3, currency: "USD" },
  instagram: { amount: 0.28, currency: "USD" },
  tiktok: { amount: 0.25, currency: "USD" },
  twitter: { amount: 0.4, currency: "USD" },
  discord: { amount: 0.15, currency: "USD" },
  amazon: { amount: 0.5, currency: "USD" },
  microsoft: { amount: 0.38, currency: "USD" },
  apple: { amount: 0.6, currency: "USD" },
  uber: { amount: 0.42, currency: "USD" },
  airbnb: { amount: 0.55, currency: "USD" },
  paypal: { amount: 0.7, currency: "USD" },
  netflix: { amount: 0.33, currency: "USD" },
  spotify: { amount: 0.2, currency: "USD" },
  tinder: { amount: 0.48, currency: "USD" },
  linkedin: { amount: 0.3, currency: "USD" },
};

export function getMockUpstreamCost(fivesimProductCode: string): UpstreamCost | null {
  return MOCK_UPSTREAM_COSTS[fivesimProductCode] ?? null;
}
