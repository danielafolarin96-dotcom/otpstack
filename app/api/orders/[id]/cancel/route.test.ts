import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { cancelOrder, checkOrder, FiveSimError, type FiveSimOrder } from "@/lib/5sim/client";
import { recordWalletTransaction } from "@/lib/wallet/ledger";
import { recordFinanceEvent } from "@/lib/finance/ledger";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/5sim/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/5sim/client")>();
  return { FiveSimError: actual.FiveSimError, checkOrder: vi.fn(), cancelOrder: vi.fn() };
});

vi.mock("@/lib/wallet/ledger", () => ({
  recordWalletTransaction: vi.fn().mockResolvedValue({ inserted: true }),
}));

vi.mock("@/lib/finance/ledger", () => ({
  recordFinanceEvent: vi.fn().mockResolvedValue(undefined),
}));

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve({ auth: { getUser } }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

const USER = { id: "user-1" };

function baseOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    user_id: USER.id,
    status: "pending",
    fivesim_order_id: "999",
    phone_number: "+10000000000",
    otp_code: null,
    expires_at: new Date(Date.now() + 2 * 60_000).toISOString(),
    price_kobo: 79_626,
    upstream_cost_kobo: 30_000,
    service_id: "service-1",
    country_code: "usa",
    ...overrides,
  };
}

function upstreamOrder(sms: FiveSimOrder["sms"]): FiveSimOrder {
  return {
    id: 999,
    phone: "+10000000000",
    operator: "virtual28",
    product: "signal",
    price: 0.0385,
    status: sms && sms.length > 0 ? "RECEIVED" : "PENDING",
    expires: new Date(Date.now() + 15 * 60_000).toISOString(),
    sms,
    created_at: new Date().toISOString(),
    country: "usa",
  };
}

// orders: an initial select().eq().maybeSingle() read, then conditional
// claims via update(payload).eq().eq().select().maybeSingle() — told apart
// by payload.status (sms_received vs cancelled_refunded) — and the
// best-effort upstream_cancel_succeeded mark via update(payload).eq().
function fakeAdminClient(options: {
  order: unknown;
  cancelClaimResult?: { data: unknown; error: unknown };
  deliverResult?: { data: unknown; error: unknown };
  updates: Record<string, unknown>[];
}) {
  const { order, updates } = options;
  const cancelClaimResult = options.cancelClaimResult ?? {
    data: { ...(order as object), status: "cancelled_refunded" },
    error: null,
  };
  const deliverResult = options.deliverResult ?? { data: null, error: null };

  const from = vi.fn((table: string) => {
    if (table === "orders") {
      return {
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: order, error: null }) }) }),
        update: (payload: Record<string, unknown>) => {
          updates.push(payload);
          if ("upstream_cancel_succeeded" in payload) {
            return { eq: () => Promise.resolve({ error: null }) };
          }
          const result = payload.status === "sms_received" ? deliverResult : cancelClaimResult;
          return {
            eq: () => ({ eq: () => ({ select: () => ({ maybeSingle: () => Promise.resolve(result) }) }) }),
          };
        },
      };
    }
    if (table === "finance_events") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  });
  return { from };
}

function makeRequest(id = "order-1") {
  return new Request(`http://localhost:3000/api/orders/${id}/cancel`, { method: "POST" });
}

function call(id = "order-1") {
  return POST(makeRequest(id), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: USER } });
  vi.mocked(checkOrder).mockResolvedValue(upstreamOrder([]));
  vi.mocked(cancelOrder).mockResolvedValue({} as never);
});

describe("POST /api/orders/[id]/cancel", () => {
  it("rejects an unauthenticated request", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const response = await call();
    expect(response.status).toBe(401);
  });

  it("happy path: no SMS upstream -> claims, cancels at 5sim, refunds", async () => {
    const updates: Record<string, unknown>[] = [];
    vi.mocked(createAdminClient).mockReturnValue(fakeAdminClient({ order: baseOrder(), updates }) as never);

    const response = await call();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(checkOrder).toHaveBeenCalledWith("999");
    expect(cancelOrder).toHaveBeenCalledWith("999");
    expect(updates[0]).toMatchObject({ status: "cancelled_refunded" });
    expect(updates).toContainEqual({ upstream_cancel_succeeded: true, upstream_cancel_error: null });
    expect(recordWalletTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "refund", amountKobo: 79_626, reference: "refund_cancelled_order-1" }),
    );
  });

  it("SMS already at 5sim -> records sms_received with the code, no cancel, no refund, returns the order", async () => {
    vi.mocked(checkOrder).mockResolvedValue(
      upstreamOrder([{ created_at: new Date().toISOString(), sender: "12079557465", code: "482913" }]),
    );
    const updates: Record<string, unknown>[] = [];
    vi.mocked(createAdminClient).mockReturnValue(
      fakeAdminClient({
        order: baseOrder(),
        deliverResult: { data: baseOrder({ status: "sms_received", otp_code: "482913" }), error: null },
        updates,
      }) as never,
    );

    const response = await call();
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.order).toMatchObject({ id: "order-1", status: "sms_received", otpCode: "482913" });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ status: "sms_received", otp_code: "482913", completed_at: expect.any(String) });
    expect(cancelOrder).not.toHaveBeenCalled();
    expect(recordWalletTransaction).not.toHaveBeenCalled();
    expect(recordFinanceEvent).not.toHaveBeenCalled();
  });

  it("SMS already at 5sim but another path resolved the order first -> 409, no refund", async () => {
    vi.mocked(checkOrder).mockResolvedValue(upstreamOrder([{ created_at: new Date().toISOString(), code: "1" }]));
    const updates: Record<string, unknown>[] = [];
    vi.mocked(createAdminClient).mockReturnValue(
      fakeAdminClient({ order: baseOrder(), deliverResult: { data: null, error: null }, updates }) as never,
    );

    const response = await call();

    expect(response.status).toBe(409);
    expect(cancelOrder).not.toHaveBeenCalled();
    expect(recordWalletTransaction).not.toHaveBeenCalled();
  });

  it("5sim check fails -> falls back to the ordinary cancel + refund", async () => {
    vi.mocked(checkOrder).mockRejectedValue(new Error("5sim unreachable"));
    const updates: Record<string, unknown>[] = [];
    vi.mocked(createAdminClient).mockReturnValue(fakeAdminClient({ order: baseOrder(), updates }) as never);

    const response = await call();

    expect(response.status).toBe(200);
    expect(cancelOrder).toHaveBeenCalledWith("999");
    expect(recordWalletTransaction).toHaveBeenCalledTimes(1);
  });

  it("upstream cancel fails -> still refunds, and stores 5sim's error message", async () => {
    vi.mocked(cancelOrder).mockRejectedValue(new FiveSimError("/user/cancel/999", 400, "order has sms"));
    const updates: Record<string, unknown>[] = [];
    vi.mocked(createAdminClient).mockReturnValue(fakeAdminClient({ order: baseOrder(), updates }) as never);

    const response = await call();

    expect(response.status).toBe(200);
    expect(updates).toContainEqual({
      upstream_cancel_succeeded: false,
      upstream_cancel_error: "5sim /user/cancel/999 failed: 400 order has sms",
    });
    expect(recordWalletTransaction).toHaveBeenCalledTimes(1);
  });

  it("cancel claim lost to another path -> 409, no 5sim cancel, no refund", async () => {
    const updates: Record<string, unknown>[] = [];
    vi.mocked(createAdminClient).mockReturnValue(
      fakeAdminClient({ order: baseOrder(), cancelClaimResult: { data: null, error: null }, updates }) as never,
    );

    const response = await call();

    expect(response.status).toBe(409);
    expect(cancelOrder).not.toHaveBeenCalled();
    expect(recordWalletTransaction).not.toHaveBeenCalled();
  });

  it("already-expired order -> 409 before any 5sim call", async () => {
    const updates: Record<string, unknown>[] = [];
    vi.mocked(createAdminClient).mockReturnValue(
      fakeAdminClient({
        order: baseOrder({ expires_at: new Date(Date.now() - 1000).toISOString() }),
        updates,
      }) as never,
    );

    const response = await call();

    expect(response.status).toBe(409);
    expect(checkOrder).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });
});
