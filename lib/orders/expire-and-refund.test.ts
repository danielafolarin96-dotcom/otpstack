import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { cancelOrder, checkOrder, FiveSimError, type FiveSimOrder } from "@/lib/5sim/client";
import { cancelActivation, finishActivation, getActivationState, GrizzlyError } from "@/lib/grizzly/client";
import { scheduleUpstreamCancelRetry } from "@/lib/qstash/client";
import { expireAndRefundOrder } from "./expire-and-refund";

vi.mock("@/lib/5sim/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/5sim/client")>();
  return { FiveSimError: actual.FiveSimError, cancelOrder: vi.fn(), checkOrder: vi.fn() };
});

vi.mock("@/lib/grizzly/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/grizzly/client")>();
  return { ...actual, cancelActivation: vi.fn(), finishActivation: vi.fn(), getActivationState: vi.fn() };
});

vi.mock("@/lib/qstash/client", () => ({ scheduleUpstreamCancelRetry: vi.fn() }));

const EXPIRES_AT = "2026-10-12T02:10:53.000Z";

const ORDER = {
  id: "order-1",
  user_id: "user-1",
  fivesim_order_id: "999",
  provider_order_id: "999",
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
  onQueueUpsert?: (payload: Record<string, unknown>) => void;
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
    onQueueUpsert,
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
    if (table === "upstream_cancel_queue") {
      return {
        upsert: (payload: Record<string, unknown>) => {
          onQueueUpsert?.(payload);
          return Promise.resolve({ error: null });
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

  describe("Grizzly orders", () => {
    // Activation at 12:00:00 on Grizzly's clock, 09:00:01Z on ours; 5-minute hold.
    const GRIZZLY_ORDER = {
      ...ORDER,
      provider: "grizzly",
      provider_order_id: "38496653",
      fivesim_order_id: null,
      created_at: "2026-10-29T09:00:01.000Z",
      upstream_activation_time: "2026-10-29 12:00:00",
      expires_at: "2026-10-29T09:05:01.000Z",
    };
    const LOCKED = new GrizzlyError("setStatus", 200, "EARLY_CANCEL_DENIED");
    const claimed = { data: { ...GRIZZLY_ORDER, status: "expired_refunded" }, error: null };

    beforeEach(() => {
      vi.mocked(getActivationState).mockResolvedValue({ state: "waiting" });
    });

    it("cancels with setStatus 8 and reverses the cost when the cancel lands", async () => {
      vi.mocked(cancelActivation).mockResolvedValue(undefined);
      let markPayload: Record<string, unknown> | undefined;
      let financePayload: Record<string, unknown> | undefined;
      const client = fakeAdminClient({
        claimResult: claimed,
        onMark: (p) => (markPayload = p),
        onFinanceInsert: (p) => (financePayload = p),
      });

      await expect(expireAndRefundOrder(client, GRIZZLY_ORDER)).resolves.toEqual({ refunded: true });

      expect(cancelActivation).toHaveBeenCalledWith("38496653");
      expect(cancelOrder).not.toHaveBeenCalled();
      expect(markPayload).toEqual({ upstream_cancel_succeeded: true, upstream_cancel_error: null });
      expect(financePayload).toMatchObject({ provider_cost_kobo: -45_000 });
    });

    it("still refunds when the cancel is locked, books the cost as lost for now, and queues a retry", async () => {
      vi.mocked(cancelActivation).mockRejectedValue(LOCKED);
      let markPayload: Record<string, unknown> | undefined;
      let financePayload: Record<string, unknown> | undefined;
      let queued: Record<string, unknown> | undefined;
      const callOrder: string[] = [];
      const client = fakeAdminClient({
        claimResult: claimed,
        onMark: (p) => (markPayload = p),
        onFinanceInsert: (p) => (financePayload = p),
        onQueueUpsert: (p) => (queued = p),
        callOrder,
      });

      await expect(expireAndRefundOrder(client, GRIZZLY_ORDER)).resolves.toEqual({ refunded: true });

      expect(callOrder).toContain("wallet_transactions.insert");
      expect(markPayload).toEqual({
        upstream_cancel_succeeded: false,
        upstream_cancel_error: "grizzly setStatus failed: 200 EARLY_CANCEL_DENIED",
      });
      expect(financePayload).toMatchObject({ provider_cost_kobo: 0 });
      expect(queued).toMatchObject({
        provider: "grizzly",
        provider_order_id: "38496653",
        order_id: "order-1",
        reason: "cancel_locked",
      });
    });

    it("decision 6: a failed cancel on an activation Grizzly already cancelled counts as recovered, error kept", async () => {
      vi.mocked(cancelActivation).mockRejectedValue(new GrizzlyError("setStatus", 200, "BAD_STATUS"));
      vi.mocked(getActivationState).mockResolvedValueOnce({ state: "waiting" }).mockResolvedValueOnce({ state: "cancelled" });
      let markPayload: Record<string, unknown> | undefined;
      const onQueueUpsert = vi.fn();
      const client = fakeAdminClient({ claimResult: claimed, onMark: (p) => (markPayload = p), onQueueUpsert });

      await expireAndRefundOrder(client, GRIZZLY_ORDER);

      expect(markPayload).toEqual({
        upstream_cancel_succeeded: true,
        upstream_cancel_error: "grizzly setStatus failed: 200 BAD_STATUS",
      });
      expect(onQueueUpsert).not.toHaveBeenCalled();
    });

    it("delivers an SMS that arrived inside the hold (judged on Grizzly's clock) and completes the activation", async () => {
      vi.mocked(getActivationState).mockResolvedValue({
        state: "received",
        code: "852508",
        text: "Your code is 852508",
        smsDateTime: "2026-10-29 12:04:30",
      });
      let deliverPayload: Record<string, unknown> | undefined;
      const client = fakeAdminClient({
        claimResult: claimed,
        deliverResult: { data: { ...GRIZZLY_ORDER, status: "sms_received" }, error: null },
        onDeliver: (p) => (deliverPayload = p),
      });

      await expect(expireAndRefundOrder(client, GRIZZLY_ORDER)).resolves.toEqual({ refunded: false, smsReceived: true });

      expect(deliverPayload).toMatchObject({ status: "sms_received", otp_code: "852508" });
      expect(finishActivation).toHaveBeenCalledWith("38496653");
      expect(cancelActivation).not.toHaveBeenCalled();
    });

    describe("SMS present but its arrival time can't be determined", () => {
      const EXPIRES_MS = new Date(GRIZZLY_ORDER.expires_at).getTime();
      const noTime = { state: "received" as const, code: "852508", text: null, smsDateTime: null };

      afterEach(() => {
        vi.useRealTimers();
      });

      it("delivers the code when the expiry check runs within 60s after expires_at", async () => {
        vi.useFakeTimers({ now: EXPIRES_MS + 30_000, toFake: ["Date"] });
        vi.mocked(getActivationState).mockResolvedValue(noTime);
        let deliverPayload: Record<string, unknown> | undefined;
        const callOrder: string[] = [];
        const client = fakeAdminClient({
          claimResult: claimed,
          deliverResult: { data: { ...GRIZZLY_ORDER, status: "sms_received" }, error: null },
          onDeliver: (p) => (deliverPayload = p),
          callOrder,
        });

        await expect(expireAndRefundOrder(client, GRIZZLY_ORDER)).resolves.toEqual({ refunded: false, smsReceived: true });

        expect(deliverPayload).toMatchObject({ status: "sms_received", otp_code: "852508" });
        expect(callOrder).toEqual([]); // no refund, no finance reversal
        expect(cancelActivation).not.toHaveBeenCalled();
      });

      it("also delivers when it's our activation time that's missing", async () => {
        vi.useFakeTimers({ now: EXPIRES_MS + 30_000, toFake: ["Date"] });
        vi.mocked(getActivationState).mockResolvedValue({ ...noTime, smsDateTime: "2026-10-29 12:01:00" });
        const client = fakeAdminClient({
          claimResult: claimed,
          deliverResult: { data: { ...GRIZZLY_ORDER, status: "sms_received" }, error: null },
        });

        await expect(
          expireAndRefundOrder(client, { ...GRIZZLY_ORDER, upstream_activation_time: null }),
        ).resolves.toEqual({ refunded: false, smsReceived: true });
      });

      it("refunds as before when the check runs more than 60s after expires_at", async () => {
        vi.useFakeTimers({ now: EXPIRES_MS + 90_000, toFake: ["Date"] });
        vi.mocked(getActivationState).mockResolvedValue(noTime);
        vi.mocked(cancelActivation).mockRejectedValue(new GrizzlyError("setStatus", 200, "BAD_STATUS"));
        const onDeliver = vi.fn();
        const callOrder: string[] = [];
        const client = fakeAdminClient({ claimResult: claimed, onDeliver, callOrder });

        await expect(expireAndRefundOrder(client, GRIZZLY_ORDER)).resolves.toEqual({ refunded: true });

        expect(onDeliver).not.toHaveBeenCalled();
        expect(callOrder).toContain("wallet_transactions.insert");
      });

      it("does not extend the grace to 5sim: an untimestamped 5sim SMS still refunds", async () => {
        vi.useFakeTimers({ now: new Date(ORDER.expires_at).getTime() + 30_000, toFake: ["Date"] });
        vi.mocked(checkOrder).mockResolvedValue(upstreamOrder([{ code: "111111" }]));
        vi.mocked(cancelOrder).mockResolvedValue({} as never);
        const onDeliver = vi.fn();
        const client = fakeAdminClient({ claimResult: { data: { ...ORDER, status: "expired_refunded" }, error: null }, onDeliver });

        await expect(expireAndRefundOrder(client, ORDER)).resolves.toEqual({ refunded: true });
        expect(onDeliver).not.toHaveBeenCalled();
      });
    });

    it("still credits the wallet when the locked cancel's retry scheduling throws", async () => {
      vi.mocked(cancelActivation).mockRejectedValue(LOCKED);
      vi.mocked(scheduleUpstreamCancelRetry).mockRejectedValueOnce(new Error("qstash down"));
      const callOrder: string[] = [];
      const onQueueUpsert = vi.fn();
      const client = fakeAdminClient({ claimResult: claimed, callOrder, onQueueUpsert });

      await expect(expireAndRefundOrder(client, GRIZZLY_ORDER)).resolves.toEqual({ refunded: true });

      expect(onQueueUpsert).toHaveBeenCalled();
      expect(callOrder).toEqual(["wallet_transactions.insert", "finance_events.insert"]);
    });

    it("refunds when the SMS landed after the hold ended", async () => {
      vi.mocked(getActivationState).mockResolvedValue({
        state: "received",
        code: "852508",
        text: null,
        smsDateTime: "2026-10-29 12:05:30",
      });
      vi.mocked(cancelActivation).mockRejectedValue(new GrizzlyError("setStatus", 200, "BAD_STATUS"));
      const onDeliver = vi.fn();
      const client = fakeAdminClient({ claimResult: claimed, onDeliver });

      await expect(expireAndRefundOrder(client, GRIZZLY_ORDER)).resolves.toEqual({ refunded: true });
      expect(onDeliver).not.toHaveBeenCalled();
    });
  });

  it("decision 6 (5sim): a failed cancel on an order 5sim already timed out with no SMS counts as recovered", async () => {
    vi.mocked(cancelOrder).mockRejectedValue(new FiveSimError("/user/cancel/999", 400, "order expired"));
    vi.mocked(checkOrder)
      .mockResolvedValueOnce(upstreamOrder([]))
      .mockResolvedValueOnce({ ...upstreamOrder([]), status: "TIMEOUT" });
    let markPayload: Record<string, unknown> | undefined;
    let financePayload: Record<string, unknown> | undefined;
    const client = fakeAdminClient({
      claimResult: { data: { ...ORDER, status: "expired_refunded" }, error: null },
      onMark: (p) => (markPayload = p),
      onFinanceInsert: (p) => (financePayload = p),
    });

    await expireAndRefundOrder(client, ORDER);

    expect(markPayload).toEqual({
      upstream_cancel_succeeded: true,
      upstream_cancel_error: "5sim /user/cancel/999 failed: 400 order expired",
    });
    expect(financePayload).toMatchObject({ provider_cost_kobo: -45_000 });
  });
});
