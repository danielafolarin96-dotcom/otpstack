import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { updateProfile } from "./update-profile";

function fakeSupabase(updateError: { code?: string; message: string } | null) {
  const eq = vi.fn(() => Promise.resolve({ error: updateError }));
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn((table: string) => {
    if (table === "users") return { update };
    throw new Error(`Unexpected table in test fake: ${table}`);
  });
  return { from } as unknown as SupabaseClient<Database>;
}

describe("updateProfile", () => {
  it("updates full_name and username with no error on success", async () => {
    const client = fakeSupabase(null);
    const result = await updateProfile(client, "user-1", { fullName: "Ada Lovelace", username: "ada" });
    expect(result.error).toBeNull();
    expect(client.from).toHaveBeenCalledWith("users");
  });

  it("returns a plain inline message on a username collision, not the raw DB error", async () => {
    const client = fakeSupabase({
      code: "23505",
      message: 'duplicate key value violates unique constraint "users_username_key"',
    });
    const result = await updateProfile(client, "user-1", { fullName: "Ada", username: "taken" });
    expect(result.error).toBe("That username is already taken.");
  });

  it("rethrows on an unexpected database error rather than swallowing it", async () => {
    const client = fakeSupabase({ message: "connection reset" });
    await expect(
      updateProfile(client, "user-1", { fullName: "Ada", username: "ada" }),
    ).rejects.toMatchObject({ message: "connection reset" });
  });
});
