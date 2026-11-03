"use client";

import { useRouter, useSearchParams } from "next/navigation";

interface Service {
  id: string;
  name: string;
}

export function GrizzlyFallbackFilters({
  services,
  selected,
}: {
  services: Service[];
  selected: { serviceId?: string; outcome?: string };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.push(`/admin/grizzly-fallback?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-text-dim" htmlFor="service-filter">
          Service
        </label>
        <select
          id="service-filter"
          value={selected.serviceId ?? ""}
          onChange={(e) => setParam("service", e.target.value)}
          // text-base below sm:, not text-sm alone: iOS Safari auto-zooms
          // the page on focus of any input under 16px computed font-size.
          className="rounded-[10px] border border-line bg-paper-raised px-3.5 py-2.5 text-base text-text focus:border-signal focus:outline-none focus:ring-1 focus:ring-signal sm:text-sm"
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
        <label className="text-xs font-medium text-text-dim" htmlFor="outcome-filter">
          Outcome
        </label>
        <select
          id="outcome-filter"
          value={selected.outcome ?? ""}
          onChange={(e) => setParam("outcome", e.target.value)}
          className="rounded-[10px] border border-line bg-paper-raised px-3.5 py-2.5 text-base text-text focus:border-signal focus:outline-none focus:ring-1 focus:ring-signal sm:text-sm"
        >
          <option value="">All outcomes</option>
          <option value="recovered">Recovered via 5sim</option>
          <option value="lost">Lost</option>
        </select>
      </div>

      {(selected.serviceId || selected.outcome) && (
        <button
          type="button"
          onClick={() => router.push("/admin/grizzly-fallback")}
          className="rounded-[10px] px-3 py-2 text-sm font-medium text-text-dim transition-colors hover:text-text"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
