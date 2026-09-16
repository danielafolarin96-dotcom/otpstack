"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

export function UsersFilters({ selected }: { selected: { q?: string; status?: string } }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [q, setQ] = useState(selected.q ?? "");

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.push(`/admin/users?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-4">
      <form
        className="flex flex-col gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          setParam("q", q);
        }}
      >
        <label className="text-xs font-medium text-text-dim" htmlFor="user-search">
          Search (name, email, or username)
        </label>
        <div className="flex gap-2">
          <input
            id="user-search"
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. jane or jane@example.com"
            // text-base below sm:, not text-sm alone: iOS Safari auto-zooms
            // the page on focus of any input under 16px computed font-size.
            className="w-64 rounded-[10px] border border-line bg-paper-raised px-3.5 py-2.5 text-base text-text focus:border-signal focus:outline-none focus:ring-1 focus:ring-signal sm:text-sm"
          />
          <button
            type="submit"
            className="rounded-[10px] border border-line bg-paper-raised px-3.5 py-2.5 text-sm font-medium text-text transition-colors hover:border-signal"
          >
            Search
          </button>
        </div>
      </form>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-text-dim" htmlFor="status-filter">
          Status
        </label>
        <select
          id="status-filter"
          value={selected.status ?? ""}
          onChange={(e) => setParam("status", e.target.value)}
          // text-base below sm:, not text-sm alone: iOS Safari auto-zooms
          // the page on focus of any input under 16px computed font-size.
          className="rounded-[10px] border border-line bg-paper-raised px-3.5 py-2.5 text-base text-text focus:border-signal focus:outline-none focus:ring-1 focus:ring-signal sm:text-sm"
        >
          <option value="">All accounts</option>
          <option value="active">Active only</option>
          <option value="frozen">Frozen only</option>
        </select>
      </div>

      {(selected.q || selected.status) && (
        <button
          type="button"
          onClick={() => {
            setQ("");
            router.push("/admin/users");
          }}
          className="rounded-[10px] px-3 py-2 text-sm font-medium text-text-dim transition-colors hover:text-text"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
