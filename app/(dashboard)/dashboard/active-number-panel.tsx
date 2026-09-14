"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const POLL_INTERVAL_MS = 4000;

// Bug fix (Sept 2026): the customer explicitly dismissing a delivered (or
// otherwise resolved) order is the only way this card clears now — see
// handleDismiss below and app/(dashboard)/dashboard/page.tsx's query
// comment. Persisted in localStorage (not just component state) so a
// dismiss survives a hard reload, not just client-side navigation —
// keyed by order id, so a genuinely new order (a fresh purchase) is never
// affected by a previous order's dismissal.
const DISMISSED_ORDER_STORAGE_KEY = "otpstack:dismissed-active-order-id";

function readDismissedOrderId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(DISMISSED_ORDER_STORAGE_KEY);
  } catch {
    return null; // localStorage unavailable (e.g. private browsing) — never treat as dismissed
  }
}

function writeDismissedOrderId(orderId: string) {
  try {
    window.localStorage.setItem(DISMISSED_ORDER_STORAGE_KEY, orderId);
  } catch {
    // Dismiss still works for this component instance via state — it just
    // won't survive a hard reload if storage isn't available.
  }
}

export interface ActiveOrder {
  id: string;
  status: string;
  phoneNumber: string;
  otpCode: string | null;
  expiresAt: string;
  serviceName: string;
}

// Pure decision extracted out of the component so it's testable without a
// DOM-rendering library (none is set up in this repo — see
// active-number-panel.test.ts). This is the crux of the bug fix: a
// delivered (sms_received) order must keep resolving to itself here
// rather than being excluded, which is what let it "revert to No active
// number" the instant SMS arrived. A pending order is never dismissible
// (there's nothing to dismiss yet — cancel-for-refund is the action for
// that state), so a stale dismissed-id never hides one.
export function resolveVisibleOrder(
  order: ActiveOrder | null,
  dismissedOrderId: string | null,
): ActiveOrder | null {
  if (!order) return null;
  if (order.status !== "pending" && order.id === dismissedOrderId) return null;
  return order;
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
  const [order, setOrder] = useState(() => resolveVisibleOrder(initialOrder, readDismissedOrderId()));
  const [now, setNow] = useState(() => Date.now());
  const [cancelling, setCancelling] = useState(false);
  const [copied, setCopied] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleDismiss() {
    if (!order) return;
    writeDismissedOrderId(order.id);
    setOrder(null);
  }

  async function handleCopyCode() {
    if (!order?.otpCode) return;
    try {
      await navigator.clipboard.writeText(order.otpCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard permission denied or unavailable — the code is still
      // shown on screen, so this is a nice-to-have, not a hard failure.
    }
  }

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
        <div className="mt-3 flex items-center gap-3">
          <p className="font-technical text-2xl font-bold text-good">{order.otpCode}</p>
          <button
            type="button"
            onClick={handleCopyCode}
            className="rounded-[8px] border border-line px-2.5 py-1 text-xs font-medium text-text-dim transition-colors hover:border-signal hover:text-text"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
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

      {order.status !== "pending" && (
        <button
          type="button"
          onClick={handleDismiss}
          className="mt-3 text-sm font-medium text-text-dim hover:text-text hover:underline"
        >
          Dismiss
        </button>
      )}
    </div>
  );
}
