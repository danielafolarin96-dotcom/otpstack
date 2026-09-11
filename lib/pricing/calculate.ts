// Pure calculation functions for the pricing engine — no DB access here,
// see lib/pricing/engine.ts for the orchestration that fetches rules/fx
// rates and calls these. Kept separate so the actual math is fully
// unit-testable without mocking Supabase. All money in integer kobo.

export interface PricingTier {
  max_cost_kobo: number;
  markup_pct: number;
}

export type MarkupType = "percent" | "flat_kobo" | "tiered";

export interface MarkupRule {
  markup_type: MarkupType;
  markup_value: unknown; // jsonb from the DB — validated by the functions below
}

export function isPricingTierArray(value: unknown): value is PricingTier[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (t) =>
        typeof t === "object" &&
        t !== null &&
        typeof (t as PricingTier).max_cost_kobo === "number" &&
        typeof (t as PricingTier).markup_pct === "number",
    )
  );
}

// USD (or whichever upstream currency) major-unit cost -> NGN kobo, using
// an fx_rates.rate expressed as "NGN per 1 unit of upstream currency".
export function convertToNgnKobo(upstreamAmountMajorUnits: number, fxRate: number): number {
  return Math.round(upstreamAmountMajorUnits * fxRate * 100);
}

// Applies a resolved pricing_rules row's markup formula to an NGN-kobo
// upstream cost. Does not enforce the margin floor — see
// enforceMinMargin below, which the engine always applies afterward.
export function computeCandidateKobo(upstreamCostNgnKobo: number, rule: MarkupRule): number {
  switch (rule.markup_type) {
    case "percent": {
      const pct = rule.markup_value;
      if (typeof pct !== "number") {
        throw new Error("percent markup_value must be a number");
      }
      return Math.round(upstreamCostNgnKobo * (1 + pct / 100));
    }
    case "flat_kobo": {
      const flat = rule.markup_value;
      if (typeof flat !== "number") {
        throw new Error("flat_kobo markup_value must be a number");
      }
      return Math.round(upstreamCostNgnKobo + flat);
    }
    case "tiered": {
      const tiers = rule.markup_value;
      if (!isPricingTierArray(tiers)) {
        throw new Error("tiered markup_value must be a non-empty array of {max_cost_kobo, markup_pct}");
      }
      // Ascending by max_cost_kobo; use the first tier the cost fits
      // under, falling back to the highest tier if cost exceeds them all.
      const sorted = [...tiers].sort((a, b) => a.max_cost_kobo - b.max_cost_kobo);
      const tier = sorted.find((t) => upstreamCostNgnKobo <= t.max_cost_kobo) ?? sorted[sorted.length - 1];
      return Math.round(upstreamCostNgnKobo * (1 + tier.markup_pct / 100));
    }
  }
}

// Gross margin as a fraction of price: (price - cost) / price.
export function marginPct(priceKobo: number, upstreamCostNgnKobo: number): number {
  if (priceKobo <= 0) return 0;
  return ((priceKobo - upstreamCostNgnKobo) / priceKobo) * 100;
}

// ARCHITECTURE.md step 4: if the markup formula's price would yield less
// than min_margin_pct, use the minimum-margin price instead. Solving
// (price - cost) / price >= minMarginPct/100 for price gives
// price >= cost / (1 - minMarginPct/100).
export function enforceMinMargin(
  candidateKobo: number,
  upstreamCostNgnKobo: number,
  minMarginPct: number,
): number {
  if (minMarginPct >= 100) {
    throw new Error("min_margin_pct must be less than 100");
  }
  const floorKobo = Math.round(upstreamCostNgnKobo / (1 - minMarginPct / 100));
  return Math.max(candidateKobo, floorKobo);
}
