"use client";

import { useMemo, useState } from "react";

export interface CatalogGridEntry {
  service: {
    id: string;
    name: string;
    category: string;
    iconKey: string;
    iconPath: string | null;
    iconHex: string | null;
    iconIsNearWhite: boolean;
  };
  price: { priceKobo: number } | null;
}

function formatNairaWhole(kobo: number) {
  return Math.round(kobo / 100).toLocaleString("en-NG");
}

// Real brand logos via the simple-icons npm package — path/hex are already
// resolved server-side (lib/icons/lookup.ts, via lib/pricing/catalog.ts) so
// this component never imports the ~3,500-icon package itself, only ever
// rendering the couple dozen paths a given page actually needs. Full brand
// color by default, per DESIGN.md's "Icon tiles" note. Falls back to the
// neutral ink-initial tile whenever a service's icon_key has no current
// Simple Icons match — not every brand has one (verified: Amazon,
// Microsoft, and LinkedIn currently don't), so this is an expected,
// regular code path, not an error case.
function ServiceLogo({
  name,
  iconPath,
  iconHex,
  iconIsNearWhite,
}: {
  name: string;
  iconPath: string | null;
  iconHex: string | null;
  iconIsNearWhite: boolean;
}) {
  if (!iconPath || !iconHex) {
    return (
      <div className="flex h-12 w-12 items-center justify-center rounded-[10px] border border-line bg-paper font-display text-lg font-bold text-ink">
        {name.charAt(0)}
      </div>
    );
  }

  // Fixed white (or, for a near-white brand color like Supercell's, fixed
  // dark) in both themes, not the theme-following --paper: a brand's hex
  // color is designed against a light backdrop, so a dark logo (e.g.
  // TradingView) would otherwise go invisible in dark mode, and a
  // near-white one would go invisible against the white fix for that —
  // see lib/icons/lookup.ts's isNearWhite and globals.css's
  // --icon-surface(-inverse).
  return (
    <div
      className={`flex h-12 w-12 items-center justify-center rounded-[10px] border border-line p-2 ${
        iconIsNearWhite ? "bg-icon-surface-inverse" : "bg-icon-surface"
      }`}
    >
      <svg viewBox="0 0 24 24" role="img" aria-label={`${name} logo`} className="h-full w-full">
        <path d={iconPath} fill={`#${iconHex}`} />
      </svg>
    </div>
  );
}

// onBuy is optional: the landing page (public, unauthenticated) renders
// tiles read-only; the dashboard's "Get a number" page passes a handler to
// make them purchasable. countryName is whichever single country the
// passed-in entries were priced for (there's no per-entry country today —
// entries are always scoped to one selected country) — the search box
// matches it too, so e.g. typing a different country's name while
// browsing Nigeria's catalog correctly empties the grid rather than
// silently ignoring the query, which is the honest result until a country
// switch happens via the separate country selector.
export function ServiceCatalogGrid({
  entries,
  onBuy,
  buyingServiceId,
  countryName,
}: {
  entries: CatalogGridEntry[];
  onBuy?: (serviceId: string) => void;
  buyingServiceId?: string | null;
  countryName: string;
}) {
  // Hidden for now rather than shown as a disabled/greyed tile — at the
  // full catalog scale (Stage 4: 722 services x 80 countries) most
  // countries only stock a fraction of the catalog, so showing everything
  // regardless of availability made the grid mostly "Unavailable" tiles.
  const available = entries.filter(
    (e): e is CatalogGridEntry & { price: NonNullable<CatalogGridEntry["price"]> } => e.price !== null,
  );

  const categories = useMemo(() => {
    const set = new Set(available.map((e) => e.service.category));
    return ["All", ...Array.from(set).sort()];
  }, [available]);
  const [active, setActive] = useState("All");
  const [query, setQuery] = useState("");

  const normalizedQuery = query.trim().toLowerCase();
  const countryMatches = normalizedQuery !== "" && countryName.toLowerCase().includes(normalizedQuery);

  const filtered = available.filter((e) => {
    if (active !== "All" && e.service.category !== active) return false;
    if (normalizedQuery === "") return true;
    return countryMatches || e.service.name.toLowerCase().includes(normalizedQuery);
  });

  return (
    <div className="flex flex-col gap-6">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search services or country…"
        className="w-full rounded-[10px] border border-line bg-paper px-3.5 py-2.5 text-sm text-text placeholder:text-slate-dim focus:border-signal focus:outline-none focus:ring-1 focus:ring-signal sm:max-w-xs"
      />

      <div className="flex flex-wrap gap-2">
        {categories.map((category) => (
          <button
            key={category}
            type="button"
            onClick={() => setActive(category)}
            className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
              active === category
                ? "bg-ink text-paper"
                : "border border-line bg-paper-raised text-text-dim hover:text-text"
            }`}
          >
            {category}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-line bg-paper-raised px-6 text-center">
          <p className="font-display text-base font-semibold text-ink">
            {available.length === 0 ? "No services available here yet" : "No matches"}
          </p>
          <p className="max-w-sm text-sm text-text-dim">
            {available.length === 0
              ? "This country doesn't have any services in stock right now — try another one."
              : "Try a different search term or category."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {filtered.map(({ service, price }) => {
            const isBuying = buyingServiceId === service.id;
            return (
              <div
                key={service.id}
                className="flex flex-col items-center gap-2 rounded-[14px] border border-line bg-paper-raised p-4 text-center"
              >
                <ServiceLogo
                  name={service.name}
                  iconPath={service.iconPath}
                  iconHex={service.iconHex}
                  iconIsNearWhite={service.iconIsNearWhite}
                />
                <p className="text-sm font-medium text-text">{service.name}</p>
                <p className="font-technical text-sm text-signal">
                  Get {service.name} from ₦{formatNairaWhole(price.priceKobo)}
                </p>
                {onBuy && (
                  <button
                    type="button"
                    disabled={Boolean(buyingServiceId)}
                    onClick={() => onBuy(service.id)}
                    className="mt-1 w-full rounded-[10px] bg-signal px-3 py-1.5 text-xs font-semibold text-paper transition-colors hover:bg-signal-bright disabled:opacity-50"
                  >
                    {isBuying ? "Buying…" : "Buy"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
