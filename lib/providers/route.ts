import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { asProviderName, type ProviderName } from "./policy";

export type { ProviderName } from "./policy";

export interface ProviderRouteRow {
  service_id: string;
  country_id: string | null;
  provider: string;
  is_active: boolean;
}

export interface RoutableService {
  id: string;
  provider: string;
  grizzly_service_code: string | null;
}

export interface RoutableCountry {
  id: string;
  grizzly_country_id: number | null;
}

// Which provider sells `service` in `country` (see the provider_routes
// migration, 20261029120000):
//   1. an active (service, country) route
//   2. else an active (service, any-country) route
//   3. else services.provider (default '5sim')
// A Grizzly result still becomes 5sim when the service has no
// grizzly_service_code or the country no grizzly_country_id — Grizzly can
// only be asked for what's explicitly mapped. There is deliberately no
// stock-based fallback: a Grizzly-routed product with no Grizzly stock is
// shown as unavailable, not silently sold from 5sim.
export function pickProvider(
  routes: ProviderRouteRow[],
  service: RoutableService,
  country: RoutableCountry,
): ProviderName {
  const active = routes.filter((r) => r.is_active && r.service_id === service.id);
  const route = active.find((r) => r.country_id === country.id) ?? active.find((r) => r.country_id === null);
  const provider = asProviderName(route?.provider ?? service.provider);

  if (provider === "grizzly" && (!service.grizzly_service_code || (country.grizzly_country_id ?? null) === null)) {
    return "5sim";
  }
  return provider;
}

// Every active route, or just one service's. An empty table (or one not
// yet migrated in a test double) means "use services.provider".
export async function fetchActiveRoutes(
  admin: SupabaseClient<Database>,
  serviceId?: string,
): Promise<ProviderRouteRow[]> {
  let query = admin.from("provider_routes").select("service_id, country_id, provider, is_active").eq("is_active", true);
  if (serviceId) query = query.eq("service_id", serviceId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as ProviderRouteRow[];
}

export async function resolveProvider(
  admin: SupabaseClient<Database>,
  service: RoutableService,
  country: RoutableCountry,
): Promise<ProviderName> {
  return pickProvider(await fetchActiveRoutes(admin, service.id), service, country);
}
