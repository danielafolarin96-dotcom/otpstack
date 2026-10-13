"use client";

import { useEffect, useState } from "react";
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

interface ListenerTarget {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

// Money bug fixed Oct 2026 (see lib/orders/upstream-sms.ts): the old poll
// only rescheduled itself when a poll ended in setOrder, so a single
// non-2xx response or network error stopped polling for the rest of the
// order — four customers' codes sat at 5sim, never shown, until the order
// was cancelled/expired and refunded. This loop always schedules the next
// poll from a `finally`, whatever the previous one did. It also polls
// immediately when the tab becomes visible again, the window regains
// focus, or the browser comes back online — backgrounded tabs throttle
// timers, so those are exactly the moments a waiting customer looks back.
// Polls never overlap: an immediate trigger during an in-flight poll is
// dropped (that poll's finally reschedules). Pure (timers + event targets
// injected via globals/params) so it's testable without a DOM library —
// see active-number-panel.test.ts. Returns a stop function.
export function startPollLoop(options: {
  pollOnce: () => Promise<void>;
  intervalMs: number;
  windowTarget?: ListenerTarget;
  documentTarget?: ListenerTarget & { visibilityState: string };
}): () => void {
  const { pollOnce, intervalMs, windowTarget, documentTarget } = options;
  let stopped = false;
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function poll() {
    if (stopped || inFlight) return;
    inFlight = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    try {
      await pollOnce();
    } catch {
      // Network hiccup / bad response — the next poll retries.
    } finally {
      inFlight = false;
      if (!stopped) timer = setTimeout(poll, intervalMs);
    }
  }

  function pollNow() {
    void poll();
  }
  function pollIfVisible() {
    if (documentTarget?.visibilityState === "visible") void poll();
  }

  timer = setTimeout(poll, intervalMs);
  windowTarget?.addEventListener("focus", pollNow);
  windowTarget?.addEventListener("online", pollNow);
  documentTarget?.addEventListener("visibilitychange", pollIfVisible);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    windowTarget?.removeEventListener("focus", pollNow);
    windowTarget?.removeEventListener("online", pollNow);
    documentTarget?.removeEventListener("visibilitychange", pollIfVisible);
  };
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
  // Set when a cancel request finds the code already arrived at 5sim (the
  // cancel route delivers it instead of refunding) — see handleCancel.
  const [codeArrivedOnCancel, setCodeArrivedOnCancel] = useState(false);

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

  // Keyed on the order's id and whether it's still pending — not on the
  // `order` object itself — so the loop starts once per pending order and
  // stops as soon as it resolves, independent of how often setOrder runs.
  // (History: an earlier version depended on `now`, which reset the timer
  // every second so no poll ever fired; the version after that depended on
  // `order` and only rescheduled via setOrder, which a single failed fetch
  // skipped — see startPollLoop's comment.)
  const pollingOrderId = order?.status === "pending" ? order.id : null;
  useEffect(() => {
    if (!pollingOrderId) return;

    return startPollLoop({
      intervalMs: POLL_INTERVAL_MS,
      windowTarget: window,
      documentTarget: document,
      pollOnce: async () => {
        const response = await fetch(`/api/orders/${pollingOrderId}/status`);
        if (!response.ok) return;
        const json = await response.json();
        if (json.order.status !== "pending") {
          router.refresh(); // wallet balance / recent activity may have changed
        }
        setOrder((prev) => (prev && prev.id === pollingOrderId ? { ...prev, ...json.order } : prev));
      },
    });
  }, [pollingOrderId, router]);

  async function handleCancel() {
    if (!order) return;
    setCancelling(true);
    try {
      const response = await fetch(`/api/orders/${order.id}/cancel`, { method: "POST" });
      if (response.ok) {
        const json = await response.json().catch(() => null);
        // The cancel route returns the order instead of refunding when 5sim
        // already had the SMS (see app/api/orders/[id]/cancel/route.ts) —
        // show the code right away rather than waiting on the next poll.
        if (json?.order?.status === "sms_received") {
          setCodeArrivedOnCancel(true);
          setOrder((prev) => (prev && prev.id === json.order.id ? { ...prev, ...json.order } : prev));
        }
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

      {order.status === "sms_received" && order.otpCode && codeArrivedOnCancel && (
        <p className="mt-3 text-sm text-good">Your code arrived! This order completed instead of being cancelled.</p>
      )}
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
