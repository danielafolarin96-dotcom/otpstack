"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const POLL_INTERVAL_MS = 4000;

export interface ActiveOrder {
  id: string;
  status: string;
  phoneNumber: string;
  otpCode: string | null;
  expiresAt: string;
  serviceName: string;
}

function formatCountdown(msRemaining: number) {
  if (msRemaining <= 0) return "0:00";
  const totalSeconds = Math.floor(msRemaining / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function ActiveNumberPanel({ order: initialOrder }: { order: ActiveOrder | null }) {
  const router = useRouter();
  const [order, setOrder] = useState(initialOrder);
  const [now, setNow] = useState(() => Date.now());
  const [cancelling, setCancelling] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tick every second for the countdown display.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  // Audit fix: this used to also depend on `now`, which the countdown
  // effect above bumps every 1000ms — since that's shorter than
  // POLL_INTERVAL_MS (4000ms), the timeout got cleared and rescheduled
  // every second, before it could ever actually fire. The poll request was
  // never sent. `now` isn't referenced in this effect's body at all; it
  // was never needed here.
  //
  // Removing it isn't sufficient on its own, though: the effect only
  // reschedules the next poll when it re-runs, which happens when `order`
  // changes identity. The original callback only called setOrder when the
  // polled status actually differed — so once a single poll found "no
  // change" (the common case, while waiting for an SMS), `order` would
  // stop changing and polling would silently stop after that one attempt.
  // Calling setOrder on every completed poll (not just on a status change)
  // keeps `order`'s identity changing each cycle, which is what drives the
  // effect to reschedule the next poll 4s later.
  useEffect(() => {
    if (!order || order.status !== "pending") return;

    pollTimer.current = setTimeout(async () => {
      try {
        const response = await fetch(`/api/orders/${order.id}/status`);
        if (!response.ok) return;
        const json = await response.json();
        if (json.order.status !== order.status && json.order.status !== "pending") {
          router.refresh(); // wallet balance / recent activity may have changed
        }
        setOrder((prev) => (prev ? { ...prev, ...json.order } : prev));
      } catch {
        // Network hiccup — next tick will retry.
      }
    }, POLL_INTERVAL_MS);

    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [order, router]);

  async function handleCancel() {
    if (!order) return;
    setCancelling(true);
    try {
      const response = await fetch(`/api/orders/${order.id}/cancel`, { method: "POST" });
      if (response.ok) {
        router.refresh();
      }
    } finally {
      setCancelling(false);
    }
  }

  if (!order) {
    return (
      <div className="rounded-[14px] border border-line bg-paper-raised p-6">
        <p className="text-sm text-text-dim">Active number</p>
        <p className="mt-2 font-technical text-xl text-text-dim">No active number</p>
      </div>
    );
  }

  const msRemaining = new Date(order.expiresAt).getTime() - now;

  return (
    <div className="rounded-[14px] border border-line bg-paper-raised p-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-text-dim">Active number — {order.serviceName}</p>
        {order.status === "pending" && (
          <span className="font-technical text-sm text-amber">{formatCountdown(msRemaining)}</span>
        )}
      </div>
      <p className="mt-2 font-technical text-xl text-ink">{order.phoneNumber}</p>

      {order.status === "sms_received" && order.otpCode && (
        <p className="mt-3 font-technical text-2xl font-bold text-good">{order.otpCode}</p>
      )}
      {order.status === "expired_refunded" && (
        <p className="mt-3 text-sm text-danger">No code arrived in time — refunded to your wallet.</p>
      )}
      {order.status === "cancelled_refunded" && (
        <p className="mt-3 text-sm text-text-dim">Cancelled and refunded.</p>
      )}
      {order.status === "banned" && (
        <p className="mt-3 text-sm text-danger">This number was banned by the service.</p>
      )}

      {order.status === "pending" && (
        <button
          type="button"
          onClick={handleCancel}
          disabled={cancelling}
          className="mt-3 text-sm font-medium text-danger hover:underline disabled:opacity-60"
        >
          {cancelling ? "Cancelling…" : "Cancel for refund"}
        </button>
      )}
    </div>
  );
}
