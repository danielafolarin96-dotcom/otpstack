import { createAdminClient } from "@/lib/supabase/admin";
import { computeCatalogPrices, fetchActiveCountries } from "@/lib/pricing/catalog";
import { EmptyState } from "../_components/empty-state";
import { CountrySelect } from "./country-select";
import { BuyableCatalogGrid } from "./buyable-catalog-grid";

export default async function GetANumberPage({
  searchParams,
}: {
  searchParams: Promise<{ country?: string }>;
}) {
  const { country } = await searchParams;
  const admin = createAdminClient();
  const countries = await fetchActiveCountries(admin);

  if (countries.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="font-display text-2xl font-bold text-ink">Get a number</h1>
        <EmptyState
          title="No countries configured"
          description="Add at least one country in the admin panel before this page can price anything."
        />
      </div>
    );
  }

  const defaultCountry = countries.find((c) => c.name === "Nigeria") ?? countries[0];
  const selectedCountryId = country ?? defaultCountry.id;

  const entries = await computeCatalogPrices(admin, selectedCountryId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Get a number</h1>
          <p className="text-sm text-text-dim">
            Your number is held for 10 minutes — cancel any time before it arrives for a full refund.
          </p>
        </div>
        <CountrySelect countries={countries} selectedId={selectedCountryId} />
      </div>

      <BuyableCatalogGrid entries={entries} countryId={selectedCountryId} />
    </div>
  );
}
