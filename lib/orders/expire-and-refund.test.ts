import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { cancelOrder } from "@/lib/5sim/client";
import { expireAndRefundOrder } from "./expire-and-refund";

vi.mock("@/lib/5sim/client", () => ({
  cancelOrder: vi.fn(),
}));

const ORDER = {
  id: "order-1",
  user_id: "user-1",
  fivesim_order_id: "999",
  price_kobo: 150_000,
};

// The "orders" table is updated twice per call: once to atomically claim
// the row (update -> eq(id) -> eq(status) -> select -> maybeSingle), and
// once afterward to record whether the upstream cancel succeeded (update ->
// eq(id), awaited directly, no select). Distinguish the two by payload
// shape rather than call order, so this fake also works when two calls
// race against the same simulated row (see the race-guard test below).
function fakeAdminClient(options: {
  claimResult: { data: unknown; error: unknown } | (() => { data: unknown; error: unknown });
  ledgerInsertResult?: { error: unknown };
  markResult?: { error: unknown };
  callOrder?: string[];
}) {
  const { claimResult, ledgerInsertResult = { error: null }, markResult = { error: null }, callOrder } = options;

  const from = vi.fn((table: string) => {
    if (table === "orders") {
      return {
        update: (payload: Record<string, unknown>) => {
          if ("upstream_cancel_succeeded" in payload) {
            return { eq: () => Promise.resolve(markResult) };
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
    throw new Error(`Unexpected table: ${table}`);
  });
  return { from } as unknown as SupabaseClient<Database>;
}

beforeEach(() => {
  vi.clearAllMocks();
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

    expect(callOrder).toEqual(["cancelOrder", "wallet_transactions.insert"]);
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

    expect(callOrder).toEqual(["cancelOrder", "wallet_transactions.insert"]);
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
});
