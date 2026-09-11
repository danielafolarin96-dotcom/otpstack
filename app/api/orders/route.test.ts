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
});
