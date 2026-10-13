import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { cancelOrder, checkOrder, FiveSimError, type FiveSimOrder } from "@/lib/5sim/client";
import { expireAndRefundOrder } from "./expire-and-refund";

vi.mock("@/lib/5sim/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/5sim/client")>();
  return { FiveSimError: actual.FiveSimError, cancelOrder: vi.fn(), checkOrder: vi.fn() };
});

const EXPIRES_AT = "2026-10-12T02:10:53.000Z";

const ORDER = {
  id: "order-1",
  user_id: "user-1",
  fivesim_order_id: "999",
  price_kobo: 150_000,
  upstream_cost_kobo: 45_000,
  service_id: "service-1",
  country_code: "usa",
  expires_at: EXPIRES_AT,
};

function upstreamOrder(sms: FiveSimOrder["sms"]): FiveSimOrder {
  return {
    id: 999,
    phone: "+10000000000",
    operator: "virtual63",
    product: "signal",
    price: 0.14,
    status: sms && sms.length > 0 ? "RECEIVED" : "PENDING",
    expires: "2026-10-12T02:27:53.000Z",
    sms,
    created_at: "2026-10-12T02:07:53.000Z",
    country: "usa",
  };
}

// The "orders" table is updated twice per refunding call: once to
// atomically claim the row (update -> eq(id) -> eq(status) -> select ->
// maybeSingle), and once afterward to record whether the upstream cancel
// succeeded (update -> eq(id), awaited directly, no select). The on-time
// SMS path instead does a single sms_received claim with the same chain.
// Distinguish them by payload shape rather than call order, so this fake also works when two calls
// race against the same simulated row (see the race-guard test below).
function fakeAdminClient(options: {
  claimResult: { data: unknown; error: unknown } | (() => { data: unknown; error: unknown });
  deliverResult?: { data: unknown; error: unknown };
  onDeliver?: (payload: Record<string, unknown>) => void;
  onMark?: (payload: Record<string, unknown>) => void;
  ledgerInsertResult?: { error: unknown };
  markResult?: { error: unknown };
  financeLookupResult?: { data: unknown; error: unknown };
  financeInsertResult?: { error: unknown };
  onFinanceInsert?: (payload: Record<string, unknown>) => void;
  callOrder?: string[];
}) {
  const {
    claimResult,
    deliverResult = { data: null, error: null },
    onDeliver,
    onMark,
    ledgerInsertResult = { error: null },
    markResult = { error: null },
    financeLookupResult = { data: { provider: "5sim", payment_fee_kobo: 2_250 }, error: null },
    financeInsertResult = { error: null },
    onFinanceInsert,
    callOrder,
  } = options;

  const from = vi.fn((table: string) => {
    if (table === "orders") {
      return {
        update: (payload: Record<string, unknown>) => {
          if ("upstream_cancel_succeeded" in payload) {
            onMark?.(payload);
            return { eq: () => Promise.resolve(markResult) };
          }
          if (payload.status === "sms_received") {
            onDeliver?.(payload);
            return {
              eq: () => ({
                eq: () => ({
                  select: () => ({ maybeSingle: () => Promise.resolve(deliverResult) }),
                }),
              }),
            };
          }
          return {
            eq: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: () =>
                    Promise.resolve(typeof claimResult === "function" ? claimResult() : claimResult),
                }),
              }),
            }),
          };
        },
      };
    }
    if (table === "wallet_transactions") {
      return {
        insert: () => {
          callOrder?.push("wallet_transactions.insert");
          return Promise.resolve(ledgerInsertResult);
        },
      };
    }
    if (table === "finance_events") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve(financeLookupResult),
            }),
          }),
        }),
        insert: (payload: Record<string, unknown>) => {
          callOrder?.push("finance_events.insert");
          onFinanceInsert?.(payload);
          return Promise.resolve(financeInsertResult);
        },
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  });
  return { from } as unknown as SupabaseClient<Database>;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: 5sim reports no SMS yet, so every pre-existing test below
  // exercises the ordinary expire + refund path unchanged.
  vi.mocked(checkOrder).mockResolvedValue(upstreamOrder([]));
});

describe("expireAndRefundOrder", () => {
  it("claims the order, cancels upstream, and refunds the ledger", async () => {
    vi.mocked(cancelOrder).mockResolvedValue({} as never);
    const client = fakeAdminClient({
      claimResult: { data: { ...ORDER, status: "expired_refunded" }, error: null },
    });

    const result = await expireAndRefundOrder(client, ORDER);

    expect(result).toEqual({ refunded: true });
    expect(cancelOrder).toHaveBeenCalledWith("999");
  });

  it("still refunds even when the upstream cancel call fails", async () => {
    vi.mocked(cancelOrder).mockRejectedValue(new Error("already expired upstream"));
    const client = fakeAdminClient({
      claimResult: { data: { ...ORDER, status: "expired_refunded" }, error: null },
    });

    await expect(expireAndRefundOrder(client, ORDER)).resolves.toEqual({ refunded: true });
  });

  it("throws if the claim update fails outright, without swallowing the error", async () => {
    const client = fakeAdminClient({ claimResult: { data: null, error: { message: "db down" } } });

    await expect(expireAndRefundOrder(client, ORDER)).rejects.toMatchObject({ message: "db down" });
  });

  it("propagates a ledger insert failure instead of silently dropping the refund", async () => {
    vi.mocked(cancelOrder).mockResolvedValue({} as never);
    const client = fakeAdminClient({
      claimResult: { data: { ...ORDER, status: "expired_refunded" }, error: null },
      ledgerInsertResult: { error: { message: "ledger insert failed", code: "XX000" } },
    });

    await expect(expireAndRefundOrder(client, ORDER)).rejects.toMatchObject({ message: "ledger insert failed" });
  });

  it("skips the refund and reports refunded:false when another path already resolved the order (zero rows claimed)", async () => {
    const client = fakeAdminClient({ claimResult: { data: null, error: null } });

    const result = await expireAndRefundOrder(client, ORDER);

    expect(result).toEqual({ refunded: false });
    expect(cancelOrder).not.toHaveBeenCalled();
  });

  it("still completes the refund even if recording upstream_cancel_succeeded fails (best-effort, not money-critical)", async () => {
    vi.mocked(cancelOrder).mockResolvedValue({} as never);
    const client = fakeAdminClient({
      claimResult: { data: { ...ORDER, status: "expired_refunded" }, error: null },
      markResult: { error: { message: "column write failed" } },
    });

    await expect(expireAndRefundOrder(client, ORDER)).resolves.toEqual({ refunded: true });
  });

  it("attempts the upstream cancel before recording the wallet refund", async () => {
    const callOrder: string[] = [];
    vi.mocked(cancelOrder).mockImplementation(async () => {
      callOrder.push("cancelOrder");
      return {} as never;
    });
    const client = fakeAdminClient({
      claimResult: { data: { ...ORDER, status: "expired_refunded" }, error: null },
      callOrder,
    });

    await expireAndRefundOrder(client, ORDER);

    expect(callOrder).toEqual(["cancelOrder", "wallet_transactions.insert", "finance_events.insert"]);
  });

  it("still calls cancelOrder before the refund even when cancelOrder itself fails", async () => {
    const callOrder: string[] = [];
    vi.mocked(cancelOrder).mockImplementation(async () => {
      callOrder.push("cancelOrder");
      throw new Error("already expired upstream");
    });
    const client = fakeAdminClient({
      claimResult: { data: { ...ORDER, status: "expired_refunded" }, error: null },
      callOrder,
    });

    await expireAndRefundOrder(client, ORDER);

    expect(callOrder).toEqual(["cancelOrder", "wallet_transactions.insert", "finance_events.insert"]);
  });

  it("only refunds once when two expiry paths race for the same order — the DB-level claim is the actual guard", async () => {
    vi.mocked(cancelOrder).mockResolvedValue({} as never);
    let rowClaimed = false;

    const client = fakeAdminClient({
      claimResult: () => {
        if (rowClaimed) return { data: null, error: null };
        rowClaimed = true;
        return { data: { ...ORDER, status: "expired_refunded" }, error: null };
      },
    });

    const [first, second] = await Promise.all([
      expireAndRefundOrder(client, ORDER),
      expireAndRefundOrder(client, ORDER),
    ]);

    const refundedResults = [first, second].filter((r) => r.refunded);
    expect(refundedResults).toHaveLength(1);
    expect(cancelOrder).toHaveBeenCalledTimes(1);
  });

  it("reverses provider cost and the payment fee when the upstream cancel recovers the cost", async () => {
    vi.mocked(cancelOrder).mockResolvedValue({} as never);
    let insertedPayload: Record<string, unknown> | undefined;
    const client = fakeAdminClient({
      claimResult: { data: { ...ORDER, status: "expired_refunded" }, error: null },
      onFinanceInsert: (payload) => {
        insertedPayload = payload;
      },
    });

    await expireAndRefundOrder(client, ORDER);

    expect(insertedPayload).toMatchObject({
      event_type: "refund_issued",
      revenue_kobo: -150_000,
      provider_cost_kobo: -45_000, // cancelOrder succeeded -> recovered, reversed
      payment_fee_kobo: -2_250, // reverses the payment_fee_kobo recorded at purchase time
    });
  });

  it("does NOT reverse provider cost when the upstream cancel fails (a genuine, unrecovered loss)", async () => {
    vi.mocked(cancelOrder).mockRejectedValue(new Error("already expired upstream"));
    let insertedPayload: Record<string, unknown> | undefined;
    const client = fakeAdminClient({
      claimResult: { data: { ...ORDER, status: "expired_refunded" }, error: null },
      onFinanceInsert: (payload) => {
        insertedPayload = payload;
      },
    });

    await expireAndRefundOrder(client, ORDER);

    expect(insertedPayload).toMatchObject({
      provider_cost_kobo: 0, // not reversed -- 5sim keeps it, a real loss
    });
  });

  it("still completes the refund even if recording the finance_events reversal fails (best-effort)", async () => {
    vi.mocked(cancelOrder).mockResolvedValue({} as never);
    const client = fakeAdminClient({
      claimResult: { data: { ...ORDER, status: "expired_refunded" }, error: null },
      financeInsertResult: { error: { message: "finance_events insert failed" } },
    });

    await expect(expireAndRefundOrder(client, ORDER)).resolves.toEqual({ refunded: true });
  });

  describe("pre-refund 5sim SMS check (Oct 2026 money bug fix)", () => {
    it("records an on-time SMS as sms_received with the code — no refund, no cancel attempt", async () => {
      vi.mocked(checkOrder).mockResolvedValue(
        upstreamOrder([{ created_at: "2026-10-12T02:08:31.701Z", sender: "9192145402", code: "482913" }]),
      );
      let deliverPayload: Record<string, unknown> | undefined;
      const callOrder: string[] = [];
      const client = fakeAdminClient({
        claimResult: { data: { ...ORDER, status: "expired_refunded" }, error: null },
        deliverResult: { data: { ...ORDER, status: "sms_received", otp_code: "482913" }, error: null },
        onDeliver: (payload) => {
          deliverPayload = payload;
        },
        callOrder,
      });

      const result = await expireAndRefundOrder(client, ORDER);

      expect(result).toEqual({ refunded: false, smsReceived: true });
      expect(deliverPayload).toMatchObject({ status: "sms_received", otp_code: "482913" });
      expect(deliverPayload?.completed_at).toEqual(expect.any(String));
      expect(cancelOrder).not.toHaveBeenCalled();
      expect(callOrder).toEqual([]); // no wallet_transactions / finance_events writes
    });

    it("treats an SMS landing exactly at expires_at as on time", async () => {
      vi.mocked(checkOrder).mockResolvedValue(upstreamOrder([{ created_at: EXPIRES_AT, code: "111111" }]));
      const client = fakeAdminClient({
        claimResult: { data: { ...ORDER, status: "expired_refunded" }, error: null },
        deliverResult: { data: { ...ORDER, status: "sms_received" }, error: null },
      });

      await expect(expireAndRefundOrder(client, ORDER)).resolves.toEqual({ refunded: false, smsReceived: true });
      expect(cancelOrder).not.toHaveBeenCalled();
    });

    it("refunds as before when the SMS arrived after expires_at (late by our own terms)", async () => {
      vi.mocked(checkOrder).mockResolvedValue(
        upstreamOrder([{ created_at: "2026-10-12T02:10:54.000Z", code: "111111" }]),
      );
      vi.mocked(cancelOrder).mockRejectedValue(new FiveSimError("/user/cancel/999", 400, "order has sms"));
      const onDeliver = vi.fn();
      const callOrder: string[] = [];
      const client = fakeAdminClient({
        claimResult: { data: { ...ORDER, status: "expired_refunded" }, error: null },
        onDeliver,
        callOrder,
      });

      await expect(expireAndRefundOrder(client, ORDER)).resolves.toEqual({ refunded: true });
      expect(onDeliver).not.toHaveBeenCalled();
      expect(callOrder).toContain("wallet_transactions.insert");
    });

    it("refunds as before when the SMS has no parseable timestamp (not proven on time)", async () => {
      vi.mocked(checkOrder).mockResolvedValue(upstreamOrder([{ code: "111111" }]));
      vi.mocked(cancelOrder).mockResolvedValue({} as never);
      const onDeliver = vi.fn();
      const client = fakeAdminClient({
        claimResult: { data: { ...ORDER, status: "expired_refunded" }, error: null },
        onDeliver,
      });

      await expect(expireAndRefundOrder(client, ORDER)).resolves.toEqual({ refunded: true });
      expect(onDeliver).not.toHaveBeenCalled();
    });

    it("refunds as before when the 5sim check itself fails", async () => {
      vi.mocked(checkOrder).mockRejectedValue(new Error("5sim unreachable"));
      vi.mocked(cancelOrder).mockResolvedValue({} as never);
      const callOrder: string[] = [];
      const client = fakeAdminClient({
        claimResult: { data: { ...ORDER, status: "expired_refunded" }, error: null },
        callOrder,
      });

      await expect(expireAndRefundOrder(client, ORDER)).resolves.toEqual({ refunded: true });
      expect(cancelOrder).toHaveBeenCalledWith("999");
      expect(callOrder).toContain("wallet_transactions.insert");
    });

    it("reports refunded:false (not smsReceived) when another path resolved the order before the SMS could be recorded", async () => {
      vi.mocked(checkOrder).mockResolvedValue(
        upstreamOrder([{ created_at: "2026-10-12T02:08:31.701Z", code: "482913" }]),
      );
      const callOrder: string[] = [];
      const client = fakeAdminClient({
        claimResult: { data: { ...ORDER, status: "expired_refunded" }, error: null },
        deliverResult: { data: null, error: null },
        callOrder,
      });

      await expect(expireAndRefundOrder(client, ORDER)).resolves.toEqual({ refunded: false });
      expect(cancelOrder).not.toHaveBeenCalled();
      expect(callOrder).toEqual([]);
    });

    it("throws if recording the on-time SMS fails outright", async () => {
      vi.mocked(checkOrder).mockResolvedValue(
        upstreamOrder([{ created_at: "2026-10-12T02:08:31.701Z", code: "482913" }]),
      );
      const client = fakeAdminClient({
        claimResult: { data: { ...ORDER, status: "expired_refunded" }, error: null },
        deliverResult: { data: null, error: { message: "db down" } },
      });

      await expect(expireAndRefundOrder(client, ORDER)).rejects.toMatchObject({ message: "db down" });
      expect(cancelOrder).not.toHaveBeenCalled();
    });
  });

  describe("upstream_cancel_error", () => {
    it("stores 5sim's error message when the upstream cancel fails", async () => {
      vi.mocked(cancelOrder).mockRejectedValue(new FiveSimError("/user/cancel/999", 400, "order has sms"));
      let markPayload: Record<string, unknown> | undefined;
      const client = fakeAdminClient({
        claimResult: { data: { ...ORDER, status: "expired_refunded" }, error: null },
        onMark: (payload) => {
          markPayload = payload;
        },
      });

      await expireAndRefundOrder(client, ORDER);

      expect(markPayload).toEqual({
        upstream_cancel_succeeded: false,
        upstream_cancel_error: "5sim /user/cancel/999 failed: 400 order has sms",
      });
    });

    it("stores null when the upstream cancel succeeds", async () => {
      vi.mocked(cancelOrder).mockResolvedValue({} as never);
      let markPayload: Record<string, unknown> | undefined;
      const client = fakeAdminClient({
        claimResult: { data: { ...ORDER, status: "expired_refunded" }, error: null },
        onMark: (payload) => {
          markPayload = payload;
        },
      });

      await expireAndRefundOrder(client, ORDER);

      expect(markPayload).toEqual({ upstream_cancel_succeeded: true, upstream_cancel_error: null });
    });
  });
});
