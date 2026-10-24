import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { PurchaseError, purchaseNumber } from "@/lib/orders/purchase";
import { recordPurchaseFailure } from "@/lib/orders/purchase-failures";
import { checkRateLimit } from "@/lib/rate-limit/check";

vi.mock("@/lib/orders/purchase-failures", () => ({ recordPurchaseFailure: vi.fn() }));

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

    const response = await POST(
      makeRequest({ serviceId: "service-1", countryId: "country-1", operator: "virtual2" }),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.order.id).toBe("order-1");
    expect(purchaseNumber).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        serviceId: "service-1",
        countryId: "country-1",
        operator: "virtual2",
      }),
    );
  });

  it("rejects with 400 when operator is missing from the body, without ever calling purchaseNumber", async () => {
    getUser.mockResolvedValue({ data: { user: USER } });

    const response = await POST(makeRequest({ serviceId: "service-1", countryId: "country-1" }));
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toMatch(/operator/i);
    expect(purchaseNumber).not.toHaveBeenCalled();
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

    const response = await POST(
      makeRequest({ serviceId: "service-1", countryId: "country-1", operator: "virtual2" }),
    );
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

  describe("purchase failure logging", () => {
    const BODY = { serviceId: "service-1", countryId: "country-1", operator: "virtual2" };

    it("does not record anything on a successful purchase", async () => {
      getUser.mockResolvedValue({ data: { user: USER } });
      vi.mocked(purchaseNumber).mockResolvedValue({
        order: { id: "order-1", phoneNumber: "+2348000000000", expiresAt: new Date().toISOString() },
      });

      await POST(makeRequest(BODY));

      expect(recordPurchaseFailure).not.toHaveBeenCalled();
    });

    it("does not record an unauthenticated attempt — no user to attribute it to", async () => {
      getUser.mockResolvedValue({ data: { user: null } });
      await POST(makeRequest(BODY));
      expect(recordPurchaseFailure).not.toHaveBeenCalled();
    });

    it("records a PurchaseError with its reason, status, request fields, and the server-side detail", async () => {
      getUser.mockResolvedValue({ data: { user: USER } });
      vi.mocked(purchaseNumber).mockRejectedValue(
        new PurchaseError("No numbers currently available", 502, {
          reason: "upstream_no_numbers",
          internalMessage: "5sim ... failed: 200 no free phones",
        }),
      );

      const response = await POST(makeRequest(BODY));
      const json = await response.json();

      expect(recordPurchaseFailure).toHaveBeenCalledWith(expect.anything(), {
        userId: "user-1",
        serviceId: "service-1",
        countryId: "country-1",
        operator: "virtual2",
        reason: "upstream_no_numbers",
        httpStatus: 502,
        message: "5sim ... failed: 200 no free phones",
      });
      // The customer still only sees the mapped message, never the internal one.
      expect(json).toEqual({ error: "No numbers currently available" });
    });

    it("records rate limiting as rate_limited", async () => {
      getUser.mockResolvedValue({ data: { user: USER } });
      vi.mocked(checkRateLimit).mockResolvedValue(false);

      await POST(makeRequest(BODY));

      expect(recordPurchaseFailure).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ reason: "rate_limited", httpStatus: 429 }),
      );
    });

    it("records a malformed body as other/400", async () => {
      getUser.mockResolvedValue({ data: { user: USER } });

      await POST(makeRequest({ serviceId: "service-1" }));

      expect(recordPurchaseFailure).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ reason: "other", httpStatus: 400, serviceId: "service-1" }),
      );
    });

    it("records an unexpected error as other/500", async () => {
      getUser.mockResolvedValue({ data: { user: USER } });
      vi.mocked(purchaseNumber).mockRejectedValue({ message: "connection reset", code: "08000" });

      const response = await POST(makeRequest(BODY));

      expect(response.status).toBe(500);
      expect(recordPurchaseFailure).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ reason: "other", httpStatus: 500, message: "connection reset" }),
      );
    });
  });

  describe("insufficient balance", () => {
    it("returns the shortfall alongside the 402 error so the client can offer a top-up", async () => {
      getUser.mockResolvedValue({ data: { user: USER } });
      vi.mocked(purchaseNumber).mockRejectedValue(
        new PurchaseError("Insufficient wallet balance", 402, {
          reason: "insufficient_balance",
          shortfallKobo: 39_600,
        }),
      );

      const response = await POST(
        makeRequest({ serviceId: "service-1", countryId: "country-1", operator: "virtual2" }),
      );
      const json = await response.json();

      expect(response.status).toBe(402);
      expect(json).toEqual({ error: "Insufficient wallet balance", shortfallKobo: 39_600 });
    });

    it("omits shortfallKobo when it isn't known", async () => {
      getUser.mockResolvedValue({ data: { user: USER } });
      vi.mocked(purchaseNumber).mockRejectedValue(
        new PurchaseError("Insufficient wallet balance", 402, { reason: "insufficient_balance" }),
      );

      const response = await POST(
        makeRequest({ serviceId: "service-1", countryId: "country-1", operator: "virtual2" }),
      );

      expect(await response.json()).toEqual({ error: "Insufficient wallet balance" });
    });
  });
});
