import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getOperatorPrices } from "@/lib/5sim/client";
import { computeOperatorPrices } from "./catalog";

vi.mock("@/lib/5sim/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/5sim/client")>("@/lib/5sim/client");
  return { ...actual, getOperatorPrices: vi.fn() };
});

const SERVICE = { fivesim_product_code: "whatsapp" };
const COUNTRY = { fivesim_country_code: "usa" };
const GLOBAL_RULE = {
  id: "global-rule",
  scope: "global" as const,
  service_id: null,
  country_id: null,
  priority: 10,
  markup_type: "percent" as const,
  markup_value: 100,
  min_margin_pct: 0,
};

function fakeAdminClient(configs: Record<string, { data: unknown; error: unknown }>) {
  const from = vi.fn((table: string) => {
    const result = configs[table] ?? { data: null, error: null };
    const builder: {
      select: () => typeof builder;
      eq: () => typeof builder;
      order: () => typeof builder;
      limit: () => typeof builder;
      maybeSingle: () => Promise<unknown>;
      then: (resolve: (v: unknown) => void) => void;
    } = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: () => Promise.resolve(result),
      then: (resolve) => resolve(result),
    };
    return builder;
  });
  return { from } as unknown as SupabaseClient<Database>;
}

const baseConfigs = (): Record<string, { data: unknown; error: unknown }> => ({
  services: { data: SERVICE, error: null },
  countries: { data: COUNTRY, error: null },
  pricing_rules: { data: [GLOBAL_RULE], error: null },
  fx_rates: { data: { rate: 1600 }, error: null },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("computeOperatorPrices", () => {
  it("prices every ranked option from its own cost, recommended first", async () => {
    vi.mocked(getOperatorPrices).mockResolvedValue({
      recommended: { operator: "virtual28", cost: 1, count: 100, rate: 42 },
      options: [
        { operator: "virtual28", cost: 1, count: 100, rate: 42 },
        { operator: "virtual51", cost: 0.5, count: 10, rate: 25 },
      ],
    });
    const client = fakeAdminClient(baseConfigs());

    const result = await computeOperatorPrices(client, "service-1", "country-1");

    expect(result).not.toBeNull();
    expect(result!.options.map((o) => o.operator)).toEqual(["virtual28", "virtual51"]);
    expect(result!.recommended.operator).toBe("virtual28");
    // cost 1 USD * 1600 rate = ₦1600 = 160,000 kobo; 100% global markup -> 320,000 kobo.
    expect(result!.recommended.price.priceKobo).toBe(320_000);
    expect(result!.recommended.ratePct).toBe(42);
    expect(result!.options[1].ratePct).toBe(25);
  });

  it("surfaces an unrated operator's ratePct as null, not 0 or undefined-as-missing", async () => {
    vi.mocked(getOperatorPrices).mockResolvedValue({
      recommended: { operator: "newOp", cost: 0.2, count: 5 },
      options: [{ operator: "newOp", cost: 0.2, count: 5 }],
    });
    const client = fakeAdminClient(baseConfigs());

    const result = await computeOperatorPrices(client, "service-1", "country-1");

    expect(result!.recommended.ratePct).toBeNull();
  });

  it("returns null when nothing is sellable for this route", async () => {
    vi.mocked(getOperatorPrices).mockResolvedValue({ recommended: null, options: [] });
    const client = fakeAdminClient(baseConfigs());

    const result = await computeOperatorPrices(client, "service-1", "country-1");

    expect(result).toBeNull();
    expect(getOperatorPrices).toHaveBeenCalledWith("usa", "whatsapp");
  });

  it("returns null when the service doesn't exist or is inactive, without calling 5sim", async () => {
    const configs = baseConfigs();
    configs.services = { data: null, error: null };
    const client = fakeAdminClient(configs);

    const result = await computeOperatorPrices(client, "missing-service", "country-1");

    expect(result).toBeNull();
    expect(getOperatorPrices).not.toHaveBeenCalled();
  });

  it("returns null when the country doesn't exist or is inactive, without calling 5sim", async () => {
    const configs = baseConfigs();
    configs.countries = { data: null, error: null };
    const client = fakeAdminClient(configs);

    const result = await computeOperatorPrices(client, "service-1", "missing-country");

    expect(result).toBeNull();
    expect(getOperatorPrices).not.toHaveBeenCalled();
  });

  it("propagates a 5sim fetch failure rather than swallowing it into null — the caller decides how to surface that", async () => {
    vi.mocked(getOperatorPrices).mockRejectedValue(new Error("5sim: connection reset"));
    const client = fakeAdminClient(baseConfigs());

    await expect(computeOperatorPrices(client, "service-1", "country-1")).rejects.toThrow(
      "5sim: connection reset",
    );
  });
});
