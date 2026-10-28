import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getOperatorPrices, getProductPrices } from "@/lib/5sim/client";
import { computeCatalogPrices, computeOperatorPrices } from "./catalog";

vi.mock("@/lib/5sim/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/5sim/client")>("@/lib/5sim/client");
  return { ...actual, getOperatorPrices: vi.fn(), getProductPrices: vi.fn() };
});

const SERVICE = { fivesim_product_code: "whatsapp", provider: "5sim" };
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
      lte: () => typeof builder;
      order: () => typeof builder;
      limit: () => typeof builder;
      maybeSingle: () => Promise<unknown>;
      then: (resolve: (v: unknown) => void) => void;
    } = {
      select: () => builder,
      eq: () => builder,
      lte: () => builder,
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

  it("prices from the provider's funding rate when it is above market", async () => {
    const op = { operator: "virtual28", cost: 1, count: 100, rate: 42 };
    vi.mocked(getOperatorPrices).mockResolvedValue({ recommended: op, options: [op] });
    const configs = baseConfigs();
    configs.fx_rates = { data: { rate: 1353 }, error: null };
    configs.provider_funding_rates = { data: [{ provider: "5sim", ngn_per_usd: 1562 }], error: null };
    const client = fakeAdminClient(configs);

    const result = await computeOperatorPrices(client, "service-1", "country-1");

    // 1 USD * 1562 = 156,200 kobo cost; 100% markup -> 312,400 kobo.
    expect(result!.recommended.price.upstreamCostKobo).toBe(156_200);
    expect(result!.recommended.price.priceKobo).toBe(312_400);
  });

  it("reports the rate the operator was judged on — rate168 when present", async () => {
    const op = { operator: "virtual28", cost: 1, count: 100, rate: 11, rate168: 30 };
    vi.mocked(getOperatorPrices).mockResolvedValue({ recommended: op, options: [op] });
    const client = fakeAdminClient(baseConfigs());

    const result = await computeOperatorPrices(client, "service-1", "country-1");

    expect(result!.recommended.ratePct).toBe(30);
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

describe("computeCatalogPrices", () => {
  const serviceRow = (name: string, code: string) => ({
    id: `svc-${code}`,
    name,
    category: "Messaging",
    icon_key: code,
    fivesim_product_code: code,
  });
  const catalogConfigs = () => ({
    ...baseConfigs(),
    services: {
      data: [serviceRow("Telegram", "telegram"), serviceRow("WeChat", "wechat"), serviceRow("WhatsApp", "whatsapp")],
      error: null,
    },
  });

  it("prices listed+available apps, keeps listed-but-unavailable apps as price:null, and drops apps 5sim doesn't list here", async () => {
    vi.mocked(getProductPrices).mockResolvedValue({
      whatsapp: { operator: "virtual28", cost: 1, count: 100, rate: 42 },
      telegram: null, // listed in this country, but out of stock / below the floor
      // wechat: not listed for this country at all
    });
    const client = fakeAdminClient(catalogConfigs());

    const entries = await computeCatalogPrices(client, "country-1");

    expect(entries.map((e) => e.service.name)).toEqual(["Telegram", "WhatsApp"]);
    expect(entries.find((e) => e.service.name === "Telegram")!.price).toBeNull();
    expect(entries.find((e) => e.service.name === "WhatsApp")!.price!.priceKobo).toBe(320_000);
    expect(getProductPrices).toHaveBeenCalledWith("usa");
  });

  it("shows every service as unavailable (none hidden) when 5sim can't be reached — no listing to filter by", async () => {
    vi.mocked(getProductPrices).mockRejectedValue(new Error("5sim: connection reset"));
    const client = fakeAdminClient(catalogConfigs());

    const entries = await computeCatalogPrices(client, "country-1");

    expect(entries.map((e) => e.service.name)).toEqual(["Telegram", "WeChat", "WhatsApp"]);
    expect(entries.every((e) => e.price === null)).toBe(true);
  });
});
