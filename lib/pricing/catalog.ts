import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { fetchAllPricingRules, fetchLatestFxRate, priceFromRulesAndRate, type ResolvedPrice } from "./engine";
import { getMockUpstreamCost } from "./mock-upstream-costs";

export interface CatalogService {
  id: string;
  name: string;
  category: string;
  iconKey: string;
}

export interface CatalogEntry {
  service: CatalogService;
  price: ResolvedPrice | null; // null if this service has no mock upstream cost yet
}

export interface CatalogCountry {
  id: string;
  name: string;
  flagEmoji: string;
}

const MOCK_UPSTREAM_CURRENCY_PAIR = "USD_NGN"; // every mock cost is USD for now — see mock-upstream-costs.ts

// Fetches active services, all pricing rules, and the current fx rate
// exactly once (not once per service), then prices every active service
// against a single country in memory. This is what the landing page and
// "Get a number" catalog grids call.
export async function computeCatalogPrices(
  admin: SupabaseClient<Database>,
  countryId: string,
): Promise<CatalogEntry[]> {
  const [servicesResult, allRules, fxRate] = await Promise.all([
    admin.from("services").select("*").eq("is_active", true).order("name"),
    fetchAllPricingRules(admin),
    fetchLatestFxRate(admin, MOCK_UPSTREAM_CURRENCY_PAIR),
  ]);

  if (servicesResult.error) throw servicesResult.error;

  type ServiceRow = {
    id: string;
    name: string;
    category: string;
    icon_key: string;
    fivesim_product_code: string;
  };

  return ((servicesResult.data ?? []) as unknown as ServiceRow[]).map((row) => {
    const service: CatalogService = {
      id: row.id,
      name: row.name,
      category: row.category,
      iconKey: row.icon_key,
    };

    const upstreamCost = getMockUpstreamCost(row.fivesim_product_code);
    if (!upstreamCost) {
      return { service, price: null };
    }

    const price = priceFromRulesAndRate(allRules, fxRate, row.id, countryId, upstreamCost);
    return { service, price };
  });
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
