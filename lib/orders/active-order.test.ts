import { describe, expect, it } from "vitest";
import { DELIVERED_GRACE_MS, shouldShowOnDashboard } from "./active-order";

const NOW = Date.parse("2026-11-06T10:00:00Z");
const minutesFromNow = (m: number) => new Date(NOW + m * 60_000).toISOString();

describe("shouldShowOnDashboard", () => {
  it("shows nothing when the customer has no orders", () => {
    expect(shouldShowOnDashboard(null, NOW)).toBe(false);
  });

  it("shows a pending order", () => {
    expect(shouldShowOnDashboard({ status: "pending", expires_at: minutesFromNow(3) }, NOW)).toBe(true);
  });

  it("shows a pending order even past its expiry (the expire cron hasn't swept it yet)", () => {
    expect(shouldShowOnDashboard({ status: "pending", expires_at: minutesFromNow(-1) }, NOW)).toBe(true);
  });

  it("shows a freshly delivered code", () => {
    expect(shouldShowOnDashboard({ status: "sms_received", expires_at: minutesFromNow(2) }, NOW)).toBe(true);
  });

  it("still shows a delivered code within the grace window after the hold ended", () => {
    expect(shouldShowOnDashboard({ status: "sms_received", expires_at: minutesFromNow(-29) }, NOW)).toBe(true);
  });

  it("stops showing a delivered code once it's stale — the reported bug: a days-old Hinge code popped back up", () => {
    const daysAgo = new Date(NOW - 3 * 24 * 60 * 60_000).toISOString();
    expect(shouldShowOnDashboard({ status: "sms_received", expires_at: daysAgo }, NOW)).toBe(false);
    const justPastGrace = new Date(NOW - DELIVERED_GRACE_MS - 1000).toISOString();
    expect(shouldShowOnDashboard({ status: "sms_received", expires_at: justPastGrace }, NOW)).toBe(false);
  });

  it("shows nothing when the newest order expired, was cancelled, or was banned — it must not fall back to an older order", () => {
    for (const status of ["expired_refunded", "cancelled_refunded", "banned"]) {
      expect(shouldShowOnDashboard({ status, expires_at: minutesFromNow(-1) }, NOW)).toBe(false);
    }
  });

  it("shows a delivered code whose timestamp is unreadable rather than hiding it", () => {
    expect(shouldShowOnDashboard({ status: "sms_received", expires_at: "not-a-date" }, NOW)).toBe(true);
  });
});
