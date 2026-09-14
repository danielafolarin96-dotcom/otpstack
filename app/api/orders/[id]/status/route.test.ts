import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { checkOrder, type FiveSimOrder } from "@/lib/5sim/client";
import { recordWalletTransaction } from "@/lib/wallet/ledger";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/5sim/client", () => ({ checkOrder: vi.fn() }));

vi.mock("@/lib/wallet/ledger", () => ({
  recordWalletTransaction: vi.fn().mockResolvedValue({ inserted: true }),
}));

// Not exercised by these tests (they all stay within the 10-minute TTL) —
// mocked only so importing the route doesn't pull in its real Supabase/5sim
// dependencies.
vi.mock("@/lib/orders/expire-and-refund", () => ({
  expireAndRefundOrder: vi.fn(),
}));

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve({ auth: { getUser } }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

const USER = { id: "user-1" };

// Simulates .select("*").eq("id", id).maybeSingle() for the initial read,
// then .update(...).eq(...).eq(...).select().maybeSingle() for the write —
// tracked by whether .update() has been called yet, since both chains share
// every other method name.
function fakeAdminClient(initialOrder: unknown, updatedOrder: unknown) {
  let updateCalled = false;
  const builder = {
    select: () => builder,
    eq: () => builder,
    update: () => {
      updateCalled = true;
      return builder;
    },
    maybeSingle: () =>
      Promise.resolve(updateCalled ? { data: updatedOrder, error: null } : { data: initialOrder, error: null }),
    single: () => Promise.resolve({ data: initialOrder, error: null }),
  };
  return { from: vi.fn(() => builder) };
}

function makeRequest(id: string) {
  return new Request(`http://localhost:3000/api/orders/${id}/status`);
}

function baseOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    user_id: USER.id,
    status: "pending",
    fivesim_order_id: "999",
    phone_number: "+10000000000",
    otp_code: null,
    // Well within our own 10-minute TTL — these tests are specifically
    // about 5sim's own terminal status arriving first, not our TTL fallback.
    expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    price_kobo: 79626,
    ...overrides,
  };
}

function fivesimOrder(overrides: Partial<FiveSimOrder> = {}): FiveSimOrder {
  return {
    id: 999,
    phone: "+10000000000",
    operator: "op",
    product: "tiktok",
    price: 0.5,
    status: "PENDING",
    expires: new Date().toISOString(),
    sms: [],
    created_at: new Date().toISOString(),
    country: "usa",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: USER } });
});

describe("GET /api/orders/[id]/status", () => {
  it("credits the wallet when 5sim's own TIMEOUT arrives before our TTL fallback does (money bug fix, Sept 2026)", async () => {
    // Real bug: mapFiveSimOrderToStatus maps 5sim's TIMEOUT straight to our
    // expired_refunded enum value, and this branch used to just write that
    // status label without ever crediting the wallet — the order looked
    // refunded everywhere in the UI while the customer was never actually
    // paid back. Confirmed live: 5sim's own no-SMS timeout (~5 min) fires
    // routinely before our 10-minute TTL does, so this isn't a rare edge case.
    const initial = baseOrder();
    const updated = { ...initial, status: "expired_refunded", completed_at: new Date().toISOString() };
    vi.mocked(createAdminClient).mockReturnValue(fakeAdminClient(initial, updated) as never);
    vi.mocked(checkOrder).mockResolvedValue(fivesimOrder({ status: "TIMEOUT", sms: [] }));

    const response = await GET(makeRequest("order-1"), { params: Promise.resolve({ id: "order-1" }) });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.order.status).toBe("expired_refunded");
    expect(recordWalletTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: USER.id,
        type: "refund",
        amountKobo: 79626,
        reference: "refund_expired_order-1",
        orderId: "order-1",
      }),
    );
  });

  it("credits the wallet when 5sim's own CANCELED arrives, tagged as a cancellation refund not an expiry one", async () => {
    const initial = baseOrder();
    const updated = { ...initial, status: "cancelled_refunded", completed_at: new Date().toISOString() };
    vi.mocked(createAdminClient).mockReturnValue(fakeAdminClient(initial, updated) as never);
    vi.mocked(checkOrder).mockResolvedValue(fivesimOrder({ status: "CANCELED", sms: [] }));

    const response = await GET(makeRequest("order-1"), { params: Promise.resolve({ id: "order-1" }) });
    const json = await response.json();

    expect(json.order.status).toBe("cancelled_refunded");
    expect(recordWalletTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "refund", reference: "refund_cancelled_order-1" }),
    );
  });

  it("does not touch the wallet for an ordinary sms_received transition", async () => {
    const initial = baseOrder();
    const updated = { ...initial, status: "sms_received", otp_code: "123456", completed_at: new Date().toISOString() };
    vi.mocked(createAdminClient).mockReturnValue(fakeAdminClient(initial, updated) as never);
    vi.mocked(checkOrder).mockResolvedValue(
      fivesimOrder({ status: "RECEIVED", sms: [{ code: "123456" }] }),
    );

    const response = await GET(makeRequest("order-1"), { params: Promise.resolve({ id: "order-1" }) });
    const json = await response.json();

    expect(json.order.status).toBe("sms_received");
    expect(json.order.otpCode).toBe("123456");
    expect(recordWalletTransaction).not.toHaveBeenCalled();
  });

  it("does not touch the wallet when nothing has changed yet (still pending)", async () => {
    const initial = baseOrder();
    vi.mocked(createAdminClient).mockReturnValue(fakeAdminClient(initial, initial) as never);
    vi.mocked(checkOrder).mockResolvedValue(fivesimOrder({ status: "PENDING", sms: [] }));

    const response = await GET(makeRequest("order-1"), { params: Promise.resolve({ id: "order-1" }) });
    const json = await response.json();

    expect(json.order.status).toBe("pending");
    expect(recordWalletTransaction).not.toHaveBeenCalled();
  });
});
