import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { computeOperatorPrices } from "@/lib/pricing/catalog";

vi.mock("@/lib/pricing/catalog", async () => {
  const actual = await vi.importActual<typeof import("@/lib/pricing/catalog")>("@/lib/pricing/catalog");
  return { ...actual, computeOperatorPrices: vi.fn() };
});

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve({ auth: { getUser } }),
}));

const USER = { id: "user-1" };

function makeRequest(params: Record<string, string>) {
  const query = new URLSearchParams(params).toString();
  return new Request(`http://localhost:3000/api/catalog/operators?${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/catalog/operators", () => {
  it("returns the ranked options, serialized with priceKobo but without ratePct", async () => {
    getUser.mockResolvedValue({ data: { user: USER } });
    const option = (operator: string, priceKobo: number, ratePct: number | null) => ({
      operator,
      price: { priceKobo, upstreamCostKobo: 0, marginPct: 44.7, ruleId: "r1", ruleScope: "global" as const },
      ratePct,
    });
    vi.mocked(computeOperatorPrices).mockResolvedValue({
      recommended: option("virtual28", 365427, 42.86),
      options: [option("virtual28", 365427, 42.86), option("virtual8", 222505, null)],
    });

    const response = await GET(makeRequest({ serviceId: "service-1", countryId: "country-1" }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.recommended).toEqual({ operator: "virtual28", priceKobo: 365427 });
    expect(json.options).toEqual([
      { operator: "virtual28", priceKobo: 365427 },
      { operator: "virtual8", priceKobo: 222505 },
    ]);
    expect(JSON.stringify(json)).not.toContain("ratePct");
  });

  it("returns an empty recommended/options pair, not an error, when nothing is sellable", async () => {
    getUser.mockResolvedValue({ data: { user: USER } });
    vi.mocked(computeOperatorPrices).mockResolvedValue(null);

    const response = await GET(makeRequest({ serviceId: "service-1", countryId: "country-1" }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ recommended: null, options: [] });
  });

  it("rejects with 400 when serviceId or countryId is missing, without calling computeOperatorPrices", async () => {
    getUser.mockResolvedValue({ data: { user: USER } });

    const response = await GET(makeRequest({ serviceId: "service-1" }));

    expect(response.status).toBe(400);
    expect(computeOperatorPrices).not.toHaveBeenCalled();
  });

  it("rejects with 401 when not authenticated, without calling computeOperatorPrices", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    const response = await GET(makeRequest({ serviceId: "service-1", countryId: "country-1" }));

    expect(response.status).toBe(401);
    expect(computeOperatorPrices).not.toHaveBeenCalled();
  });

  it("returns a 503 with a clean message instead of a raw crash when the upstream fetch fails", async () => {
    getUser.mockResolvedValue({ data: { user: USER } });
    vi.mocked(computeOperatorPrices).mockRejectedValue(new Error("5sim: connection reset"));

    const response = await GET(makeRequest({ serviceId: "service-1", countryId: "country-1" }));
    const json = await response.json();

    expect(response.status).toBe(503);
    expect(json.error).toMatch(/try again/i);
  });
});
