import { describe, expect, it } from "vitest";
import {
  computeCandidateKobo,
  convertToNgnKobo,
  enforceMinMargin,
  isPricingTierArray,
  marginPct,
} from "./calculate";

describe("convertToNgnKobo", () => {
  it("converts an upstream major-unit amount to NGN kobo via the fx rate", () => {
    expect(convertToNgnKobo(0.3, 1600)).toBe(48_000);
  });

  it("rounds to the nearest kobo", () => {
    expect(convertToNgnKobo(0.333, 1600)).toBe(Math.round(0.333 * 1600 * 100));
  });
});

describe("computeCandidateKobo", () => {
  it("applies a percent markup", () => {
    expect(computeCandidateKobo(48_000, { markup_type: "percent", markup_value: 180 })).toBe(134_400);
  });

  it("applies a flat_kobo markup", () => {
    expect(computeCandidateKobo(48_000, { markup_type: "flat_kobo", markup_value: 200_000 })).toBe(248_000);
  });

  it("applies the tier whose max_cost_kobo the cost falls under", () => {
    const tiers = [
      { max_cost_kobo: 50_000, markup_pct: 200 },
      { max_cost_kobo: 150_000, markup_pct: 160 },
      { max_cost_kobo: 500_000, markup_pct: 140 },
    ];
    expect(computeCandidateKobo(48_000, { markup_type: "tiered", markup_value: tiers })).toBe(144_000);
    expect(computeCandidateKobo(100_000, { markup_type: "tiered", markup_value: tiers })).toBe(260_000);
    expect(computeCandidateKobo(320_000, { markup_type: "tiered", markup_value: tiers })).toBe(768_000);
  });

  it("falls back to the highest tier when cost exceeds every tier ceiling", () => {
    const tiers = [
      { max_cost_kobo: 50_000, markup_pct: 200 },
      { max_cost_kobo: 150_000, markup_pct: 160 },
    ];
    // 1,000,000 exceeds both ceilings — falls back to the 160% tier.
    expect(computeCandidateKobo(1_000_000, { markup_type: "tiered", markup_value: tiers })).toBe(2_600_000);
  });

  it("doesn't require tiers to already be sorted", () => {
    const unsorted = [
      { max_cost_kobo: 500_000, markup_pct: 140 },
      { max_cost_kobo: 50_000, markup_pct: 200 },
      { max_cost_kobo: 150_000, markup_pct: 160 },
    ];
    expect(computeCandidateKobo(48_000, { markup_type: "tiered", markup_value: unsorted })).toBe(144_000);
  });

  it("throws on a non-numeric percent markup_value", () => {
    expect(() =>
      computeCandidateKobo(48_000, { markup_type: "percent", markup_value: "180" }),
    ).toThrow();
  });

  it("throws on a malformed tier array", () => {
    expect(() =>
      computeCandidateKobo(48_000, { markup_type: "tiered", markup_value: [{ bad: "shape" }] }),
    ).toThrow();
  });
});

describe("isPricingTierArray", () => {
  it("accepts a well-formed non-empty tier array", () => {
    expect(isPricingTierArray([{ max_cost_kobo: 1, markup_pct: 2 }])).toBe(true);
  });

  it("rejects an empty array", () => {
    expect(isPricingTierArray([])).toBe(false);
  });

  it("rejects non-array input", () => {
    expect(isPricingTierArray({ max_cost_kobo: 1, markup_pct: 2 })).toBe(false);
    expect(isPricingTierArray(null)).toBe(false);
    expect(isPricingTierArray(180)).toBe(false);
  });
});

describe("marginPct", () => {
  it("computes gross margin as a percentage of price", () => {
    expect(marginPct(134_400, 48_000)).toBeCloseTo(64.2857, 3);
  });

  it("returns 0 for a non-positive price instead of dividing by zero", () => {
    expect(marginPct(0, 48_000)).toBe(0);
  });
});

describe("enforceMinMargin", () => {
  it("keeps the candidate price when it already clears the margin floor", () => {
    // cost 48,000, candidate 134,400 -> margin 64.3%, floor at 60% is 120,000
    expect(enforceMinMargin(134_400, 48_000, 60)).toBe(134_400);
  });

  it("overrides to the minimum-margin price when the candidate falls short", () => {
    // cost 320,000, candidate 520,000 -> margin 38.5%, below the 60% floor
    const floored = enforceMinMargin(520_000, 320_000, 60);
    expect(floored).toBe(800_000);
    expect(marginPct(floored, 320_000)).toBeCloseTo(60, 5);
  });

  it("throws for a min_margin_pct of 100 or more (undefined floor price)", () => {
    expect(() => enforceMinMargin(100, 50, 100)).toThrow();
  });
});
