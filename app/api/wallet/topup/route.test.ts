import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { initializeTransaction } from "@/lib/paystack/client";
import { checkRateLimit } from "@/lib/rate-limit/check";

vi.mock("@/lib/paystack/client", () => ({
  initializeTransaction: vi.fn(),
}));

vi.mock("@/lib/rate-limit/check", () => ({
  checkRateLimit: vi.fn(),
  getClientIp: () => "127.0.0.1",
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({}),
}));

const getUser = vi.fn();
const single = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: { getUser },
      from: () => ({ select: () => ({ eq: () => ({ single }) }) }),
    }),
}));

beforeEach(() => {
  vi.mocked(checkRateLimit).mockResolvedValue(true);
});

function makeRequest(body: unknown) {
  return new Request("http://localhost:3000/api/wallet/topup", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const USER = { id: "user-1", email: "user@example.com" };

describe("POST /api/wallet/topup", () => {
  it("starts a Paystack transaction when the account is not frozen", async () => {
    getUser.mockResolvedValue({ data: { user: USER } });
    single.mockResolvedValue({ data: { is_frozen: false }, error: null });
    vi.mocked(initializeTransaction).mockResolvedValue({
      status: true,
      message: "ok",
      data: { authorization_url: "https://paystack.test/pay/abc", access_code: "abc", reference: "topup_abc" },
    });

    const response = await POST(makeRequest({ amountKobo: 50_000 }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.authorizationUrl).toBe("https://paystack.test/pay/abc");
    expect(initializeTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ email: USER.email, amountKobo: 50_000 }),
    );
  });

  it("rejects with 429 and never contacts Paystack once the rate limit is hit", async () => {
    getUser.mockResolvedValue({ data: { user: USER } });
    single.mockResolvedValue({ data: { is_frozen: false }, error: null });
    vi.mocked(checkRateLimit).mockResolvedValue(false);

    const response = await POST(makeRequest({ amountKobo: 50_000 }));
    const json = await response.json();

    expect(response.status).toBe(429);
    expect(json.error).toMatch(/too many/i);
    expect(initializeTransaction).not.toHaveBeenCalled();
  });

  it("rejects with 403 and never contacts Paystack when the account is frozen", async () => {
    getUser.mockResolvedValue({ data: { user: USER } });
    single.mockResolvedValue({ data: { is_frozen: true }, error: null });

    const response = await POST(makeRequest({ amountKobo: 50_000 }));
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.error).toMatch(/frozen/i);
    expect(initializeTransaction).not.toHaveBeenCalled();
  });
});
