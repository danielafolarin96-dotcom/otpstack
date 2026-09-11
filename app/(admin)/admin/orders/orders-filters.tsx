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

interface Service {
  id: string;
  name: string;
}

export function OrdersFilters({
  services,
  statuses,
  selected,
}: {
  services: Service[];
  statuses: readonly string[];
  selected: { status?: string; serviceId?: string; userQuery?: string };
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
          className="rounded-[10px] border border-line bg-paper-raised px-3.5 py-2.5 text-sm text-text focus:border-signal focus:outline-none focus:ring-1 focus:ring-signal"
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
          className="rounded-[10px] border border-line bg-paper-raised px-3.5 py-2.5 text-sm text-text focus:border-signal focus:outline-none focus:ring-1 focus:ring-signal"
        >
          <option value="">All services</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
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
            className="w-56 rounded-[10px] border border-line bg-paper-raised px-3.5 py-2.5 text-sm text-text focus:border-signal focus:outline-none focus:ring-1 focus:ring-signal"
          />
          <button
            type="submit"
            className="rounded-[10px] border border-line bg-paper-raised px-3.5 py-2.5 text-sm font-medium text-text transition-colors hover:border-signal"
          >
            Search
          </button>
        </div>
      </form>

      {(selected.status || selected.serviceId || selected.userQuery) && (
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
