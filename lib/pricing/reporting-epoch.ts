import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export interface ReportingEpoch {
  setAt: string;
  fivesimBalanceUsd: number;
}

// reporting_epochs is append-only, same "latest row wins" pattern as
// lib/pricing/engine.ts's fetchLatestFxRate — reading "the current epoch"
// means the most recent row by set_at. Null means no epoch has ever been
// set, which the Margin page treats as "show all-time" (nothing to filter
// by yet).
export async function fetchCurrentReportingEpoch(
  admin: SupabaseClient<Database>,
): Promise<ReportingEpoch | null> {
  const { data, error } = await admin
    .from("reporting_epochs")
    .select("set_at, fivesim_balance_usd")
    .order("set_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return { setAt: data.set_at, fivesimBalanceUsd: Number(data.fivesim_balance_usd) };
}
