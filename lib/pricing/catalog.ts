import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  effectiveFxRate,
  fetchAllPricingRules,
  fetchPricingFxRates,
  priceFromRulesAndRate,
  type ResolvedPrice,
} from "./engine";
import { getOperatorPrices, getProductPrices, judgedRate, type FiveSimOperatorPrice } from "@/lib/5sim/client";
import { getCachedServicePrices, getSupplierPrices, rankSuppliers, type GrizzlyServicePrices } from "@/lib/grizzly/client";
import { fetchActiveRoutes, pickProvider } from "@/lib/providers/route";
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
  // null if the provider lists this service in this country but nothing is
  // in stock or clears the rate floor (or the provider couldn't be
  // reached). 5sim-routed services 5sim doesn't list here at all aren't
  // returned as entries in the first place; Grizzly-routed ones always are
  // (shown unavailable when Grizzly has no stock — no fallback to 5sim).
  price: ResolvedPrice | null;
}

export interface CatalogCountry {
  id: string;
  name: string;
  flagEmoji: string;
}

const UPSTREAM_CURRENCY_PAIR = "USD_NGN"; // both providers price in USD — see lib/5sim/client.ts, lib/grizzly/client.ts

// Fetches active services, the target country, every active provider
// route, all pricing rules and the current fx rates, then prices each
// service from whichever provider sells it here (lib/providers/route.ts).
// 5sim: one call (GET /guest/prices?country= returns every product's price
// across every operator for that country at once). Grizzly: one call per
// Grizzly-routed service, each returning every country. Both cached 60s.
export async function computeCatalogPrices(
  admin: SupabaseClient<Database>,
  countryId: string,
): Promise<CatalogEntry[]> {
  const [servicesResult, countryResult, routes, allRules, fxRates] = await Promise.all([
    admin.from("services").select("*").eq("is_active", true).order("name"),
    admin.from("countries").select("id, fivesim_country_code, grizzly_country_id").eq("id", countryId).maybeSingle(),
    fetchActiveRoutes(admin),
    fetchAllPricingRules(admin),
    fetchPricingFxRates(admin, UPSTREAM_CURRENCY_PAIR),
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
    provider: string;
    grizzly_service_code?: string | null;
  };
  const services = (servicesResult.data ?? []) as unknown as ServiceRow[];
  const countryRow = countryResult.data as {
    id?: string;
    fivesim_country_code: string;
    grizzly_country_id?: number | null;
  };
  const country = { id: countryRow.id ?? countryId, grizzly_country_id: countryRow.grizzly_country_id ?? null };
  const providerOf = new Map(
    services.map((row) => [
      row.id,
      pickProvider(routes, { ...row, grizzly_service_code: row.grizzly_service_code ?? null }, country),
    ]),
  );

  // Grizzly being slow/unreachable only blanks the Grizzly-routed tiles.
  const grizzlyCodes = [
    ...new Set(services.filter((row) => providerOf.get(row.id) === "grizzly").map((row) => row.grizzly_service_code!)),
  ];
  const grizzlyPrices = new Map<string, GrizzlyServicePrices | null>();
  await Promise.all(
    grizzlyCodes.map(async (code) => {
      try {
        grizzlyPrices.set(code, await getCachedServicePrices(code));
      } catch (err) {
        console.error("Failed to fetch Grizzly prices for " + code + " — showing it as unavailable:", err);
        grizzlyPrices.set(code, null);
      }
    }),
  );

  // 5sim being slow/unreachable shouldn't take the whole catalog page
  // down — degrade to "price unavailable" for every service rather than
  // throwing. getProductPrices caches 5sim's response for 60s (see
  // lib/5sim/client.ts), so this isn't a live upstream call on every render.
  // productPrices stays null on failure: with no response we can't tell
  // which apps 5sim lists here, so every service shows as unavailable
  // rather than the whole grid vanishing.
  let productPrices: Awaited<ReturnType<typeof getProductPrices>> | null = null;
  try {
    productPrices = await getProductPrices(countryRow.fivesim_country_code);
  } catch (err) {
    console.error("Failed to fetch 5sim product prices — showing catalog with no prices:", err);
  }

  // A service 5sim doesn't list for this country at all is dropped, not
  // shown as "Temporarily unavailable" — that label is only for apps 5sim
  // does list here but that are out of stock or below the rate floor, where
  // "check back soon" is actually true.
  const listed = productPrices;
  const listedServices = services.filter(
    (row) => providerOf.get(row.id) === "grizzly" || !listed || Object.hasOwn(listed, row.fivesim_product_code),
  );

  return listedServices.map((row) => {
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

    const provider = providerOf.get(row.id) ?? "5sim";
    let costUsd: number | null;
    if (provider === "grizzly") {
      const suppliers = grizzlyPrices.get(row.grizzly_service_code!)?.[String(country.grizzly_country_id)] ?? [];
      // The tile shows the recommended supplier's price — the same one the
      // picker marks "Recommended", so the two never disagree.
      costUsd = rankSuppliers(suppliers).recommended?.cost ?? null;
    } else {
      costUsd = listed?.[row.fivesim_product_code]?.cost ?? null;
    }
    if (costUsd === null) {
      return { service, price: null };
    }

    const price = priceFromRulesAndRate(allRules, effectiveFxRate(fxRates, provider), row.id, countryId, {
      amount: costUsd,
      currency: "USD",
    });
    return { service, price };
  });
}

export interface PricedOperatorOption {
  // 5sim operator name, or Grizzly supplier id — whatever purchaseNumber
  // expects back as `operator`.
  operator: string;
  price: ResolvedPrice;
  // null = "new / unrated" — 5sim reported no rate data for this operator,
  // and always null for Grizzly (it reports no delivery rates).
  ratePct: number | null;
}

export interface OperatorPriceList {
  // 5sim: always options[0] (rankOperators' order). Grizzly: the cheapest
  // supplier with stock >= 20, while options stay cheapest-first
  // (rankSuppliers). Either way the same pick the catalog grid prices from.
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
  const [serviceResult, countryResult, routes, allRules, fxRates] = await Promise.all([
    admin
      .from("services")
      .select("fivesim_product_code, provider, grizzly_service_code")
      .eq("id", serviceId)
      .eq("is_active", true)
      .maybeSingle(),
    admin
      .from("countries")
      .select("fivesim_country_code, grizzly_country_id")
      .eq("id", countryId)
      .eq("is_active", true)
      .maybeSingle(),
    fetchActiveRoutes(admin, serviceId),
    fetchAllPricingRules(admin),
    fetchPricingFxRates(admin, UPSTREAM_CURRENCY_PAIR),
  ]);

  if (serviceResult.error) throw serviceResult.error;
  if (countryResult.error) throw countryResult.error;
  if (!serviceResult.data || !countryResult.data) return null;

  const serviceRow = serviceResult.data as {
    fivesim_product_code: string;
    provider: string;
    grizzly_service_code?: string | null;
  };
  const countryRow = countryResult.data as { fivesim_country_code: string; grizzly_country_id?: number | null };
  const provider = pickProvider(
    routes,
    { id: serviceId, provider: serviceRow.provider, grizzly_service_code: serviceRow.grizzly_service_code ?? null },
    { id: countryId, grizzly_country_id: countryRow.grizzly_country_id ?? null },
  );
  const fxRate = effectiveFxRate(fxRates, provider);

  if (provider === "grizzly") {
    const suppliers = await getSupplierPrices(serviceRow.grizzly_service_code!, countryRow.grizzly_country_id!);
    const ranked = rankSuppliers(suppliers ?? []);
    if (!ranked.recommended) return null;
    const options: PricedOperatorOption[] = ranked.options.map((supplier) => ({
      operator: supplier.supplierId,
      price: priceFromRulesAndRate(allRules, fxRate, serviceId, countryId, { amount: supplier.cost, currency: "USD" }),
      ratePct: null,
    }));
    const recommendedId = ranked.recommended.supplierId;
    return { recommended: options.find((o) => o.operator === recommendedId)!, options };
  }

  const ranked = await getOperatorPrices(countryRow.fivesim_country_code, serviceRow.fivesim_product_code);
  if (ranked.options.length === 0) return null;

  function priceOption(opt: FiveSimOperatorPrice): PricedOperatorOption {
    return {
      operator: opt.operator,
      price: priceFromRulesAndRate(allRules, fxRate, serviceId, countryId, {
        amount: opt.cost,
        currency: "USD",
      }),
      ratePct: judgedRate(opt) ?? null,
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
