import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { fetchAllPricingRules, fetchLatestFxRate, priceFromRulesAndRate, type ResolvedPrice } from "./engine";
import { getOperatorPrices, getProductPrices, type FiveSimOperatorPrice } from "@/lib/5sim/client";
import { getBrandIcon } from "@/lib/icons/lookup";

export interface CatalogService {
  id: string;
  name: string;
  category: string;
  iconKey: string;
  iconPath: string | null;
  iconHex: string | null;
  iconIsNearWhite: boolean;
}

export interface CatalogEntry {
  service: CatalogService;
  price: ResolvedPrice | null; // null if 5sim doesn't currently offer this service in this country
}

export interface CatalogCountry {
  id: string;
  name: string;
  flagEmoji: string;
}

const UPSTREAM_CURRENCY_PAIR = "USD_NGN"; // 5sim prices observed in USD — see lib/5sim/client.ts

// Fetches active services, the target country's fivesim code, all pricing
// rules, and the current fx rate, then makes exactly one live 5sim call
// (GET /guest/prices?country= returns every product's price across every
// operator for that country at once) rather than one call per service.
// Replaces Phase 3's mock-upstream-costs.ts placeholder now that
// lib/5sim/client.ts exists.
export async function computeCatalogPrices(
  admin: SupabaseClient<Database>,
  countryId: string,
): Promise<CatalogEntry[]> {
  const [servicesResult, countryResult, allRules, fxRate] = await Promise.all([
    admin.from("services").select("*").eq("is_active", true).order("name"),
    admin.from("countries").select("fivesim_country_code").eq("id", countryId).maybeSingle(),
    fetchAllPricingRules(admin),
    fetchLatestFxRate(admin, UPSTREAM_CURRENCY_PAIR),
  ]);

  if (servicesResult.error) throw servicesResult.error;
  if (countryResult.error) throw countryResult.error;
  if (!countryResult.data) throw new Error(`Country ${countryId} not found`);

  type ServiceRow = {
    id: string;
    name: string;
    category: string;
    icon_key: string;
    fivesim_product_code: string;
  };
  const services = (servicesResult.data ?? []) as unknown as ServiceRow[];

  // 5sim being slow/unreachable shouldn't take the whole catalog page
  // down — degrade to "price unavailable" for every service rather than
  // throwing. No caching layer yet (ARCHITECTURE.md's pricing engine step
  // 1 wants one eventually); this is a live call on every render for now.
  let productPrices: Awaited<ReturnType<typeof getProductPrices>> = {};
  try {
    productPrices = await getProductPrices(
      (countryResult.data as { fivesim_country_code: string }).fivesim_country_code,
    );
  } catch (err) {
    console.error("Failed to fetch 5sim product prices — showing catalog with no prices:", err);
  }

  return services.map((row) => {
    const brandIcon = getBrandIcon(row.icon_key);
    const service: CatalogService = {
      id: row.id,
      name: row.name,
      category: row.category,
      iconKey: row.icon_key,
      iconPath: brandIcon?.path ?? null,
      iconHex: brandIcon?.hex ?? null,
      iconIsNearWhite: brandIcon?.isNearWhite ?? false,
    };

    const upstreamProduct = productPrices[row.fivesim_product_code];
    if (!upstreamProduct) {
      return { service, price: null };
    }

    const price = priceFromRulesAndRate(allRules, fxRate, row.id, countryId, {
      amount: upstreamProduct.cost,
      currency: "USD",
    });
    return { service, price };
  });
}

export interface PricedOperatorOption {
  operator: string;
  price: ResolvedPrice;
  // null = "new / unrated" — 5sim reported no rate data for this operator.
  ratePct: number | null;
}

export interface OperatorPriceList {
  // Always options[0] — see lib/5sim/client.ts's rankOperators, the single
  // source of truth both this and the catalog-grid price (computeCatalogPrices,
  // via getProductPrices) derive "recommended" from.
  recommended: PricedOperatorOption;
  options: PricedOperatorOption[];
}

// Every real, priced operator option for one (service, country) pair —
// backs the buy-flow operator picker (app/api/catalog/operators/route.ts)
// and purchaseNumber's re-validation of a customer's chosen operator.
// Mirrors computeCatalogPrices' "fetch rules+fx once, map in memory" shape,
// but scoped to a single service instead of the whole catalog, and prices
// *every* eligible operator from its own cost rather than collapsing to
// one. Returns null when the service/country isn't found, or when nothing
// clears lib/5sim/client.ts's floor for this route (mirrors
// computeCatalogPrices' price:null convention for "not sellable here").
//
// Unlike computeCatalogPrices, a 5sim fetch failure here is NOT swallowed
// into "no options" — this backs an interactive picker a customer just
// opened (reasonable to assume 5sim was reachable moments ago, when the
// catalog grid itself rendered a price), so the API route this feeds
// surfaces a real "try again" failure instead of a misleading "not
// available here".
export async function computeOperatorPrices(
  admin: SupabaseClient<Database>,
  serviceId: string,
  countryId: string,
): Promise<OperatorPriceList | null> {
  const [serviceResult, countryResult, allRules, fxRate] = await Promise.all([
    admin.from("services").select("fivesim_product_code").eq("id", serviceId).eq("is_active", true).maybeSingle(),
    admin.from("countries").select("fivesim_country_code").eq("id", countryId).eq("is_active", true).maybeSingle(),
    fetchAllPricingRules(admin),
    fetchLatestFxRate(admin, UPSTREAM_CURRENCY_PAIR),
  ]);

  if (serviceResult.error) throw serviceResult.error;
  if (countryResult.error) throw countryResult.error;
  if (!serviceResult.data || !countryResult.data) return null;

  const productCode = (serviceResult.data as { fivesim_product_code: string }).fivesim_product_code;
  const countryCode = (countryResult.data as { fivesim_country_code: string }).fivesim_country_code;

  const ranked = await getOperatorPrices(countryCode, productCode);
  if (ranked.options.length === 0) return null;

  function priceOption(opt: FiveSimOperatorPrice): PricedOperatorOption {
    return {
      operator: opt.operator,
      price: priceFromRulesAndRate(allRules, fxRate, serviceId, countryId, {
        amount: opt.cost,
        currency: "USD",
      }),
      ratePct: opt.rate ?? null,
    };
  }

  const options = ranked.options.map(priceOption);
  return { recommended: options[0], options };
}

export async function fetchActiveCountries(
  admin: SupabaseClient<Database>,
): Promise<CatalogCountry[]> {
  const { data, error } = await admin
    .from("countries")
    .select("*")
    .eq("is_active", true)
    .order("name");

  if (error) throw error;

  type CountryRow = { id: string; name: string; flag_emoji: string };
  return ((data ?? []) as unknown as CountryRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    flagEmoji: row.flag_emoji,
  }));
}
