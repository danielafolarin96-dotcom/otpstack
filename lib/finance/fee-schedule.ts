import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

// See supabase/migrations/20260923120000_create_finance_tracking.sql —
// payment_fee_schedules is versioned like fx_rates/pricing_rules: never
// UPDATEd, only ever appended to. "The active schedule" for a payment
// method is the most recent is_default row whose effective_from has
// already passed.
const DEFAULT_PAYMENT_METHOD = "default";

export interface FeeSchedule {
  id: string;
  paymentMethod: string;
  percentBps: number;
  flatKobo: number;
  capKobo: number | null;
}

// Pure math, unit-tested independently of Supabase — see fee-schedule.test.ts.
// percentBps is basis points (1/100 of a percent): 150 = 1.5%.
export function computeFeeKobo(
  revenueKobo: number,
  schedule: Pick<FeeSchedule, "percentBps" | "flatKobo" | "capKobo">,
): number {
  const raw = Math.round((revenueKobo * schedule.percentBps) / 10_000) + schedule.flatKobo;
  const bounded = Math.max(raw, 0);
  return schedule.capKobo !== null ? Math.min(bounded, schedule.capKobo) : bounded;
}

// Only 5sim/Paystack via a single pooled wallet exist today (see
// ARCHITECTURE.md) — paymentMethod defaults to the one schedule that's
// actually seeded. Returns null (not a thrown error) when nothing is
// configured, so a missing schedule degrades to a $0 fee rather than
// blocking a purchase — same "degrade gracefully" pattern the Margin page
// uses for a missing fx_rates row.
export async function fetchActiveFeeSchedule(
  supabase: SupabaseClient<Database>,
  paymentMethod: string = DEFAULT_PAYMENT_METHOD,
): Promise<FeeSchedule | null> {
  const { data, error } = await supabase
    .from("payment_fee_schedules")
    .select("*")
    .eq("payment_method", paymentMethod)
    .eq("is_default", true)
    .lte("effective_from", new Date().toISOString())
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id,
    paymentMethod: data.payment_method,
    percentBps: data.percent_bps,
    flatKobo: data.flat_kobo,
    capKobo: data.cap_kobo,
  };
}
