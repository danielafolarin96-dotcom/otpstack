import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { maybeGrantFirstTopupMatch } from "./first-topup-promo";

function fakeSupabase({
  count,
  selectError = null,
  insertError = null,
}: {
  count: number | null;
  selectError?: { code?: string; message?: string } | null;
  insertError?: { code?: string; message?: string } | null;
}) {
  const eqType = vi.fn().mockResolvedValue({ count, error: selectError });
  const eqUser = vi.fn().mockReturnValue({ eq: eqType });
  const select = vi.fn().mockReturnValue({ eq: eqUser });
  const insert = vi.fn().mockResolvedValue({ error: insertError });
  const from = vi.fn().mockReturnValue({ select, insert });
  return { client: { from } as unknown as SupabaseClient<Database>, select, insert, from, eqUser, eqType };
}

describe("maybeGrantFirstTopupMatch", () => {
  it("grants the ₦500 match when this is the user's first ever top-up", async () => {
    const { client, insert, eqUser, eqType } = fakeSupabase({ count: 1 });

    const result = await maybeGrantFirstTopupMatch(client, "user-1");

    expect(result).toEqual({ granted: true });
    expect(eqUser).toHaveBeenCalledWith("user_id", "user-1");
    expect(eqType).toHaveBeenCalledWith("type", "topup");
    expect(insert).toHaveBeenCalledWith({
      user_id: "user-1",
      type: "admin_adjustment",
      amount_kobo: 50_000,
      reference: "promo_first_topup_match_user-1",
      order_id: null,
      metadata: {
        reason: "signup_topup_match_promo",
        promo: "first_topup_match_500",
      },
    });
  });

  it("does not grant anything when this is not the user's first top-up", async () => {
    const { client, insert } = fakeSupabase({ count: 3 });

    const result = await maybeGrantFirstTopupMatch(client, "user-1");

    expect(result).toEqual({ granted: false });
    expect(insert).not.toHaveBeenCalled();
  });

  it("treats an already-granted match (duplicate reference) as an idempotent no-op", async () => {
    const { client } = fakeSupabase({ count: 1, insertError: { code: "23505", message: "duplicate key" } });

    const result = await maybeGrantFirstTopupMatch(client, "user-1");

    expect(result).toEqual({ granted: false });
  });

  it("propagates a database error from the count lookup instead of silently skipping the match", async () => {
    const { client } = fakeSupabase({ count: null, selectError: { code: "500", message: "db down" } });

    await expect(maybeGrantFirstTopupMatch(client, "user-1")).rejects.toMatchObject({
      code: "500",
    });
  });
});
