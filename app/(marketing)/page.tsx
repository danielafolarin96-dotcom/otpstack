import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeCatalogPrices, fetchActiveCountries } from "@/lib/pricing/catalog";
import { ServiceCatalogGrid } from "@/components/catalog/service-catalog-grid";
import { SiteFooter } from "@/components/site-footer";

// Prices come from pricing_rules via the engine — without this, Next would
// prerender the catalog once at build time and serve stale prices until
// the next deploy instead of recomputing them per request.
export const dynamic = "force-dynamic";

export default async function Home() {
  const admin = createAdminClient();
  const countries = await fetchActiveCountries(admin);
  const nigeria = countries.find((c) => c.name === "Nigeria") ?? countries[0];
  const entries = nigeria ? await computeCatalogPrices(admin, nigeria.id) : [];

  return (
    <>
      <header className="mx-auto flex w-full max-w-[1080px] items-center justify-between px-5 py-6">
        <span className="font-display text-xl font-bold text-ink">OtpStack</span>
        <nav className="flex items-center gap-3">
          <Link
            href="/login"
            className="rounded-[10px] px-4 py-2 text-sm font-medium text-text hover:text-ink"
          >
            Log in
          </Link>
          <Link
            href="/signup"
            className="rounded-[10px] bg-signal px-4 py-2 text-sm font-semibold text-paper transition-colors hover:bg-signal-bright"
          >
            Create account
          </Link>
        </nav>
      </header>

      <main className="flex flex-1 flex-col items-center gap-16 px-5 pb-16">
        <div className="flex flex-col items-center gap-4 pt-12 text-center">
          <h1 className="font-display text-4xl font-bold text-ink">
            Your code. Your number. Your stack.
          </h1>
          <p className="max-w-md font-body text-text-dim">
            Need a number? We&apos;ve got you covered. Choose a country, select your service, and
            receive your verification code without the hassle.
          </p>
        </div>

        <section className="w-full max-w-[1080px]">
          <h2 className="mb-6 font-display text-2xl font-bold text-ink">Browse services</h2>
          {entries.length > 0 ? (
            <ServiceCatalogGrid entries={entries} countryName={nigeria?.name ?? ""} />
          ) : (
            <p className="text-sm text-text-dim">No services configured yet.</p>
          )}
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
