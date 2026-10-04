"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CatalogEntry } from "@/lib/pricing/catalog";

const RESULT_LIMIT = 8;

type PricedCatalogEntry = CatalogEntry & { price: NonNullable<CatalogEntry["price"]> };

// Pure, so it's unit-tested directly (app-search.test.ts) instead of only
// ever exercised through the DOM — same split as active-number-panel.tsx's
// resolveVisibleOrder. Unpriced services (price === null — 5sim doesn't
// currently offer them in the selected country) are excluded, matching
// ServiceCatalogGrid's own "available" filter: a result that can't
// actually be bought isn't a useful search match here.
export function filterAppSearchMatches(entries: CatalogEntry[], query: string): PricedCatalogEntry[] {
  const normalized = query.trim().toLowerCase();
  if (normalized === "") return [];
  return entries
    .filter(
      (e): e is PricedCatalogEntry => e.price !== null && e.service.name.toLowerCase().includes(normalized),
    )
    .slice(0, RESULT_LIMIT);
}

function formatNairaWhole(kobo: number) {
  return Math.round(kobo / 100).toLocaleString("en-NG");
}

// Sits directly above the dashboard overview's Quick buy section. Filters
// the same priced catalog Quick buy is sliced from (the full list, not
// just its first few) and, on tap, hands off to the real buy flow at
// /dashboard/get-a-number rather than purchasing directly from here — that
// page already owns country switching, stock/availability display, and
// the actual "Buy" action (see BuyableCatalogGrid), so this only needs to
// get the visitor there pre-filtered to the service they tapped.
export function DashboardAppSearch({ entries, countryId }: { entries: CatalogEntry[]; countryId: string }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const matches = filterAppSearchMatches(entries, query);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function goToService(serviceName: string) {
    setOpen(false);
    const params = new URLSearchParams({ country: countryId, q: serviceName });
    router.push(`/dashboard/get-a-number?${params.toString()}`);
  }

  const showDropdown = open && query.trim() !== "";

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search apps…"
        aria-label="Search apps"
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls="app-search-results"
        // text-base (16px) below sm:, not text-sm — see country-select.tsx's
        // search input for the full iOS Safari auto-zoom explanation; same
        // root cause, same fix, same input pattern.
        className="w-full rounded-[10px] border border-line bg-paper-raised px-3.5 py-2.5 text-base text-text placeholder:text-slate-dim focus:border-signal focus:outline-none focus:ring-1 focus:ring-signal sm:text-sm"
      />

      {showDropdown && (
        <div
          id="app-search-results"
          role="listbox"
          className="absolute inset-x-0 z-10 mt-2 max-h-80 overflow-y-auto rounded-[14px] border border-line bg-paper-raised p-2 shadow-lg"
        >
          {matches.length === 0 ? (
            <p className="px-3 py-2 text-sm text-text-dim">No matching services.</p>
          ) : (
            matches.map(({ service, price }) => (
              <button
                key={service.id}
                type="button"
                role="option"
                aria-selected={false}
                // onMouseDown (fires for touch taps too) + preventDefault,
                // onClick as a fallback: same mobile-reliability pattern as
                // country-select.tsx's option buttons — the input above is
                // focused while this is open, and without this a tap can
                // just blur/dismiss the keyboard instead of registering.
                onMouseDown={(e) => {
                  e.preventDefault();
                  goToService(service.name);
                }}
                onClick={() => goToService(service.name)}
                className="flex w-full items-center justify-between gap-3 rounded-[10px] px-3 py-2 text-left transition-colors hover:bg-paper"
              >
                <span className="text-sm font-medium text-text">{service.name}</span>
                <span className="font-technical text-sm text-signal">
                  ₦{formatNairaWhole(price.priceKobo)}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
