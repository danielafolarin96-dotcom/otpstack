import { describe, expect, it } from "vitest";
import { resolveDateRangePreset } from "./date-range";

// 2026-09-23 10:00 UTC = 2026-09-23 11:00 Lagos (UTC+1) -- well inside the
// Lagos calendar day, so no boundary ambiguity in these fixtures.
const NOW = new Date("2026-09-23T10:00:00.000Z");

describe("resolveDateRangePreset", () => {
  it("'today' starts at Lagos midnight, not UTC midnight", () => {
    const { fromDate, toDate } = resolveDateRangePreset("today", NOW);
    // Lagos midnight on 2026-09-23 is 2026-09-22T23:00:00Z.
    expect(fromDate).toBe("2026-09-22T23:00:00.000Z");
    expect(toDate).toBeNull();
  });

  it("'today' near UTC midnight still resolves to the correct Lagos day", () => {
    // 2026-09-23T00:30:00Z is 2026-09-23T01:30 Lagos -- still the 23rd in
    // Lagos, even though it's already the 23rd in UTC too here; the
    // meaningful case is the reverse boundary, covered by the test below.
    const { fromDate } = resolveDateRangePreset("today", new Date("2026-09-23T00:30:00.000Z"));
    expect(fromDate).toBe("2026-09-22T23:00:00.000Z");
  });

  it("'today' just before UTC midnight is still Lagos' next day", () => {
    // 2026-09-22T23:30:00Z is 2026-09-23T00:30 Lagos -- already the 23rd
    // locally, even though UTC still reads the 22nd. A naive UTC-midnight
    // implementation would get this wrong by an hour.
    const { fromDate } = resolveDateRangePreset("today", new Date("2026-09-22T23:30:00.000Z"));
    expect(fromDate).toBe("2026-09-22T23:00:00.000Z");
  });

  it("'7d' covers the last 7 calendar days including today", () => {
    const { fromDate } = resolveDateRangePreset("7d", NOW);
    expect(fromDate).toBe("2026-09-16T23:00:00.000Z"); // Lagos midnight on the 17th
  });

  it("'30d' covers the last 30 calendar days including today", () => {
    const { fromDate } = resolveDateRangePreset("30d", NOW);
    expect(fromDate).toBe("2026-08-24T23:00:00.000Z"); // Lagos midnight on Aug 25
  });

  it("'month' starts at the 1st of the current Lagos month", () => {
    const { fromDate } = resolveDateRangePreset("month", NOW);
    expect(fromDate).toBe("2026-08-31T23:00:00.000Z"); // Lagos midnight on Sept 1
  });

  it("'custom' resolves an inclusive end date to an exclusive upper bound one day later", () => {
    const { fromDate, toDate } = resolveDateRangePreset("custom", NOW, {
      from: "2026-09-01",
      to: "2026-09-05",
    });
    expect(fromDate).toBe("2026-08-31T23:00:00.000Z");
    expect(toDate).toBe("2026-09-05T23:00:00.000Z"); // start of Sept 6 in Lagos
  });

  it("'custom' with only a from date leaves the range open-ended", () => {
    const { fromDate, toDate } = resolveDateRangePreset("custom", NOW, { from: "2026-09-01" });
    expect(fromDate).toBe("2026-08-31T23:00:00.000Z");
    expect(toDate).toBeNull();
  });

  it("'custom' with no dates at all resolves to an unbounded (all-time) range", () => {
    expect(resolveDateRangePreset("custom", NOW, {})).toEqual({ fromDate: null, toDate: null });
  });
});
