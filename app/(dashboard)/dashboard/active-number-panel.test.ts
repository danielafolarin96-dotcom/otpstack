import { describe, expect, it } from "vitest";
import { resolveVisibleOrder, type ActiveOrder } from "./active-number-panel";

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
