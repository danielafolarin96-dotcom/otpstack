"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

const TYPE_LABELS: Record<string, string> = {
  topup: "Top-up",
  purchase: "Purchase",
  refund: "Refund",
  admin_adjustment: "Adjustment",
};

export function TransactionsFilters({
  types,
  selected,
}: {
  types: readonly string[];
  selected: { type?: string; userQuery?: string };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [userQuery, setUserQuery] = useState(selected.userQuery ?? "");

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.push(`/admin/transactions?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-text-dim" htmlFor="type-filter">
          Type
        </label>
        <select
          id="type-filter"
          value={selected.type ?? ""}
          onChange={(e) => setParam("type", e.target.value)}
          // text-base below sm:, not text-sm alone: iOS Safari auto-zooms
          // the page on focus of any input under 16px computed font-size.
          className="rounded-[10px] border border-line bg-paper-raised px-3.5 py-2.5 text-base text-text focus:border-signal focus:outline-none focus:ring-1 focus:ring-signal sm:text-sm"
        >
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t] ?? t}
            </option>
          ))}
        </select>
      </div>

      <form
        className="flex flex-col gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          setParam("user", userQuery);
        }}
      >
        <label className="text-xs font-medium text-text-dim" htmlFor="user-filter">
          User (email or username)
        </label>
        <div className="flex gap-2">
          <input
            id="user-filter"
            type="text"
            value={userQuery}
            onChange={(e) => setUserQuery(e.target.value)}
            placeholder="e.g. jane or jane@example.com"
            // text-base below sm:, not text-sm alone: iOS Safari auto-zooms
            // the page on focus of any input under 16px computed font-size.
            className="w-56 rounded-[10px] border border-line bg-paper-raised px-3.5 py-2.5 text-base text-text focus:border-signal focus:outline-none focus:ring-1 focus:ring-signal sm:text-sm"
          />
          <button
            type="submit"
            className="rounded-[10px] border border-line bg-paper-raised px-3.5 py-2.5 text-sm font-medium text-text transition-colors hover:border-signal"
          >
            Search
          </button>
        </div>
      </form>

      {(selected.type || selected.userQuery) && (
        <button
          type="button"
          onClick={() => {
            setUserQuery("");
            router.push("/admin/transactions");
          }}
          className="rounded-[10px] px-3 py-2 text-sm font-medium text-text-dim transition-colors hover:text-text"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
