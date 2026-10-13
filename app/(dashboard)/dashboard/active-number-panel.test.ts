import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveVisibleOrder, startPollLoop, type ActiveOrder } from "./active-number-panel";

const PENDING: ActiveOrder = {
  id: "order-1",
  status: "pending",
  phoneNumber: "+2348000000000",
  otpCode: null,
  expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  serviceName: "TikTok",
};

const DELIVERED: ActiveOrder = { ...PENDING, status: "sms_received", otpCode: "123456" };

describe("resolveVisibleOrder", () => {
  it("keeps showing a delivered order — the reported bug: this used to disappear the instant status left pending", () => {
    expect(resolveVisibleOrder(DELIVERED, null)).toEqual(DELIVERED);
  });

  it("keeps showing a still-pending order", () => {
    expect(resolveVisibleOrder(PENDING, null)).toEqual(PENDING);
  });

  it("hides an order once its id has been explicitly dismissed", () => {
    expect(resolveVisibleOrder(DELIVERED, DELIVERED.id)).toBeNull();
  });

  it("a pending order is never hidden by a dismissal — nothing to dismiss yet, cancel-for-refund is that action", () => {
    expect(resolveVisibleOrder(PENDING, PENDING.id)).toEqual(PENDING);
  });

  it("does not hide a different order just because an earlier one (same slot) was dismissed", () => {
    const newerOrder = { ...DELIVERED, id: "order-2" };
    expect(resolveVisibleOrder(newerOrder, DELIVERED.id)).toEqual(newerOrder);
  });

  it("returns null when there's no order at all", () => {
    expect(resolveVisibleOrder(null, null)).toBeNull();
    expect(resolveVisibleOrder(null, "some-old-id")).toBeNull();
  });

  it("also stays visible for the other terminal statuses until dismissed", () => {
    for (const status of ["expired_refunded", "cancelled_refunded", "banned"]) {
      const order = { ...DELIVERED, status };
      expect(resolveVisibleOrder(order, null)).toEqual(order);
      expect(resolveVisibleOrder(order, order.id)).toBeNull();
    }
  });
});

// Money bug fix (Oct 2026): one failed status fetch used to end polling for
// the rest of the order. startPollLoop is the extracted, DOM-free loop.
describe("startPollLoop", () => {
  const INTERVAL = 4000;

  function fakeTargets(visibilityState = "visible") {
    const windowTarget = new EventTarget();
    const documentTarget = Object.assign(new EventTarget(), { visibilityState });
    return { windowTarget, documentTarget };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps polling on the interval after a successful poll", async () => {
    const pollOnce = vi.fn().mockResolvedValue(undefined);
    const stop = startPollLoop({ pollOnce, intervalMs: INTERVAL });

    await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    expect(pollOnce).toHaveBeenCalledTimes(3);
    stop();
  });

  it("keeps polling after a poll throws — the reported bug: a network error used to stop the loop for good", async () => {
    const pollOnce = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(undefined);
    const stop = startPollLoop({ pollOnce, intervalMs: INTERVAL });

    await vi.advanceTimersByTimeAsync(INTERVAL * 4);
    expect(pollOnce).toHaveBeenCalledTimes(4);
    stop();
  });

  it("keeps polling after a poll that returns without updating anything (e.g. a non-2xx response)", async () => {
    // The panel's pollOnce just returns on !response.ok — the loop must
    // reschedule regardless of what pollOnce did.
    const pollOnce = vi.fn().mockResolvedValue(undefined);
    const stop = startPollLoop({ pollOnce, intervalMs: INTERVAL });

    await vi.advanceTimersByTimeAsync(INTERVAL * 2);
    expect(pollOnce).toHaveBeenCalledTimes(2);
    stop();
  });

  it("polls immediately when the tab becomes visible, and not when it becomes hidden", async () => {
    const pollOnce = vi.fn().mockResolvedValue(undefined);
    const { windowTarget, documentTarget } = fakeTargets("hidden");
    const stop = startPollLoop({ pollOnce, intervalMs: INTERVAL, windowTarget, documentTarget });

    documentTarget.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(pollOnce).not.toHaveBeenCalled();

    documentTarget.visibilityState = "visible";
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(pollOnce).toHaveBeenCalledTimes(1);
    stop();
  });

  it("polls immediately on window focus and on coming back online", async () => {
    const pollOnce = vi.fn().mockResolvedValue(undefined);
    const { windowTarget, documentTarget } = fakeTargets();
    const stop = startPollLoop({ pollOnce, intervalMs: INTERVAL, windowTarget, documentTarget });

    windowTarget.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    windowTarget.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);

    expect(pollOnce).toHaveBeenCalledTimes(2);
    stop();
  });

  it("an immediate poll resets the interval instead of stacking a second timer", async () => {
    const pollOnce = vi.fn().mockResolvedValue(undefined);
    const { windowTarget, documentTarget } = fakeTargets();
    const stop = startPollLoop({ pollOnce, intervalMs: INTERVAL, windowTarget, documentTarget });

    await vi.advanceTimersByTimeAsync(INTERVAL - 1000);
    windowTarget.dispatchEvent(new Event("focus")); // poll #1 at t=3000
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1000); // t=4000: the original timer must NOT fire
    expect(pollOnce).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(INTERVAL - 1000); // t=7000: next scheduled poll
    expect(pollOnce).toHaveBeenCalledTimes(2);
    stop();
  });

  it("never overlaps polls — a trigger during an in-flight poll is dropped", async () => {
    let resolvePoll: () => void = () => {};
    const pollOnce = vi.fn(() => new Promise<void>((resolve) => (resolvePoll = resolve)));
    const { windowTarget, documentTarget } = fakeTargets();
    const stop = startPollLoop({ pollOnce, intervalMs: INTERVAL, windowTarget, documentTarget });

    windowTarget.dispatchEvent(new Event("focus"));
    windowTarget.dispatchEvent(new Event("online"));
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(INTERVAL * 2); // still in flight, no timer pending
    expect(pollOnce).toHaveBeenCalledTimes(1);

    resolvePoll();
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(pollOnce).toHaveBeenCalledTimes(2);
    stop();
  });

  it("stop() halts the interval and removes every listener", async () => {
    const pollOnce = vi.fn().mockResolvedValue(undefined);
    const { windowTarget, documentTarget } = fakeTargets();
    const stop = startPollLoop({ pollOnce, intervalMs: INTERVAL, windowTarget, documentTarget });

    stop();
    windowTarget.dispatchEvent(new Event("focus"));
    windowTarget.dispatchEvent(new Event("online"));
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(INTERVAL * 3);

    expect(pollOnce).not.toHaveBeenCalled();
  });

  it("does not reschedule when stopped while a poll is in flight", async () => {
    let resolvePoll: () => void = () => {};
    const pollOnce = vi.fn(() => new Promise<void>((resolve) => (resolvePoll = resolve)));
    const stop = startPollLoop({ pollOnce, intervalMs: INTERVAL });

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(pollOnce).toHaveBeenCalledTimes(1);
    stop();
    resolvePoll();
    await vi.advanceTimersByTimeAsync(INTERVAL * 3);

    expect(pollOnce).toHaveBeenCalledTimes(1);
  });
});
