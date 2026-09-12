import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export interface UpdateProfileInput {
  fullName: string;
  username: string;
}

export interface UpdateProfileResult {
  error: string | null;
}

const UNIQUE_VIOLATION = "23505";

// The only place server code updates a user's own profile fields. Relies
// on the Phase 1 migration's RLS policy ("users can update their own row")
// plus its column-level grant (full_name, username only) — that combo is
// what makes it impossible for this to ever touch is_admin/is_frozen/
// email/created_at, even by mistake, regardless of what's passed in.
export async function updateProfile(
  supabase: SupabaseClient<Database>,
  userId: string,
  input: UpdateProfileInput,
): Promise<UpdateProfileResult> {
  const { error } = await supabase
    .from("users")
    .update({ full_name: input.fullName, username: input.username })
    .eq("id", userId);

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      // users.username has a unique constraint — surface a plain inline
      // message instead of the raw Postgres constraint-violation error.
      return { error: "That username is already taken." };
    }
    throw error;
  }

  return { error: null };
}
