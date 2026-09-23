import { describe, expect, it } from "vitest";
import { summarizeMargin, TARGET_MARGIN_PCT, type MarginOrderInput } from "./margin-report";

const WHATSAPP = { serviceId: "svc-whatsapp", serviceName: "WhatsApp" };
const TELEGRAM = { serviceId: "svc-telegram", serviceName: "Telegram" };
const USA = { countryCode: "usa", countryName: "USA" };
const UK = { countryCode: "uk", countryName: "UK" };

function order(overrides: Partial<MarginOrderInput>): MarginOrderInput {
  return {
    status: "sms_received",
    priceKobo: 100_000,
    upstreamCostKobo: 70_000,
    upstreamCancelSucceeded: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    ...WHATSAPP,
    ...USA,
    ...overrides,
  };
}

describe("summarizeMargin", () => {
  it("computes overall revenue, cost, and margin across revenue-kept orders", () => {
    const report = summarizeMargin([
      order({ priceKobo: 100_000, upstreamCostKobo: 70_000 }),
      order({ status: "pending", priceKobo: 50_000, upstreamCostKobo: 40_000 }),
    ]);

    expect(report.overall.orderCount).toBe(2);
    expect(report.overall.revenueKobo).toBe(150_000);
    expect(report.overall.costKobo).toBe(110_000);
    expect(report.overall.marginPct).toBeCloseTo(((150_000 - 110_000) / 150_000) * 100, 5);
    expect(report.realizedProfitKobo).toBe(40_000);
  });

  it("excludes refunded orders from overall revenue/cost, tracking their cost separately", () => {
    const report = summarizeMargin([
      order({ priceKobo: 100_000, upstreamCostKobo: 70_000 }),
      order({ status: "expired_refunded", priceKobo: 50_000, upstreamCostKobo: 40_000 }),
      order({ status: "cancelled_refunded", priceKobo: 60_000, upstreamCostKobo: 45_000 }),
    ]);

    expect(report.overall.orderCount).toBe(1);
    expect(report.overall.revenueKobo).toBe(100_000);
    expect(report.overall.costKobo).toBe(70_000);

    expect(report.refunded.orderCount).toBe(2);
    expect(report.refunded.costKobo).toBe(85_000);

    // 5sim isn't refunded when we refund a customer, so refunded cost is a
    // real loss on top of the revenue-kept profit — realizedProfitKobo
    // must subtract it, not just report.overall's own margin.
    expect(report.realizedProfitKobo).toBe(100_000 - 70_000 - 85_000);
  });

  it("counts a banned order as revenue-kept (no automatic refund, per ARCHITECTURE.md)", () => {
    const report = summarizeMargin([order({ status: "banned", priceKobo: 100_000, upstreamCostKobo: 70_000 })]);

    expect(report.overall.orderCount).toBe(1);
    expect(report.overall.revenueKobo).toBe(100_000);
    expect(report.refunded.orderCount).toBe(0);
  });

  it("breaks revenue-kept orders down per service, worst margin first", () => {
    const report = summarizeMargin([
      order({ ...WHATSAPP, priceKobo: 100_000, upstreamCostKobo: 60_000 }), // 40% margin
      order({ ...TELEGRAM, priceKobo: 100_000, upstreamCostKobo: 90_000 }), // 10% margin
    ]);

    expect(report.byService.map((r) => r.serviceId)).toEqual([TELEGRAM.serviceId, WHATSAPP.serviceId]);
    expect(report.byService[0].marginPct).toBeCloseTo(10, 5);
    expect(report.byService[1].marginPct).toBeCloseTo(40, 5);
  });

  it("splits the same service into separate rows per country instead of merging them", () => {
    const report = summarizeMargin([
      order({ ...WHATSAPP, ...USA, priceKobo: 100_000, upstreamCostKobo: 60_000 }),
      order({ ...WHATSAPP, ...UK, priceKobo: 100_000, upstreamCostKobo: 90_000 }),
    ]);

    expect(report.byService).toHaveLength(2);
    const usaRow = report.byService.find((r) => r.countryCode === "usa");
    const ukRow = report.byService.find((r) => r.countryCode === "uk");
    expect(usaRow?.serviceName).toBe("WhatsApp");
    expect(usaRow?.countryName).toBe("USA");
    expect(ukRow?.countryName).toBe("UK");
    expect(usaRow?.orderCount).toBe(1);
    expect(ukRow?.orderCount).toBe(1);
  });

  it("aggregates multiple orders for the same service AND country into one row", () => {
    const report = summarizeMargin([
      order({ priceKobo: 100_000, upstreamCostKobo: 70_000 }),
      order({ priceKobo: 200_000, upstreamCostKobo: 140_000 }),
    ]);

    expect(report.byService).toHaveLength(1);
    expect(report.byService[0].orderCount).toBe(2);
    expect(report.byService[0].revenueKobo).toBe(300_000);
    expect(report.byService[0].costKobo).toBe(210_000);
    expect(report.byService[0].profitKobo).toBe(90_000);
  });

  it("returns an empty, zeroed report for no orders", () => {
    const report = summarizeMargin([]);
    expect(report.overall).toEqual({ orderCount: 0, revenueKobo: 0, costKobo: 0, marginPct: 0 });
    expect(report.refunded).toEqual({
      orderCount: 0,
      costKobo: 0,
      recovered: { orderCount: 0, costKobo: 0 },
      lost: { orderCount: 0, costKobo: 0 },
      unknown: { orderCount: 0, costKobo: 0 },
    });
    expect(report.byService).toEqual([]);
    expect(report.realizedProfitKobo).toBe(0);
  });

  it("splits refunded cost into recovered vs lost based on whether the upstream cancel succeeded", () => {
    const report = summarizeMargin([
      order({ status: "expired_refunded", upstreamCostKobo: 40_000, upstreamCancelSucceeded: false }), // lost — cancel failed, sweep too slow
      order({ status: "cancelled_refunded", upstreamCostKobo: 45_000, upstreamCancelSucceeded: true }), // recovered — cancel succeeded
      order({ status: "cancelled_refunded", upstreamCostKobo: 10_000, upstreamCancelSucceeded: true }), // recovered
      order({ status: "expired_refunded", upstreamCostKobo: 5_000, upstreamCancelSucceeded: null }), // unknown — predates tracking
    ]);

    expect(report.refunded.orderCount).toBe(4);
    expect(report.refunded.costKobo).toBe(100_000);
    expect(report.refunded.recovered).toEqual({ orderCount: 2, costKobo: 55_000 });
    expect(report.refunded.lost).toEqual({ orderCount: 1, costKobo: 40_000 });
    expect(report.refunded.unknown).toEqual({ orderCount: 1, costKobo: 5_000 });
  });

  it("exposes the 44.7% standing markup target as a named constant, not the 30% floor", () => {
    expect(TARGET_MARGIN_PCT).toBe(44.7);
  });

  describe("sinceEpochAt (reporting-epoch feature)", () => {
    const EPOCH = "2026-09-14T11:50:31.935Z";

    it("excludes an order created before the epoch and includes one created after it", () => {
      const report = summarizeMargin(
        [
          order({ createdAt: "2026-09-14T11:50:31.934Z", priceKobo: 100_000, upstreamCostKobo: 70_000 }), // 1ms before — excluded
          order({ createdAt: "2026-09-14T11:50:32.000Z", priceKobo: 50_000, upstreamCostKobo: 30_000 }), // after — included
        ],
        { sinceEpochAt: EPOCH },
      );

      expect(report.overall.orderCount).toBe(1);
      expect(report.overall.revenueKobo).toBe(50_000);
      expect(report.overall.costKobo).toBe(30_000);
    });

    it("treats createdAt exactly equal to the epoch as included (inclusive cutoff)", () => {
      const report = summarizeMargin([order({ createdAt: EPOCH, priceKobo: 100_000, upstreamCostKobo: 70_000 })], {
        sinceEpochAt: EPOCH,
      });

      expect(report.overall.orderCount).toBe(1);
    });

    it("also excludes pre-epoch orders from the refunded bucket, not just overall", () => {
      const report = summarizeMargin(
        [
          order({
            createdAt: "2026-01-01T00:00:00.000Z",
            status: "expired_refunded",
            upstreamCostKobo: 40_000,
            upstreamCancelSucceeded: false,
          }),
          order({
            createdAt: "2026-12-01T00:00:00.000Z",
            status: "expired_refunded",
            upstreamCostKobo: 25_000,
            upstreamCancelSucceeded: true,
          }),
        ],
        { sinceEpochAt: EPOCH },
      );

      expect(report.refunded.orderCount).toBe(1);
      expect(report.refunded.costKobo).toBe(25_000);
      expect(report.refunded.recovered).toEqual({ orderCount: 1, costKobo: 25_000 });
    });

    it("with no sinceEpochAt (default), behaves exactly as all-time — pre-epoch orders still count", () => {
      const report = summarizeMargin([
        order({ createdAt: "2020-01-01T00:00:00.000Z", priceKobo: 100_000, upstreamCostKobo: 70_000 }),
      ]);

      expect(report.overall.orderCount).toBe(1);
    });
  });
});
