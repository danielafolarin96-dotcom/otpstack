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

// The rates USD costs are priced from: the market rate plus each
// provider's real funding cost (what a dollar of provider balance actually
// costs us to top up, fees included — see the provider_funding_rates
// migration). Use effectiveFxRate to pick the one for a given service.
export interface PricingFxRates {
  market: number;
  fundingByProvider: Record<string, number>;
}

// Latest funding rate per provider for `pair`, ignoring rows whose
// effective_from is still in the future. Rows are versioned (insert a new
// one to change a rate), so the first row seen per provider in
// effective_from-desc order is the current one.
export async function fetchLatestFundingRates(
  admin: SupabaseClient<Database>,
  pair: string,
): Promise<Record<string, number>> {
  const { data, error } = await admin
    .from("provider_funding_rates")
    .select("provider, ngn_per_usd")
    .eq("pair", pair)
    .lte("effective_from", new Date().toISOString())
    .order("effective_from", { ascending: false });

  if (error) throw error;
  const latest: Record<string, number> = {};
  for (const row of (data ?? []) as { provider: string; ngn_per_usd: number }[]) {
    if (!Object.hasOwn(latest, row.provider)) latest[row.provider] = Number(row.ngn_per_usd);
  }
  return latest;
}

export async function fetchPricingFxRates(
  admin: SupabaseClient<Database>,
  pair: string,
): Promise<PricingFxRates> {
  const [market, fundingByProvider] = await Promise.all([
    fetchLatestFxRate(admin, pair),
    fetchLatestFundingRates(admin, pair),
  ]);
  return { market, fundingByProvider };
}

// max(market, provider's funding rate): a funding rate can only raise the
// conversion. A provider with no funding row prices at the market rate.
export function effectiveFxRate(rates: PricingFxRates, provider: string): number {
  const funding = rates.fundingByProvider[provider];
  return funding !== undefined && funding > rates.market ? funding : rates.market;
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
  params: { serviceId: string; countryId: string; upstreamCost: UpstreamCost; provider: string },
): Promise<ResolvedPrice> {
  const [allRules, rates] = await Promise.all([
    fetchAllPricingRules(admin),
    fetchPricingFxRates(admin, `${params.upstreamCost.currency}_NGN`),
  ]);

  return priceFromRulesAndRate(
    allRules,
    effectiveFxRate(rates, params.provider),
    params.serviceId,
    params.countryId,
    params.upstreamCost,
  );
}
