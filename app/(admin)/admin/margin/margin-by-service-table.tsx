"use client";

import { useMemo, useState } from "react";
import type { ServiceMarginRow } from "@/lib/pricing/margin-report";

function naira(kobo: number) {
  return `₦${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
}

// One row per (service, country) combination — a service sold across
// multiple countries (e.g. WhatsApp · USA vs WhatsApp · UK) shows as
// separate rows rather than merging into a single "WhatsApp" line, so a
// country-specific margin problem is visible instead of averaged away. The
// country filter narrows the same rows down further rather than requiring a
// click into each one.
export function MarginByServiceTable({ rows, target }: { rows: ServiceMarginRow[]; target: number }) {
  const [countryFilter, setCountryFilter] = useState("");

  const countries = useMemo(
    () => Array.from(new Map(rows.map((r) => [r.countryCode, r.countryName])).entries()).sort((a, b) =>
      a[1].localeCompare(b[1]),
    ),
    [rows],
  );

  const filteredRows = countryFilter ? rows.filter((r) => r.countryCode === countryFilter) : rows;

  if (rows.length === 0) {
    return (
      <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-line bg-paper-raised px-6 text-center">
        <p className="font-display text-base font-semibold text-ink">No revenue-kept orders yet</p>
        <p className="max-w-sm text-sm text-text-dim">
          This fills in once orders start landing as pending, delivered, or banned.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {countries.length > 1 && (
        <div className="flex flex-col gap-1 self-start">
          <label className="text-xs font-medium text-text-dim" htmlFor="margin-country-filter">
            Country
          </label>
          <select
            id="margin-country-filter"
            value={countryFilter}
            onChange={(e) => setCountryFilter(e.target.value)}
            className="rounded-[10px] border border-line bg-paper-raised px-3.5 py-2.5 text-base text-text focus:border-signal focus:outline-none focus:ring-1 focus:ring-signal sm:text-sm"
          >
            <option value="">All countries</option>
            {countries.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="overflow-x-auto rounded-[14px] border border-line bg-paper-raised">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line text-text-dim">
              <th className="px-4 py-3 font-medium">Service</th>
              <th className="px-4 py-3 font-medium">Country</th>
              <th className="px-4 py-3 font-medium">Orders</th>
              <th className="px-4 py-3 font-medium">Revenue</th>
              <th className="px-4 py-3 font-medium">Cost</th>
              <th className="px-4 py-3 font-medium">Profit</th>
              <th className="px-4 py-3 font-medium">Margin</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => {
              // Compare the same rounded value that's displayed — otherwise
              // a row can show "44.7%" (rounded from 44.698...) yet be
              // colored as below a 44.7% target, which reads as a bug.
              const displayMarginPct = Number(row.marginPct.toFixed(1));
              const belowTarget = displayMarginPct < target;
              return (
                <tr key={`${row.serviceId}:${row.countryCode}`} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 text-text">{row.serviceName}</td>
                  <td className="px-4 py-3 text-text-dim">{row.countryName}</td>
                  <td className="px-4 py-3 text-text-dim">{row.orderCount}</td>
                  <td className="px-4 py-3 font-technical">{naira(row.revenueKobo)}</td>
                  <td className="px-4 py-3 font-technical text-text-dim">{naira(row.costKobo)}</td>
                  <td
                    className={`px-4 py-3 font-technical font-medium ${
                      row.profitKobo >= 0 ? "text-good" : "text-danger"
                    }`}
                  >
                    {naira(row.profitKobo)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 font-technical text-xs font-medium ${
                        belowTarget ? "bg-danger/15 text-danger" : "bg-good/15 text-good"
                      }`}
                    >
                      {displayMarginPct.toFixed(1)}%
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
