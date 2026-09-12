import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { updatePassword } from "./update-password";

function fakeSupabase(updateUserError: { message: string } | null) {
  const updateUser = vi.fn(() => Promise.resolve({ error: updateUserError }));
  return { auth: { updateUser } } as unknown as SupabaseClient<Database>;
}

describe("updatePassword", () => {
  it("delegates to supabase.auth.updateUser with the new password and returns no error on success", async () => {
    const client = fakeSupabase(null);
    const result = await updatePassword(client, "correct-horse-battery-staple");

    expect(result.error).toBeNull();
    expect(client.auth.updateUser).toHaveBeenCalledWith({ password: "correct-horse-battery-staple" });
  });

  it("surfaces Supabase Auth's own error message on failure, without wrapping or replacing it", async () => {
    const client = fakeSupabase({ message: "Password should be at least 6 characters" });
    const result = await updatePassword(client, "abc");

    expect(result.error).toBe("Password should be at least 6 characters");
  });
});
