import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export interface RateLimitInput {
  key: string;
  windowSeconds: number;
  max: number;
}

// Pass an admin (service-role) client: RLS grants no access to rate_limits
// to any other role, and check_rate_limit() is only granted to
// service_role. See the Phase 6 migration for the atomic check-and-count
// logic this wraps.
export async function checkRateLimit(
  admin: SupabaseClient<Database>,
  input: RateLimitInput,
): Promise<boolean> {
  const { data, error } = await admin.rpc("check_rate_limit", {
    p_key: input.key,
    p_window_seconds: input.windowSeconds,
    p_max_count: input.max,
  });
  if (error) throw error;
  return data;
}

// Vercel (and most proxies) set x-forwarded-for to "client, proxy1, proxy2"
// — the first entry is the original client. Falls back to x-real-ip, then
// "unknown" so a rate-limit key is still well-formed if neither header is
// present (e.g. local dev without a proxy in front).
export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
