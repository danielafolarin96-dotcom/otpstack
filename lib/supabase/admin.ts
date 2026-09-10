import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// Service-role client: bypasses RLS entirely. Only for privileged
// server-side work (webhook handlers, cron jobs) — never expose to the
// client, and never use it for anything scoped to a specific user's own
// request (use lib/supabase/server.ts for that, so RLS still applies).
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
