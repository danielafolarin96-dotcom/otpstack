import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// Short codes for purchase_failures.reason — must match the check
// constraint in the create_purchase_failures migration.
export const PURCHASE_FAILURE_REASONS = [
  "insufficient_balance",
  "operator_unavailable",
  "upstream_no_numbers",
  "provider_balance",
  "rate_limited",
  "concurrent_order",
  "other",
] as const;
export type PurchaseFailureReason = (typeof PURCHASE_FAILURE_REASONS)[number];

const MESSAGE_MAX_LENGTH = 300;
const OPERATOR_MAX_LENGTH = 64;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Messages stored here come from our own PurchaseErrors and 5sim's response
// bodies, neither of which should ever contain a credential — but this is a
// log table, so anything credential-shaped is redacted anyway rather than
// trusting every future error path to stay clean.
export function sanitizeFailureMessage(raw: string): string {
  return raw
    .replace(/bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]*/g, "[redacted]") // JWTs (Supabase keys, sessions)
    .replace(/\b(sk|pk)_(live|test)_\w+/g, "[redacted]") // Paystack keys
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MESSAGE_MAX_LENGTH);
}

export interface PurchaseFailure {
  userId: string;
  // Raw, client-supplied values from the request body — validated here
  // rather than trusted, since a failed attempt is often a malformed one.
  serviceId?: unknown;
  countryId?: unknown;
  operator?: unknown;
  reason: PurchaseFailureReason;
  httpStatus: number;
  message: string;
}

function asUuid(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

// Best-effort: never throws, and the caller's response never depends on
// it. A failed insert is logged to the console and otherwise ignored — the
// customer must get the same response whether or not this row lands.
export async function recordPurchaseFailure(
  admin: SupabaseClient<Database>,
  failure: PurchaseFailure,
): Promise<void> {
  try {
    const countryId = asUuid(failure.countryId);
    let countryCode: string | null = null;
    if (countryId) {
      const { data } = await admin
        .from("countries")
        .select("fivesim_country_code")
        .eq("id", countryId)
        .maybeSingle();
      countryCode = data?.fivesim_country_code ?? null;
    }

    const { error } = await admin.from("purchase_failures").insert({
      user_id: failure.userId,
      service_id: asUuid(failure.serviceId),
      country_code: countryCode,
      operator: typeof failure.operator === "string" ? failure.operator.slice(0, OPERATOR_MAX_LENGTH) : null,
      reason: failure.reason,
      http_status: failure.httpStatus,
      message: sanitizeFailureMessage(failure.message),
    });
    if (error) console.error("Failed to record purchase failure:", error);
  } catch (err) {
    console.error("Failed to record purchase failure:", err);
  }
}
