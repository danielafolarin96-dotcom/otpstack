import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export interface UpdatePasswordResult {
  error: string | null;
}

// The only place server code touches a password change — delegates
// entirely to Supabase Auth's own updateUser(). Per SECURITY.md, passwords
// are never stored, hashed, or validated by app code; this just forwards
// the new value and reports back whatever Supabase Auth itself decided.
export async function updatePassword(
  supabase: SupabaseClient<Database>,
  newPassword: string,
): Promise<UpdatePasswordResult> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  return { error: error?.message ?? null };
}
