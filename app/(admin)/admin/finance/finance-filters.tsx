"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { DateRangePreset } from "@/lib/finance/date-range";

const PRESET_LABELS: Record<DateRangePreset, string> = {
  today: "Today",
  "7d": "7 days",
  "30d": "30 days",
  month: "This month",
  custom: "Custom",
};

const PRESETS: readonly DateRangePreset[] = ["today", "7d", "30d", "month", "custom"];

export function FinanceFilters({
  services,
  countries,
  providers,
  selected,
}: {
  services: readonly { id: string; name: string }[];
  countries: readonly [code: string, name: string][];
  providers: readonly string[];
  selected: {
    preset: DateRangePreset;
    from?: string;
    to?: string;
    country?: string;
    serviceId?: string;
    provider?: string;
  };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [customFrom, setCustomFrom] = useState(selected.from ?? "");
  const [customTo, setCustomTo] = useState(selected.to ?? "");

  function setParams(updates: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    router.push(`/admin/finance?${params.toString()}`);
  }

  const selectClass =
    "rounded-[10px] border border-line bg-paper-raised px-3.5 py-2.5 text-base text-text focus:border-signal focus:outline-none focus:ring-1 focus:ring-signal sm:text-sm";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1 rounded-[10px] border border-line bg-paper-raised p-1">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setParams({ preset: p, from: undefined, to: undefined })}
            className={`rounded-[8px] px-3 py-1.5 text-sm font-medium transition-colors ${
              selected.preset === p ? "bg-ink text-paper" : "text-text-dim hover:text-text"
            }`}
          >
            {PRESET_LABELS[p]}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-4">
        {selected.preset === "custom" && (
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setParams({ preset: "custom", from: customFrom, to: customTo });
            }}
          >
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-text-dim" htmlFor="from-date">
                From
              </label>
              <input
                id="from-date"
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className={selectClass}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-text-dim" htmlFor="to-date">
                To
              </label>
              <input
                id="to-date"
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className={selectClass}
              />
            </div>
            <button
              type="submit"
              className="rounded-[10px] border border-line bg-paper-raised px-3.5 py-2.5 text-sm font-medium text-text transition-colors hover:border-signal"
            >
              Apply
            </button>
          </form>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-dim" htmlFor="service-filter">
            Service
          </label>
          <select
            id="service-filter"
            value={selected.serviceId ?? ""}
            onChange={(e) => setParams({ service: e.target.value })}
            className={selectClass}
          >
            <option value="">All services</option>
            {services.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-dim" htmlFor="country-filter">
            Country
          </label>
          <select
            id="country-filter"
            value={selected.country ?? ""}
            onChange={(e) => setParams({ country: e.target.value })}
            className={selectClass}
          >
            <option value="">All countries</option>
            {countries.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-dim" htmlFor="provider-filter">
            Provider
          </label>
          <select
            id="provider-filter"
            value={selected.provider ?? ""}
            onChange={(e) => setParams({ provider: e.target.value })}
            className={selectClass}
          >
            <option value="">All providers</option>
            {providers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        {(selected.country || selected.serviceId || selected.provider) && (
          <button
            type="button"
            onClick={() => setParams({ country: undefined, service: undefined, provider: undefined })}
            className="rounded-[10px] px-3 py-2 text-sm font-medium text-text-dim transition-colors hover:text-text"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
