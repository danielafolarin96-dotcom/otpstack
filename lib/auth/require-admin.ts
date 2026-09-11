import "server-only";
import { createClient } from "@/lib/supabase/server";

export interface AdminUser {
  id: string;
  email: string | null;
}

// Server Actions are their own network-reachable entry points, independent
// of whatever page/layout rendered the form that calls them — gating
// access only in app/(admin)/admin/layout.tsx would not stop a crafted
// request straight to the action. Every admin-only server action must
// call this itself. Never trust a client-supplied flag (SECURITY.md).
export async function requireAdmin(): Promise<AdminUser> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  const { data: profile, error } = await supabase
    .from("users")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw error;
  if (!profile?.is_admin) {
    throw new Error("Not authorized");
  }

  return { id: user.id, email: user.email ?? null };
}
