import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { computeCandidateKobo, convertToNgnKobo, enforceMinMargin, marginPct } from "./calculate";
import { resolvePricingRule, type ResolvablePricingRule } from "./resolve-rule";

export interface UpstreamCost {
  amount: number; // major units, e.g. 0.30 for $0.30
  currency: string; // e.g. "USD" — matched against fx_rates.pair as `${currency}_NGN`
}

export interface ResolvedPrice {
  priceKobo: number;
  upstreamCostKobo: number;
  marginPct: number;
  ruleId: string;
  ruleScope: ResolvablePricingRule["scope"];
}

interface PricingRuleRow extends ResolvablePricingRule {
  markup_type: "percent" | "flat_kobo" | "tiered";
  markup_value: unknown;
  min_margin_pct: number;
}

// Every applicable-rule row, unfiltered — small table, cheaper to fetch
// once and resolve in memory (see resolve-rule.ts) than to build a
// PostgREST OR-filter per service/country pair.
export async function fetchAllPricingRules(
  admin: SupabaseClient<Database>,
): Promise<PricingRuleRow[]> {
  const { data, error } = await admin.from("pricing_rules").select("*");
  if (error) throw error;
  return (data ?? []) as unknown as PricingRuleRow[];
}

export async function fetchLatestFxRate(
  admin: SupabaseClient<Database>,
  pair: string,
): Promise<number> {
  const { data, error } = await admin
    .from("fx_rates")
    .select("rate")
    .eq("pair", pair)
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data) {
    throw new Error(`No fx_rates entry for pair ${pair} — cannot price without a conversion rate`);
  }
  return Number((data as { rate: number }).rate);
}

// Pure given pre-fetched rules + fx rate — see computeCatalogPrices in
// lib/pricing/catalog.ts for the version that fetches both once and
// reuses them across an entire catalog instead of per service/country.
export function priceFromRulesAndRate(
  allRules: PricingRuleRow[],
  fxRate: number,
  serviceId: string,
  countryId: string,
  upstreamCost: UpstreamCost,
): ResolvedPrice {
  const rule = resolvePricingRule(allRules, serviceId, countryId);
  if (!rule) {
    throw new Error(
      `No pricing_rules row applies to service ${serviceId} / country ${countryId} — not even a global fallback`,
    );
  }

  const upstreamCostKobo = convertToNgnKobo(upstreamCost.amount, fxRate);
  const candidateKobo = computeCandidateKobo(upstreamCostKobo, rule);
  const priceKobo = enforceMinMargin(candidateKobo, upstreamCostKobo, rule.min_margin_pct);

  return {
    priceKobo,
    upstreamCostKobo,
    marginPct: marginPct(priceKobo, upstreamCostKobo),
    ruleId: rule.id,
    ruleScope: rule.scope,
  };
}

// Single (service, country) lookup — fetches rules + fx rate fresh. For
// pricing an entire catalog grid, use lib/pricing/catalog.ts instead so
// the rules/fx-rate queries only run once.
export async function priceForServiceCountry(
  admin: SupabaseClient<Database>,
  params: { serviceId: string; countryId: string; upstreamCost: UpstreamCost },
): Promise<ResolvedPrice> {
  const [allRules, fxRate] = await Promise.all([
    fetchAllPricingRules(admin),
    fetchLatestFxRate(admin, `${params.upstreamCost.currency}_NGN`),
  ]);

  return priceFromRulesAndRate(allRules, fxRate, params.serviceId, params.countryId, params.upstreamCost);
}
