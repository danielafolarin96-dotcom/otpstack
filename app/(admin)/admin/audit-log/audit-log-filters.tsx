"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

const ACTION_LABELS: Record<string, string> = {
  "pricing_rule.create": "Pricing rule created",
  "pricing_rule.delete": "Pricing rule deleted",
  "user.freeze": "Account frozen",
  "user.unfreeze": "Account unfrozen",
  "order.manual_refund": "Manual refund",
};

export function AuditLogFilters({
  actions,
  selected,
}: {
  actions: readonly string[];
  selected: { action?: string; adminQuery?: string };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [adminQuery, setAdminQuery] = useState(selected.adminQuery ?? "");

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.push(`/admin/audit-log?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-text-dim" htmlFor="action-filter">
          Action
        </label>
        <select
          id="action-filter"
          value={selected.action ?? ""}
          onChange={(e) => setParam("action", e.target.value)}
          // text-base below sm:, not text-sm alone: iOS Safari auto-zooms
          // the page on focus of any input under 16px computed font-size.
          className="rounded-[10px] border border-line bg-paper-raised px-3.5 py-2.5 text-base text-text focus:border-signal focus:outline-none focus:ring-1 focus:ring-signal sm:text-sm"
        >
          <option value="">All actions</option>
          {actions.map((a) => (
            <option key={a} value={a}>
              {ACTION_LABELS[a] ?? a}
            </option>
          ))}
        </select>
      </div>

      <form
        className="flex flex-col gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          setParam("admin", adminQuery);
        }}
      >
        <label className="text-xs font-medium text-text-dim" htmlFor="admin-filter">
          Admin (name, email, or username)
        </label>
        <div className="flex gap-2">
          <input
            id="admin-filter"
            type="text"
            value={adminQuery}
            onChange={(e) => setAdminQuery(e.target.value)}
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

      {(selected.action || selected.adminQuery) && (
        <button
          type="button"
          onClick={() => {
            setAdminQuery("");
            router.push("/admin/audit-log");
          }}
          className="rounded-[10px] px-3 py-2 text-sm font-medium text-text-dim transition-colors hover:text-text"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
