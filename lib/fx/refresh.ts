import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { fetchUsdToNgnRate } from "./client";

const PAIR = "USD_NGN";
const SOURCE = "open.er-api.com";

// fx_rates is append-only history (see the create_pricing_rules_and_fx_rates
// migration — no unique constraint on pair, indexed by pair+fetched_at
// desc) and fetchLatestFxRate (lib/pricing/engine.ts) always reads the
// most recent row, so "refreshing" means inserting a new row, never
// mutating an old one.
export async function refreshFxRate(admin: SupabaseClient<Database>) {
  const rate = await fetchUsdToNgnRate();

  const { data, error } = await admin
    .from("fx_rates")
    .insert({ pair: PAIR, rate, source: SOURCE })
    .select()
    .single();

  if (error) throw error;
  return data;
}
