import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeCatalogPrices, fetchActiveCountries } from "@/lib/pricing/catalog";
import { fetchLatestFxRate } from "@/lib/pricing/engine";
import { ServiceCatalogGrid } from "@/components/catalog/service-catalog-grid";
import { DeliveryOdds } from "@/components/catalog/delivery-odds";
import { SiteFooter } from "@/components/site-footer";
import { getBrandIcon } from "@/lib/icons/lookup";
import { DELIVERY_ODDS_SERVICES } from "@/lib/marketing/delivery-odds-data";

// Prices come from pricing_rules via the engine — without this, Next would
// prerender the catalog once at build time and serve stale prices until
// the next deploy instead of recomputing them per request.
export const dynamic = "force-dynamic";

const PROCESS_STEPS = [
  {
    n: "01",
    title: "Fund your wallet",
    body: "Card or transfer via Paystack. ₦500 minimum, lands instantly, balance shown in naira.",
  },
  {
    n: "02",
    title: "Pick service and country",
    body: "Choose from the catalog above and the countries a service is most likely to accept.",
  },
  {
    n: "03",
    title: "Receive your code",
    body: "Number is yours for 10 minutes. No code in time, you're refunded automatically.",
  },
];

// Only these four are surfaced in the landing page's "Coverage" strip, in
// this order — not the full countries table, which can run to 80+ rows
// (DEVELOPMENT_PLAN.md's Stage 4 scale-up). Names must match countries.name
// exactly; a country not present in the table (e.g. not yet active) is
// silently skipped rather than shown with placeholder data.
const COVERAGE_COUNTRY_NAMES = ["United States", "Canada", "United Kingdom", "Germany"];

export default async function Home() {
  const admin = createAdminClient();
  const countries = await fetchActiveCountries(admin);
  const defaultCountry = countries.find((c) => c.name === "United States") ?? countries[0];
  const entries = defaultCountry ? await computeCatalogPrices(admin, defaultCountry.id) : [];

  const coverageCountries = COVERAGE_COUNTRY_NAMES.map((name) =>
    countries.find((c) => c.name === name),
  ).filter((c): c is NonNullable<typeof c> => c !== undefined);

  // fx_rates can legitimately have no row yet for a pair (SKILL.md forbids
  // ever hardcoding this instead) — degrade to hiding the "Rate today" stat
  // rather than throwing and taking the whole landing page down with it.
  let usdNgnRate: number | null = null;
  try {
    usdNgnRate = await fetchLatestFxRate(admin, "USD_NGN");
  } catch (err) {
    console.error("No USD_NGN fx rate available for the landing page's pricing strip:", err);
  }

  // The real catalog runs into the hundreds of services (see
  // DEVELOPMENT_PLAN.md's Stage 4 catalog scale-up), which made the public
  // landing page an extremely long scroll. Cap what's shown here to a
  // preview; the full searchable catalog still lives behind signup on the
  // dashboard's "Get a number" page.
  const LANDING_CATALOG_LIMIT = 10;
  const availableEntries = entries.filter((e) => e.price !== null);
  const landingEntries = availableEntries.slice(0, LANDING_CATALOG_LIMIT);

  // Icons for the delivery-odds tabs are resolved here (server-only lookup)
  // and passed down as plain data, same split as ServiceCatalogGrid's
  // ServiceLogo — a client component can't import lib/icons/lookup.ts
  // directly.
  const deliveryOddsIcons = Object.fromEntries(
    DELIVERY_ODDS_SERVICES.map((id) => [id, getBrandIcon(id)]),
  ) as Record<(typeof DELIVERY_ODDS_SERVICES)[number], ReturnType<typeof getBrandIcon>>;

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
          <p className="font-technical text-xs font-bold uppercase tracking-[0.14em] text-slate">
            Verification numbers, priced in naira
          </p>
          <h1 className="font-display text-4xl font-bold text-ink">
            Your code. Your number. Your stack.
          </h1>
          <p className="max-w-md font-body text-text-dim">
            Get verification SMS from numbers around the world in seconds.
            Fund your wallet, choose a supported service and country, and
            manage every verification from one simple dashboard.
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-3">
            <Link
              href="/signup"
              className="rounded-[10px] bg-ink px-5 py-3 text-sm font-bold text-paper"
            >
              Create free account →
            </Link>
            <a
              href="#catalog"
              className="rounded-[10px] border border-line px-5 py-3 text-sm font-bold text-text"
            >
              See services
            </a>
          </div>
          <p className="mt-1 text-xs text-slate">
            Wallet tops up from <span className="font-technical text-text">₦500</span>, unused
            numbers refund automatically
          </p>
        </div>

        <section id="catalog" className="w-full max-w-[1080px]">
          <h2 className="mb-6 font-display text-2xl font-bold text-ink">Browse services</h2>
          {landingEntries.length > 0 ? (
            <>
              <ServiceCatalogGrid entries={landingEntries} />
              {availableEntries.length > landingEntries.length && (
                <p className="mt-5 text-center text-sm text-text-dim">
                  <Link
                    href="/signup"
                    className="font-semibold text-signal hover:text-signal-bright"
                  >
                    Create an account
                  </Link>{" "}
                  to browse all {availableEntries.length} services.
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-text-dim">No services configured yet.</p>
          )}
        </section>

        <DeliveryOdds serviceIcons={deliveryOddsIcons} />

        <section className="w-full max-w-[1080px]">
          <div className="mb-6 max-w-[56ch]">
            <p className="font-technical text-xs font-bold uppercase tracking-[0.14em] text-slate">
              Process
            </p>
            <h2 className="mt-2 font-display text-2xl font-bold text-ink">
              Three steps, in that order.
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            {PROCESS_STEPS.map((step) => (
              <div key={step.n} className="rounded-[14px] border border-line bg-paper-raised p-5">
                <div className="mb-2.5 font-technical text-xs text-signal">{step.n}</div>
                <h3 className="mb-1.5 text-base font-bold text-ink">{step.title}</h3>
                <p className="text-sm leading-relaxed text-text-dim">{step.body}</p>
              </div>
            ))}
          </div>
        </section>

        {coverageCountries.length > 0 && (
          <section className="w-full max-w-[1080px]">
            <div className="mb-6 max-w-[56ch]">
              <p className="font-technical text-xs font-bold uppercase tracking-[0.14em] text-slate">
                Coverage
              </p>
              <h2 className="mt-2 font-display text-2xl font-bold text-ink">
                Numbers from {countries.length} countries, and counting.
              </h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {coverageCountries.map((country) => (
                <span
                  key={country.id}
                  className="flex items-center gap-2 rounded-full border border-line bg-paper-raised px-3 py-2 font-technical text-sm"
                >
                  {country.flagEmoji} {country.name}
                </span>
              ))}
            </div>
          </section>
        )}

        <section className="w-full max-w-[1080px]">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-[16px] border border-line bg-paper-raised p-5">
            <div className="flex flex-wrap gap-6">
              <div className="min-w-[110px]">
                <div className="text-[11.5px] uppercase tracking-[0.06em] text-slate-dim">
                  Min top-up
                </div>
                <div className="mt-1 font-technical text-lg font-bold text-ink">₦500</div>
              </div>
              <div className="min-w-[110px]">
                <div className="text-[11.5px] uppercase tracking-[0.06em] text-slate-dim">
                  Hold window
                </div>
                <div className="mt-1 font-technical text-lg font-bold text-ink">10:00</div>
              </div>
              {usdNgnRate !== null && (
                <div className="min-w-[110px]">
                  <div className="text-[11.5px] uppercase tracking-[0.06em] text-slate-dim">
                    Rate today
                  </div>
                  <div className="mt-1 font-technical text-lg font-bold text-ink">
                    $1 ≈ ₦{usdNgnRate.toLocaleString("en-NG", { maximumFractionDigits: 2 })}
                  </div>
                </div>
              )}
            </div>
            <Link
              href="/signup"
              className="rounded-[10px] bg-ink px-5 py-3 text-sm font-bold text-paper"
            >
              Get started free →
            </Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
