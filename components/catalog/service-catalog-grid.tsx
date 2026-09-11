"use client";

import { useMemo, useState } from "react";

export interface CatalogGridEntry {
  service: { id: string; name: string; category: string; iconKey: string };
  price: { priceKobo: number } | null;
}

function formatNairaWhole(kobo: number) {
  return Math.round(kobo / 100).toLocaleString("en-NG");
}

// Real brand logos via Simple Icons' free CDN (cdn.simpleicons.org/<slug>),
// keyed off services.icon_key — full brand color by default, per the
// landing-page redesign (see DESIGN.md's updated "Icon tiles" note). Falls
// back to the original ink-initial tile if a slug has no matching icon or
// the request fails, so a bad icon_key never breaks the grid.
function ServiceLogo({ name, iconKey }: { name: string; iconKey: string }) {
  const [failed, setFailed] = useState(false);

  if (failed || !iconKey) {
    return (
      <div className="flex h-12 w-12 items-center justify-center rounded-[10px] border border-line bg-paper font-display text-lg font-bold text-ink">
        {name.charAt(0)}
      </div>
    );
  }

  return (
    <div className="flex h-12 w-12 items-center justify-center rounded-[10px] border border-line bg-paper p-2">
      {/* eslint-disable-next-line @next/next/no-img-element -- external brand icon, not a Next/Image asset */}
      <img
        src={`https://cdn.simpleicons.org/${iconKey}`}
        alt={`${name} logo`}
        className="h-full w-full object-contain"
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </div>
  );
}

// onBuy is optional: the landing page (public, unauthenticated) renders
// tiles read-only; the dashboard's "Get a number" page passes a handler to
// make them purchasable.
export function ServiceCatalogGrid({
  entries,
  onBuy,
  buyingServiceId,
}: {
  entries: CatalogGridEntry[];
  onBuy?: (serviceId: string) => void;
  buyingServiceId?: string | null;
}) {
  const categories = useMemo(() => {
    const set = new Set(entries.map((e) => e.service.category));
    return ["All", ...Array.from(set).sort()];
  }, [entries]);
  const [active, setActive] = useState("All");

  const filtered = active === "All" ? entries : entries.filter((e) => e.service.category === active);

  return (
    <div className="flex flex-col gap-6">
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

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {filtered.map(({ service, price }) => {
          const isBuying = buyingServiceId === service.id;
          return (
            <div
              key={service.id}
              className="flex flex-col items-center gap-2 rounded-[14px] border border-line bg-paper-raised p-4 text-center"
            >
              <ServiceLogo name={service.name} iconKey={service.iconKey} />
              <p className="text-sm font-medium text-text">{service.name}</p>
              <p className="font-technical text-sm text-signal">
                {price ? `Get ${service.name} from ₦${formatNairaWhole(price.priceKobo)}` : "—"}
              </p>
              {onBuy && (
                <button
                  type="button"
                  disabled={!price || Boolean(buyingServiceId)}
                  onClick={() => onBuy(service.id)}
                  className="mt-1 w-full rounded-[10px] bg-signal px-3 py-1.5 text-xs font-semibold text-paper transition-colors hover:bg-signal-bright disabled:opacity-50"
                >
                  {isBuying ? "Buying…" : price ? "Buy" : "Unavailable"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
