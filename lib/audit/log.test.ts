import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { recordAdminAction } from "./log";

function fakeSupabase(insertResult: { error: { code?: string; message?: string } | null }) {
  const insert = vi.fn().mockResolvedValue(insertResult);
  const from = vi.fn().mockReturnValue({ insert });
  return { client: { from } as unknown as SupabaseClient<Database>, insert, from };
}

const baseInput = {
  adminId: "admin-1",
  action: "pricing_rule.create",
  targetType: "pricing_rule",
  targetId: "rule-1",
};

describe("recordAdminAction", () => {
  it("inserts the audit row with defaults for reason/metadata", async () => {
    const { client, insert, from } = fakeSupabase({ error: null });

    await recordAdminAction(client, baseInput);

    expect(from).toHaveBeenCalledWith("admin_audit_log");
    expect(insert).toHaveBeenCalledWith({
      admin_id: "admin-1",
      action: "pricing_rule.create",
      target_type: "pricing_rule",
      target_id: "rule-1",
      reason: null,
      metadata: {},
    });
  });

  it("passes through an explicit reason and metadata", async () => {
    const { client, insert } = fakeSupabase({ error: null });

    await recordAdminAction(client, {
      ...baseInput,
      reason: "duplicate rule, rider disputed pricing",
      metadata: { scope: "global", markup_type: "percent" },
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "duplicate rule, rider disputed pricing",
        metadata: { scope: "global", markup_type: "percent" },
      }),
    );
  });

  it("throws instead of silently swallowing a database error", async () => {
    const { client } = fakeSupabase({ error: { code: "23503", message: "fk violation" } });

    await expect(recordAdminAction(client, baseInput)).rejects.toMatchObject({
      code: "23503",
    });
  });
});
