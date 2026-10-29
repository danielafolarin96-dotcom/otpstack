"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  sms_received: "Delivered",
  expired_refunded: "Expired (refunded)",
  cancelled_refunded: "Cancelled (refunded)",
  banned: "Banned",
};

const PROVIDER_LABELS: Record<string, string> = {
  "5sim": "5sim",
  grizzly: "Grizzly",
};

interface Service {
  id: string;
  name: string;
}

export function OrdersFilters({
  services,
  statuses,
  providers,
  selected,
}: {
  services: Service[];
  statuses: readonly string[];
  providers: readonly string[];
  selected: { status?: string; serviceId?: string; userQuery?: string; provider?: string };
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
    router.push(`/admin/orders?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-4">
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
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s] ?? s}
            </option>
          ))}
        </select>
      </div>

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
        <label className="text-xs font-medium text-text-dim" htmlFor="provider-filter">
          Provider
        </label>
        <select
          id="provider-filter"
          value={selected.provider ?? ""}
          onChange={(e) => setParam("provider", e.target.value)}
          // text-base below sm:, not text-sm alone: iOS Safari auto-zooms
          // the page on focus of any input under 16px computed font-size.
          className="rounded-[10px] border border-line bg-paper-raised px-3.5 py-2.5 text-base text-text focus:border-signal focus:outline-none focus:ring-1 focus:ring-signal sm:text-sm"
        >
          <option value="">All providers</option>
          {providers.map((p) => (
            <option key={p} value={p}>
              {PROVIDER_LABELS[p] ?? p}
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

      {(selected.status || selected.serviceId || selected.userQuery || selected.provider) && (
        <button
          type="button"
          onClick={() => {
            setUserQuery("");
            router.push("/admin/orders");
          }}
          className="rounded-[10px] px-3 py-2 text-sm font-medium text-text-dim transition-colors hover:text-text"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
