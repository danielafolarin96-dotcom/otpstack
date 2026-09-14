import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { purchaseNumber } from "@/lib/orders/purchase";
import { checkRateLimit } from "@/lib/rate-limit/check";

vi.mock("@/lib/orders/purchase", async () => {
  const actual = await vi.importActual<typeof import("@/lib/orders/purchase")>(
    "@/lib/orders/purchase",
  );
  return { ...actual, purchaseNumber: vi.fn() };
});

vi.mock("@/lib/rate-limit/check", () => ({
  checkRateLimit: vi.fn(),
  getClientIp: () => "127.0.0.1",
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({}),
}));

const getUser = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve({ auth: { getUser } }),
}));

function makeRequest(body: unknown) {
  return new Request("http://localhost:3000/api/orders", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const USER = { id: "user-1", email: "user@example.com" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkRateLimit).mockResolvedValue(true);
});

describe("POST /api/orders", () => {
  it("purchases a number when authenticated and under the rate limit", async () => {
    getUser.mockResolvedValue({ data: { user: USER } });
    vi.mocked(purchaseNumber).mockResolvedValue({
      order: { id: "order-1", phoneNumber: "+2348000000000", expiresAt: new Date().toISOString() },
    });

    const response = await POST(makeRequest({ serviceId: "service-1", countryId: "country-1" }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.order.id).toBe("order-1");
    expect(purchaseNumber).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: "user-1", serviceId: "service-1", countryId: "country-1" }),
    );
  });

  it("rejects with 401 without ever checking the rate limit or purchasing", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    const response = await POST(makeRequest({ serviceId: "service-1", countryId: "country-1" }));

    expect(response.status).toBe(401);
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(purchaseNumber).not.toHaveBeenCalled();
  });

  it("rejects with 429 and never purchases once the rate limit is hit", async () => {
    getUser.mockResolvedValue({ data: { user: USER } });
    vi.mocked(checkRateLimit).mockResolvedValue(false);

    const response = await POST(makeRequest({ serviceId: "service-1", countryId: "country-1" }));
    const json = await response.json();

    expect(response.status).toBe(429);
    expect(json.error).toMatch(/too many/i);
    expect(purchaseNumber).not.toHaveBeenCalled();
  });

  it("returns a clean JSON error, not a raw crash, when the 5sim buy call fails (real bug, Sept 2026)", async () => {
    // Confirmed live: 5sim's "no free phones" response used to produce an
    // uncaught parser exception that reached the customer verbatim (see
    // lib/5sim/client.ts's fiveSimFetch and lib/orders/purchase.ts).
    // purchaseNumber (lib/orders/purchase.ts) is responsible for mapping
    // that to a clean PurchaseError — this test locks in that the route
    // still just forwards it as ordinary JSON, same as any other
    // PurchaseError, rather than letting anything escape uncaught.
    getUser.mockResolvedValue({ data: { user: USER } });
    const { PurchaseError } = await import("@/lib/orders/purchase");
    vi.mocked(purchaseNumber).mockRejectedValue(
      new PurchaseError(
        "No numbers currently available for this service/country — try again shortly or pick a different country.",
        502,
      ),
    );

    const response = await POST(makeRequest({ serviceId: "service-1", countryId: "country-1" }));
    const json = await response.json();

    expect(response.status).toBe(502);
    expect(json.error).toBe(
      "No numbers currently available for this service/country — try again shortly or pick a different country.",
    );
  });

  it("returns a JSON 500 instead of an unhandled crash when something throws before purchaseNumber is even called", async () => {
    // Bug fix (Sept 2026): the auth check, both rate-limit lookups, and
    // body parsing used to run outside any try/catch — only the final
    // purchaseNumber() call was guarded. A throw anywhere above that
    // point (e.g. a transient checkRateLimit failure, simulated here)
    // used to become a raw, non-JSON error instead of the JSON response
    // BuyableCatalogGrid expects. The whole handler is now one try/catch.
    getUser.mockResolvedValue({ data: { user: USER } });
    vi.mocked(checkRateLimit).mockRejectedValue(new Error("rate_limits table unreachable"));

    const response = await POST(makeRequest({ serviceId: "service-1", countryId: "country-1" }));
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.error).toBe("Something went wrong");
    expect(purchaseNumber).not.toHaveBeenCalled();
  });
});
