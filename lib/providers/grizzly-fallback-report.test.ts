import { describe, expect, it } from "vitest";
import { summarizeGrizzlyFallback, type GrizzlyFallbackEventInput } from "./grizzly-fallback-report";

function event(overrides: Partial<GrizzlyFallbackEventInput> = {}): GrizzlyFallbackEventInput {
  return {
    id: "evt-1",
    createdAt: new Date().toISOString(),
    serviceId: "service-1",
    serviceName: "TikTok",
    countryCode: "england",
    countryName: "United Kingdom",
    operator: "438",
    reason: "upstream_no_numbers",
    message: "grizzly getNumberV2 failed: 200 NO_NUMBERS",
    recoveredByFallback: false,
    recoveredOrderId: null,
    ...overrides,
  };
}

describe("summarizeGrizzlyFallback", () => {
  it("returns a zeroed-out summary and no rows for an empty event list", () => {
    const report = summarizeGrizzlyFallback([]);
    expect(report.summary).toEqual({ total: 0, recovered: 0, lost: 0, recoveryRatePct: 0 });
    expect(report.byServiceCountry).toEqual([]);
  });

  it("counts recovered vs lost and computes the recovery rate", () => {
    const report = summarizeGrizzlyFallback([
      event({ id: "1", recoveredByFallback: true, recoveredOrderId: "order-1" }),
      event({ id: "2", recoveredByFallback: true, recoveredOrderId: "order-2" }),
      event({ id: "3", recoveredByFallback: false }),
    ]);

    expect(report.summary).toEqual({ total: 3, recovered: 2, lost: 1, recoveryRatePct: 66.7 });
  });

  it("groups by service + country, keeping recovered/lost counts separate per group", () => {
    const report = summarizeGrizzlyFallback([
      event({ id: "1", serviceId: "svc-tiktok", serviceName: "TikTok", countryCode: "england", recoveredByFallback: false }),
      event({ id: "2", serviceId: "svc-tiktok", serviceName: "TikTok", countryCode: "england", recoveredByFallback: false }),
      event({
        id: "3",
        serviceId: "svc-insta",
        serviceName: "Instagram",
        countryCode: "england",
        recoveredByFallback: true,
        recoveredOrderId: "order-3",
      }),
    ]);

    expect(report.byServiceCountry).toHaveLength(2);
    const tiktok = report.byServiceCountry.find((r) => r.serviceName === "TikTok");
    expect(tiktok).toMatchObject({ total: 2, recovered: 0, lost: 2 });
    const instagram = report.byServiceCountry.find((r) => r.serviceName === "Instagram");
    expect(instagram).toMatchObject({ total: 1, recovered: 1, lost: 0 });
  });

  it("keeps the same service in different countries as separate rows", () => {
    const report = summarizeGrizzlyFallback([
      event({ serviceId: "svc-tiktok", serviceName: "TikTok", countryCode: "england" }),
      event({ serviceId: "svc-tiktok", serviceName: "TikTok", countryCode: "nigeria", countryName: "Nigeria" }),
    ]);

    expect(report.byServiceCountry).toHaveLength(2);
  });

  it("sorts by-service rows with the most failures first", () => {
    const report = summarizeGrizzlyFallback([
      event({ id: "1", serviceId: "svc-a", serviceName: "A" }),
      event({ id: "2", serviceId: "svc-b", serviceName: "B" }),
      event({ id: "3", serviceId: "svc-b", serviceName: "B" }),
      event({ id: "4", serviceId: "svc-b", serviceName: "B" }),
    ]);

    expect(report.byServiceCountry[0].serviceName).toBe("B");
    expect(report.byServiceCountry[0].total).toBe(3);
  });

  it("buckets a null serviceId/countryCode under 'unknown' rather than crashing", () => {
    const report = summarizeGrizzlyFallback([event({ serviceId: null, countryCode: null })]);
    expect(report.byServiceCountry).toHaveLength(1);
    expect(report.byServiceCountry[0].countryCode).toBe("unknown");
  });
});
