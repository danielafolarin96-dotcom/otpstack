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

function fakeAdminClient(
  claimResult: { data: unknown; error: unknown },
  ledgerInsertResult: { error: unknown },
) {
  const from = vi.fn((table: string) => {
    if (table === "orders") {
      return {
        update: () => ({
          eq: () => ({
            eq: () => ({
              select: () => ({
                maybeSingle: () => Promise.resolve(claimResult),
              }),
            }),
          }),
        }),
      };
    }
    if (table === "wallet_transactions") {
      return {
        insert: () => Promise.resolve(ledgerInsertResult),
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
    const client = fakeAdminClient({ data: { ...ORDER, status: "expired_refunded" }, error: null }, { error: null });

    const result = await expireAndRefundOrder(client, ORDER);

    expect(result).toEqual({ refunded: true });
    expect(cancelOrder).toHaveBeenCalledWith("999");
  });

  it("still refunds even when the upstream cancel call fails", async () => {
    vi.mocked(cancelOrder).mockRejectedValue(new Error("already expired upstream"));
    const client = fakeAdminClient({ data: { ...ORDER, status: "expired_refunded" }, error: null }, { error: null });

    await expect(expireAndRefundOrder(client, ORDER)).resolves.toEqual({ refunded: true });
  });

  it("throws if the claim update fails outright, without swallowing the error", async () => {
    const client = fakeAdminClient({ data: null, error: { message: "db down" } }, { error: null });

    await expect(expireAndRefundOrder(client, ORDER)).rejects.toMatchObject({ message: "db down" });
  });

  it("propagates a ledger insert failure instead of silently dropping the refund", async () => {
    vi.mocked(cancelOrder).mockResolvedValue({} as never);
    const client = fakeAdminClient(
      { data: { ...ORDER, status: "expired_refunded" }, error: null },
      { error: { message: "ledger insert failed", code: "XX000" } },
    );

    await expect(expireAndRefundOrder(client, ORDER)).rejects.toMatchObject({ message: "ledger insert failed" });
  });

  it("skips the refund and reports refunded:false when another path already resolved the order (zero rows claimed)", async () => {
    const client = fakeAdminClient({ data: null, error: null }, { error: null });

    const result = await expireAndRefundOrder(client, ORDER);

    expect(result).toEqual({ refunded: false });
    expect(cancelOrder).not.toHaveBeenCalled();
  });
});
