import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { cancelOrder } from "@/lib/5sim/client";
import { manualRefundOrder } from "./manual-refund";

vi.mock("@/lib/5sim/client", () => ({
  cancelOrder: vi.fn(),
}));

const ORDER = {
  id: "order-1",
  user_id: "user-1",
  fivesim_order_id: "999",
  price_kobo: 150_000,
};

const PARAMS = { orderId: "order-1", adminId: "admin-1", reason: "Dispute — code never worked" };

// orderClaimResults is consumed in call order: [0] is the "pending" claim
// attempt, [1] (only reached if [0] returned no row) is the "sms_received"
// claim attempt — mirrors manualRefundOrder's two sequential conditional
// UPDATEs.
function fakeAdminClient(
  orderClaimResults: Array<{ data: unknown; error: unknown }>,
  ledgerInsertResult: { error: unknown } = { error: null },
  auditInsertResult: { error: unknown } = { error: null },
) {
  let callIndex = 0;
  const from = vi.fn((table: string) => {
    if (table === "orders") {
      const result = orderClaimResults[callIndex] ?? { data: null, error: null };
      callIndex += 1;
      return {
        update: () => ({
          eq: () => ({
            eq: () => ({
              select: () => ({
                maybeSingle: () => Promise.resolve(result),
              }),
            }),
          }),
        }),
      };
    }
    if (table === "wallet_transactions") {
      return { insert: () => Promise.resolve(ledgerInsertResult) };
    }
    if (table === "admin_audit_log") {
      return { insert: () => Promise.resolve(auditInsertResult) };
    }
    throw new Error(`Unexpected table: ${table}`);
  });
  return { from } as unknown as SupabaseClient<Database>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("manualRefundOrder", () => {
  it("claims a pending order, cancels upstream, and records an admin_adjustment ledger entry + audit log", async () => {
    vi.mocked(cancelOrder).mockResolvedValue({} as never);
    const client = fakeAdminClient([{ data: { ...ORDER, status: "cancelled_refunded" }, error: null }]);

    const result = await manualRefundOrder(client, PARAMS);

    expect(result).toEqual({ refunded: true });
    expect(cancelOrder).toHaveBeenCalledWith("999");
    expect(client.from).toHaveBeenCalledWith("wallet_transactions");
    expect(client.from).toHaveBeenCalledWith("admin_audit_log");
  });

  it("falls through to claiming an sms_received order when it wasn't pending, and skips the upstream cancel", async () => {
    const client = fakeAdminClient([
      { data: null, error: null }, // not pending
      { data: { ...ORDER, status: "cancelled_refunded" }, error: null }, // was sms_received
    ]);

    const result = await manualRefundOrder(client, PARAMS);

    expect(result).toEqual({ refunded: true });
    expect(cancelOrder).not.toHaveBeenCalled();
  });

  it("returns refunded:false when the order is already resolved (neither claim matches)", async () => {
    const client = fakeAdminClient([
      { data: null, error: null },
      { data: null, error: null },
    ]);

    const result = await manualRefundOrder(client, PARAMS);

    expect(result).toEqual({ refunded: false });
    expect(cancelOrder).not.toHaveBeenCalled();
  });

  it("throws if the pending claim query errors outright, without swallowing the error", async () => {
    const client = fakeAdminClient([{ data: null, error: { message: "db down" } }]);

    await expect(manualRefundOrder(client, PARAMS)).rejects.toMatchObject({ message: "db down" });
  });

  it("throws if the sms_received claim query errors outright", async () => {
    const client = fakeAdminClient([
      { data: null, error: null },
      { data: null, error: { message: "db down" } },
    ]);

    await expect(manualRefundOrder(client, PARAMS)).rejects.toMatchObject({ message: "db down" });
  });

  it("still refunds even when the upstream cancel call fails", async () => {
    vi.mocked(cancelOrder).mockRejectedValue(new Error("already used upstream"));
    const client = fakeAdminClient([{ data: { ...ORDER, status: "cancelled_refunded" }, error: null }]);

    await expect(manualRefundOrder(client, PARAMS)).resolves.toEqual({ refunded: true });
  });

  it("propagates a ledger insert failure instead of silently dropping the refund", async () => {
    vi.mocked(cancelOrder).mockResolvedValue({} as never);
    const client = fakeAdminClient(
      [{ data: { ...ORDER, status: "cancelled_refunded" }, error: null }],
      { error: { message: "ledger insert failed", code: "XX000" } },
    );

    await expect(manualRefundOrder(client, PARAMS)).rejects.toMatchObject({ message: "ledger insert failed" });
  });
});
