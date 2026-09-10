import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { recordWalletTransaction } from "./ledger";

function fakeSupabase(insertResult: { error: { code?: string; message?: string } | null }) {
  const insert = vi.fn().mockResolvedValue(insertResult);
  const from = vi.fn().mockReturnValue({ insert });
  return { client: { from } as unknown as SupabaseClient<Database>, insert, from };
}

const baseInput = {
  userId: "user-1",
  type: "topup" as const,
  amountKobo: 50_000,
  reference: "topup_abc",
};

describe("recordWalletTransaction", () => {
  it("inserts the ledger row and reports inserted:true on success", async () => {
    const { client, insert, from } = fakeSupabase({ error: null });

    const result = await recordWalletTransaction(client, baseInput);

    expect(result).toEqual({ inserted: true });
    expect(from).toHaveBeenCalledWith("wallet_transactions");
    expect(insert).toHaveBeenCalledWith({
      user_id: "user-1",
      type: "topup",
      amount_kobo: 50_000,
      reference: "topup_abc",
      order_id: null,
      metadata: {},
    });
  });

  it("treats a duplicate reference (unique violation) as an idempotent no-op", async () => {
    const { client } = fakeSupabase({ error: { code: "23505", message: "duplicate key" } });

    const result = await recordWalletTransaction(client, baseInput);

    expect(result).toEqual({ inserted: false });
  });

  it("rethrows any other database error instead of silently swallowing it", async () => {
    const { client } = fakeSupabase({ error: { code: "23503", message: "fk violation" } });

    await expect(recordWalletTransaction(client, baseInput)).rejects.toMatchObject({
      code: "23503",
    });
  });
});
