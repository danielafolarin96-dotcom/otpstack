import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
import { expireAndRefundOrder } from "@/lib/orders/expire-and-refund";

vi.mock("@/lib/orders/expire-and-refund", () => ({ expireAndRefundOrder: vi.fn() }));

const ORDER_A = { id: "order-a", status: "pending" };
const ORDER_B = { id: "order-b", status: "pending" };

function fakeAdminClient(orders: unknown[]) {
  const eq = vi.fn(() => builder);
  const builder: {
    select: () => typeof builder;
    eq: typeof eq;
    lt: () => typeof builder;
    then: (resolve: (v: unknown) => void) => void;
  } = {
    select: () => builder,
    eq,
    lt: () => builder,
    then: (resolve) => resolve({ data: orders, error: null }),
  };
  return { from: vi.fn(() => builder), eq };
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

function makeRequest(query: Record<string, string> = {}) {
  const url = new URL("http://localhost:3000/api/cron/expire-orders");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return new Request(url, { headers: { Authorization: "Bearer test-cron-secret" } });
}

beforeEach(async () => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-cron-secret";
  const { createAdminClient } = await import("@/lib/supabase/admin");
  vi.mocked(createAdminClient).mockReturnValue(fakeAdminClient([ORDER_A, ORDER_B]) as never);
  vi.mocked(expireAndRefundOrder).mockResolvedValue({ refunded: true });
});

describe("GET /api/cron/expire-orders", () => {
  it("rejects with 401 when the bearer token doesn't match CRON_SECRET", async () => {
    const request = new Request("http://localhost:3000/api/cron/expire-orders", {
      headers: { Authorization: "Bearer wrong-secret" },
    });

    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(expireAndRefundOrder).not.toHaveBeenCalled();
  });

  it("sweeps every expired pending order when no orderId is given — the GitHub Actions/daily-cron backstop path", async () => {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const client = fakeAdminClient([ORDER_A, ORDER_B]);
    vi.mocked(createAdminClient).mockReturnValue(client as never);

    const response = await GET(makeRequest());
    const json = await response.json();

    expect(client.eq).toHaveBeenCalledWith("status", "pending");
    expect(client.eq).not.toHaveBeenCalledWith("id", expect.anything());
    expect(expireAndRefundOrder).toHaveBeenCalledTimes(2);
    expect(json).toEqual({ processed: 2, skipped: 0, failed: 0 });
  });

  it("counts an order that another path already resolved as skipped, not processed", async () => {
    vi.mocked(expireAndRefundOrder).mockResolvedValueOnce({ refunded: true }).mockResolvedValueOnce({ refunded: false });

    const response = await GET(makeRequest());
    const json = await response.json();

    expect(json).toEqual({ processed: 1, skipped: 1, failed: 0 });
  });

  it("counts a thrown error as failed without aborting the rest of the sweep", async () => {
    vi.mocked(expireAndRefundOrder)
      .mockRejectedValueOnce(new Error("5sim unreachable"))
      .mockResolvedValueOnce({ refunded: true });

    const response = await GET(makeRequest());
    const json = await response.json();

    expect(json).toEqual({ processed: 1, skipped: 0, failed: 1 });
  });

  it("scopes to a single order when orderId is given — the QStash one-shot callback path", async () => {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const client = fakeAdminClient([ORDER_A]);
    vi.mocked(createAdminClient).mockReturnValue(client as never);

    const response = await GET(makeRequest({ orderId: "order-a" }));
    const json = await response.json();

    expect(client.eq).toHaveBeenCalledWith("id", "order-a");
    expect(expireAndRefundOrder).toHaveBeenCalledTimes(1);
    expect(json).toEqual({ processed: 1, skipped: 0, failed: 0 });
  });

  it("also accepts POST — QStash's publishJSON delivers its one-shot callback via POST, not GET", async () => {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const client = fakeAdminClient([ORDER_A]);
    vi.mocked(createAdminClient).mockReturnValue(client as never);

    const response = await POST(makeRequest({ orderId: "order-a" }));
    const json = await response.json();

    expect(client.eq).toHaveBeenCalledWith("id", "order-a");
    expect(json).toEqual({ processed: 1, skipped: 0, failed: 0 });
  });
});
