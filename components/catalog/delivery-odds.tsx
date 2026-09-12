"use client";

import { useState } from "react";
import {
  DELIVERY_ODDS_SERVICES,
  DELIVERY_ODDS_SERVICE_LABELS,
  getDeliveryOdds,
  type DeliveryOddsService,
} from "@/lib/marketing/delivery-odds-data";

const MID_THRESHOLD = 80;

export interface ServiceTabIcon {
  path: string;
  hex: string;
  isNearWhite: boolean;
}

// Icons are resolved server-side (lib/icons/lookup.ts is server-only) and
// passed in as plain data — same split as ServiceLogo in
// components/catalog/service-catalog-grid.tsx. A service with no Simple
// Icons match (icon is null) falls back to an ink-initial tile, same
// fallback rule as the catalog grid.
export function DeliveryOdds({
  serviceIcons,
}: {
  serviceIcons: Record<DeliveryOddsService, ServiceTabIcon | null>;
}) {
  const [service, setService] = useState<DeliveryOddsService>("whatsapp");
  const entries = getDeliveryOdds(service);
  const bestRate = Math.max(...entries.map((entry) => entry.ratePct));

  return (
    <section className="w-full max-w-[1080px]">
      <div className="mb-6 max-w-[56ch]">
        <p className="font-technical text-xs font-bold uppercase tracking-[0.14em] text-slate">
          Delivery odds
        </p>
        <h2 className="mt-2 font-display text-2xl font-bold text-ink">
          Know the odds before you pay.
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-text-dim">
          Every country and service pair carries its own delivery rate. Weigh
          it against the price and choose accordingly.
        </p>
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        {DELIVERY_ODDS_SERVICES.map((id) => {
          const active = id === service;
          const icon = serviceIcons[id];
          return (
            <button
              key={id}
              type="button"
              onClick={() => setService(id)}
              className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                active
                  ? "bg-ink text-paper"
                  : "border border-line bg-paper-raised text-text-dim hover:text-text"
              }`}
            >
              {icon ? (
                <span
                  className={`flex h-4 w-4 items-center justify-center rounded-[4px] p-[3px] ${
                    icon.isNearWhite ? "bg-icon-surface-inverse" : "bg-icon-surface"
                  }`}
                >
                  <svg viewBox="0 0 24 24" role="img" aria-hidden="true" className="h-full w-full">
                    <path d={icon.path} fill={`#${icon.hex}`} />
                  </svg>
                </span>
              ) : (
                <span className="flex h-4 w-4 items-center justify-center rounded-[4px] border border-line bg-paper font-display text-[9px] font-bold text-ink">
                  {DELIVERY_ODDS_SERVICE_LABELS[id].charAt(0)}
                </span>
              )}
              {DELIVERY_ODDS_SERVICE_LABELS[id]}
            </button>
          );
        })}
      </div>

      <div className="rounded-[14px] border border-line bg-paper-raised p-2">
        <div className="flex flex-col">
          {entries.map((entry, i) => {
            const isBest = entry.ratePct === bestRate;
            const isMid = entry.ratePct < MID_THRESHOLD;
            return (
              <div
                key={entry.countryCode}
                className={`grid grid-cols-[1fr_96px_52px] items-center gap-2.5 p-3 sm:grid-cols-[1fr_160px_64px] sm:gap-4 ${
                  i !== entries.length - 1 ? "border-b border-line" : ""
                }`}
              >
                <div className="flex flex-wrap items-center gap-2.5 text-sm font-semibold text-ink">
                  <span className="text-base">{entry.flag}</span>
                  {entry.countryName}
                  {isBest && (
                    <span className="whitespace-nowrap rounded-full bg-good/15 px-2 py-0.5 font-technical text-[9.5px] uppercase tracking-[0.05em] text-good">
                      Best match
                    </span>
                  )}
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-line">
                  <span
                    className={`block h-full rounded-full ${isMid ? "bg-amber" : "bg-good"}`}
                    style={{ width: `${entry.ratePct}%` }}
                  />
                </div>
                <div
                  className={`text-right font-technical text-sm font-bold ${
                    isMid ? "text-amber" : "text-ink"
                  }`}
                >
                  {entry.ratePct}%
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <p className="mt-3 flex items-center gap-2 text-xs text-slate-dim">
        <span className="h-1.5 w-1.5 flex-none rounded-full bg-slate-dim" />
        Figures shown are illustrative. Live values will come from the 5sim
        price feed once the per-country rate aggregation is decided (see
        ARCHITECTURE.md).
      </p>
    </section>
  );
}
