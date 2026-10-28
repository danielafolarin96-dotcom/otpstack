import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  effectiveFxRate,
  fetchAllPricingRules,
  fetchLatestFundingRates,
  fetchLatestFxRate,
  fetchPricingFxRates,
  priceForServiceCountry,
  priceFromRulesAndRate,
} from "./engine";

const WHATSAPP = "service-whatsapp";
const NIGERIA = "country-nigeria";

const GLOBAL_TIERED_RULE = {
  id: "global",
  scope: "global" as const,
  service_id: null,
  country_id: null,
  priority: 10,
  markup_type: "tiered" as const,
  markup_value: [
    { max_cost_kobo: 50_000, markup_pct: 200 },
    { max_cost_kobo: 500_000, markup_pct: 140 },
  ],
  min_margin_pct: 30,
};

function fakeSupabase(options: {
  pricingRules?: unknown[];
  pricingRulesError?: { message: string } | null;
  fxRate?: number | null;
  fxRateError?: { message: string } | null;
  // Rows as the query returns them: already ordered effective_from desc.
  fundingRates?: { provider: string; ngn_per_usd: number }[];
  fundingRatesError?: { message: string } | null;
}) {
  const from = vi.fn((table: string) => {
    if (table === "pricing_rules") {
      return {
        select: () =>
          Promise.resolve({
            data: options.pricingRules ?? [],
            error: options.pricingRulesError ?? null,
          }),
      };
    }
    if (table === "fx_rates") {
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data:
                      options.fxRate == null && options.fxRateError == null
                        ? null
                        : options.fxRate != null
                          ? { rate: options.fxRate }
                          : null,
                    error: options.fxRateError ?? null,
                  }),
              }),
            }),
          }),
        }),
      };
    }
    if (table === "provider_funding_rates") {
      return {
        select: () => ({
          eq: () => ({
            lte: () => ({
              order: () =>
                Promise.resolve({
                  data: options.fundingRatesError ? null : (options.fundingRates ?? []),
                  error: options.fundingRatesError ?? null,
                }),
            }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected table in test fake: ${table}`);
  });

  return { from } as unknown as SupabaseClient<Database>;
}

describe("fetchAllPricingRules", () => {
  it("returns the rows on success", async () => {
    const client = fakeSupabase({ pricingRules: [GLOBAL_TIERED_RULE] });
    await expect(fetchAllPricingRules(client)).resolves.toEqual([GLOBAL_TIERED_RULE]);
  });

  it("throws on a database error", async () => {
    const client = fakeSupabase({ pricingRulesError: { message: "boom" } });
    await expect(fetchAllPricingRules(client)).rejects.toMatchObject({ message: "boom" });
  });
});

describe("fetchLatestFxRate", () => {
  it("returns the rate on success", async () => {
    const client = fakeSupabase({ fxRate: 1600 });
    await expect(fetchLatestFxRate(client, "USD_NGN")).resolves.toBe(1600);
  });

  it("throws when no fx_rates row exists for the pair", async () => {
    const client = fakeSupabase({ fxRate: null });
    await expect(fetchLatestFxRate(client, "USD_NGN")).rejects.toThrow(/No fx_rates entry/);
  });

  it("throws on a database error", async () => {
    const client = fakeSupabase({ fxRateError: { message: "boom" } });
    await expect(fetchLatestFxRate(client, "USD_NGN")).rejects.toMatchObject({ message: "boom" });
  });
});

describe("fetchLatestFundingRates", () => {
  it("keeps only the latest row per provider", async () => {
    const client = fakeSupabase({
      fundingRates: [
        { provider: "5sim", ngn_per_usd: 1562 },
        { provider: "grizzly", ngn_per_usd: 1580 },
        { provider: "5sim", ngn_per_usd: 1500 },
      ],
    });
    await expect(fetchLatestFundingRates(client, "USD_NGN")).resolves.toEqual({ "5sim": 1562, grizzly: 1580 });
  });

  it("throws on a database error", async () => {
    const client = fakeSupabase({ fundingRatesError: { message: "boom" } });
    await expect(fetchLatestFundingRates(client, "USD_NGN")).rejects.toMatchObject({ message: "boom" });
  });
});

describe("effectiveFxRate", () => {
  it("uses the funding rate when it is above market", () => {
    expect(effectiveFxRate({ market: 1353, fundingByProvider: { "5sim": 1562 } }, "5sim")).toBe(1562);
  });

  it("uses the market rate when it is above the funding rate", () => {
    expect(effectiveFxRate({ market: 1700, fundingByProvider: { "5sim": 1562 } }, "5sim")).toBe(1700);
  });

  it("falls back to market when the provider has no funding row", () => {
    expect(effectiveFxRate({ market: 1353, fundingByProvider: { "5sim": 1562 } }, "grizzly")).toBe(1353);
  });
});

describe("priceFromRulesAndRate", () => {
  it("resolves a rule, converts currency, and prices the result", () => {
    const result = priceFromRulesAndRate(
      [GLOBAL_TIERED_RULE],
      1600,
      WHATSAPP,
      NIGERIA,
      { amount: 0.3, currency: "USD" },
    );

    expect(result.upstreamCostKobo).toBe(48_000);
    expect(result.priceKobo).toBe(144_000); // 48,000 * 3 (200% tier)
    expect(result.ruleId).toBe("global");
    expect(result.ruleScope).toBe("global");
  });

  it("throws when no rule applies at all", () => {
    expect(() =>
      priceFromRulesAndRate([], 1600, WHATSAPP, NIGERIA, { amount: 0.3, currency: "USD" }),
    ).toThrow(/No pricing_rules row applies/);
  });
});

describe("priceForServiceCountry", () => {
  it("fetches rules and fx rate, then prices the service/country pair", async () => {
    const client = fakeSupabase({ pricingRules: [GLOBAL_TIERED_RULE], fxRate: 1600 });

    const result = await priceForServiceCountry(client, {
      serviceId: WHATSAPP,
      countryId: NIGERIA,
      upstreamCost: { amount: 0.3, currency: "USD" },
      provider: "5sim",
    });

    expect(result.priceKobo).toBe(144_000);
  });

  it("prices at the provider's funding rate when market is lower", async () => {
    const client = fakeSupabase({
      pricingRules: [GLOBAL_TIERED_RULE],
      fxRate: 1353,
      fundingRates: [{ provider: "5sim", ngn_per_usd: 1562 }],
    });

    const result = await priceForServiceCountry(client, {
      serviceId: WHATSAPP,
      countryId: NIGERIA,
      upstreamCost: { amount: 0.3, currency: "USD" },
      provider: "5sim",
    });

    expect(result.upstreamCostKobo).toBe(46_860); // 0.30 * 1562 * 100
    expect(result.priceKobo).toBe(140_580); // 46,860 * 3 (200% tier)
  });
});

describe("fetchPricingFxRates", () => {
  it("returns the market rate alongside each provider's funding rate", async () => {
    const client = fakeSupabase({ fxRate: 1353, fundingRates: [{ provider: "5sim", ngn_per_usd: 1562 }] });
    await expect(fetchPricingFxRates(client, "USD_NGN")).resolves.toEqual({
      market: 1353,
      fundingByProvider: { "5sim": 1562 },
    });
  });
});
