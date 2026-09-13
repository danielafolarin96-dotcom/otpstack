"use client";

import { Fragment, useState } from "react";

type OrderRow = {
  id: string;
  phone_number: string;
  status: string;
  price_kobo: number;
  created_at: string;
  completed_at: string | null;
  otp_code: string | null;
  services: { name: string } | null;
};

const STATUS_META: Record<string, { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-amber/15 text-amber" },
  sms_received: { label: "Delivered", className: "bg-good/15 text-good" },
  expired_refunded: { label: "Refunded", className: "bg-slate/15 text-slate" },
  cancelled_refunded: { label: "Refunded", className: "bg-slate/15 text-slate" },
  banned: { label: "Banned", className: "bg-danger/15 text-danger" },
};

// SECURITY.md: codes are retained specifically to support later viewing and
// dispute resolution — but only once they've actually arrived. `status`
// flips to sms_received and `otp_code` gets written in the same DB update
// (see lib/5sim/status.ts / the order-status route), so in practice they're
// never out of sync — this just makes that assumption explicit and
// defensive rather than trusting status alone to gate what gets rendered.
export function isCodeRevealable(order: Pick<OrderRow, "status" | "otp_code">): boolean {
  return order.status === "sms_received" && Boolean(order.otp_code);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function OrdersTable({ orders }: { orders: OrderRow[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (orders.length === 0) {
    return (
      <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-line bg-paper-raised px-6 text-center">
        <p className="font-display text-lg font-semibold text-ink">No orders yet</p>
        <p className="max-w-sm text-sm text-text-dim">
          Numbers you rent will show up here with their delivery status.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[14px] border border-line bg-paper-raised">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line text-text-dim">
            <th className="px-4 py-3 font-medium">Service</th>
            <th className="px-4 py-3 font-medium">Number</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Price</th>
            <th className="px-4 py-3 font-medium">Date</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => {
            const meta = STATUS_META[order.status] ?? {
              label: order.status,
              className: "bg-slate/15 text-slate",
            };
            const revealable = isCodeRevealable(order);
            const isExpanded = revealable && expandedId === order.id;

            return (
              <Fragment key={order.id}>
                <tr
                  className={`border-b border-line last:border-0 ${
                    revealable ? "cursor-pointer transition-colors hover:bg-paper" : ""
                  }`}
                  onClick={revealable ? () => setExpandedId(isExpanded ? null : order.id) : undefined}
                >
                  <td className="px-4 py-3">{order.services?.name ?? "—"}</td>
                  <td className="px-4 py-3 font-technical text-text-dim">{order.phone_number}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${meta.className}`}>
                      {meta.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-technical">
                    ₦{(order.price_kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-3 text-text-dim">
                    <div className="flex items-center justify-between gap-2">
                      {formatDate(order.created_at)}
                      {revealable && (
                        <span aria-hidden className="text-xs text-text-dim">
                          {isExpanded ? "▴" : "▾"}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
                {isExpanded && (
                  <tr className="border-b border-line bg-paper last:border-0">
                    <td colSpan={5} className="px-4 py-4">
                      <div className="flex flex-wrap items-center gap-6">
                        <div>
                          <p className="text-xs text-text-dim">Code received</p>
                          <p className="mt-1 font-technical text-2xl font-bold text-good">
                            {order.otp_code}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-text-dim">Number</p>
                          <p className="mt-1 font-technical text-text-dim">{order.phone_number}</p>
                        </div>
                        {order.completed_at && (
                          <div>
                            <p className="text-xs text-text-dim">Delivered</p>
                            <p className="mt-1 text-text-dim">{formatDateTime(order.completed_at)}</p>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
