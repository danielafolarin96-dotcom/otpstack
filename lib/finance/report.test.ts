import { describe, expect, it } from "vitest";
import { summarizeFinanceEvents, type FinanceEventInput } from "./report";

function recognized(overrides: Partial<FinanceEventInput> = {}): FinanceEventInput {
  return {
    orderId: "order-1",
    eventType: "revenue_recognized",
    serviceId: "service-1",
    serviceName: "WhatsApp",
    countryCode: "usa",
    countryName: "USA",
    provider: "5sim",
    revenueKobo: 100_000,
    providerCostKobo: 20_000,
    paymentFeeKobo: 1_500,
    createdAt: "2026-09-20T10:00:00.000Z",
    ...overrides,
  };
}

describe("summarizeFinanceEvents", () => {
  it("computes gross and net profit for a kept (non-refunded) order", () => {
    const { rows, totals } = summarizeFinanceEvents([recognized()]);

    expect(rows).toHaveLength(1);
    expect(rows[0].grossProfitKobo).toBe(80_000); // 100,000 - 20,000
    expect(rows[0].netProfitKobo).toBe(78_500); // 100,000 - 20,000 - 1,500
    expect(rows[0].refundKobo).toBe(0);
    expect(totals.orderCount).toBe(1);
    expect(totals.refundedOrderCount).toBe(0);
    expect(totals.netProfitKobo).toBe(78_500);
  });

  it("nets a recovered refund (upstream cancel succeeded) to zero profit", () => {
    const events = [
      recognized(),
      recognized({
        eventType: "refund_issued",
        revenueKobo: -100_000,
        providerCostKobo: -20_000, // recovered from 5sim -> fully reversed
        paymentFeeKobo: -1_500,
        createdAt: "2026-09-20T10:05:00.000Z",
      }),
    ];

    const { rows, totals } = summarizeFinanceEvents(events);

    expect(rows[0].revenueKobo).toBe(0);
    expect(rows[0].providerCostKobo).toBe(0);
    expect(rows[0].paymentFeeKobo).toBe(0);
    expect(rows[0].refundKobo).toBe(100_000);
    expect(rows[0].netProfitKobo).toBe(0);
    expect(totals.refundedOrderCount).toBe(1);
  });

  it("treats an unrecovered refund (upstream cancel failed) as a real loss", () => {
    const events = [
      recognized(),
      recognized({
        eventType: "refund_issued",
        revenueKobo: -100_000,
        providerCostKobo: 0, // not recovered -> stays a loss, not reversed
        paymentFeeKobo: -1_500,
        createdAt: "2026-09-20T10:05:00.000Z",
      }),
    ];

    const { rows } = summarizeFinanceEvents(events);

    expect(rows[0].revenueKobo).toBe(0);
    expect(rows[0].providerCostKobo).toBe(20_000); // the original cost, never reversed
    expect(rows[0].grossProfitKobo).toBe(-20_000);
    expect(rows[0].netProfitKobo).toBe(-20_000);
    expect(rows[0].refundKobo).toBe(100_000);
  });

  it("keeps a refund attached to its order even when the refund lands outside the date window", () => {
    const events = [
      recognized({ createdAt: "2026-09-01T00:00:00.000Z" }),
      recognized({
        eventType: "refund_issued",
        revenueKobo: -100_000,
        providerCostKobo: 0,
        paymentFeeKobo: -1_500,
        createdAt: "2026-09-23T00:00:00.000Z", // outside the Sept 1-2 filter window below
      }),
    ];

    const { rows } = summarizeFinanceEvents(events, {
      fromDate: "2026-09-01T00:00:00.000Z",
      toDate: "2026-09-02T00:00:00.000Z",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].refundKobo).toBe(100_000);
    expect(rows[0].netProfitKobo).toBe(-20_000);
  });

  it("filters by date range using the order's creation (revenue_recognized) time", () => {
    const events = [
      recognized({ orderId: "order-1", createdAt: "2026-09-01T00:00:00.000Z" }),
      recognized({ orderId: "order-2", createdAt: "2026-09-15T00:00:00.000Z" }),
    ];

    const { rows } = summarizeFinanceEvents(events, {
      fromDate: "2026-09-10T00:00:00.000Z",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].orderId).toBe("order-2");
  });

  it("filters by country, service, and provider", () => {
    const events = [
      recognized({ orderId: "order-1", countryCode: "usa" }),
      recognized({ orderId: "order-2", countryCode: "uk" }),
    ];

    expect(summarizeFinanceEvents(events, { countryCode: "uk" }).rows).toHaveLength(1);
    expect(summarizeFinanceEvents(events, { serviceId: "nonexistent" }).rows).toHaveLength(0);
    expect(summarizeFinanceEvents(events, { provider: "5sim" }).rows).toHaveLength(2);
  });

  it("sums totals and margins across multiple orders", () => {
    const events = [
      recognized({ orderId: "order-1", revenueKobo: 100_000, providerCostKobo: 20_000, paymentFeeKobo: 1_500 }),
      recognized({ orderId: "order-2", revenueKobo: 50_000, providerCostKobo: 10_000, paymentFeeKobo: 750 }),
    ];

    const { totals } = summarizeFinanceEvents(events);

    expect(totals.orderCount).toBe(2);
    expect(totals.revenueKobo).toBe(150_000);
    expect(totals.providerCostKobo).toBe(30_000);
    expect(totals.paymentFeeKobo).toBe(2_250);
    expect(totals.grossProfitKobo).toBe(120_000);
    expect(totals.netProfitKobo).toBe(117_750);
    expect(totals.grossMarginPct).toBeCloseTo(80, 5);
  });

  it("returns an empty report for no events", () => {
    const { rows, totals } = summarizeFinanceEvents([]);
    expect(rows).toHaveLength(0);
    expect(totals.orderCount).toBe(0);
    expect(totals.grossMarginPct).toBe(0);
    expect(totals.netMarginPct).toBe(0);
  });
});
