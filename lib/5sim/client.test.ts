import { describe, expect, it } from "vitest";
import { selectBestOperator } from "./client";

describe("selectBestOperator", () => {
  it("picks the reliable operator over a cheaper one below the delivery-rate floor", () => {
    // Real diagnostic scenario (Sept 2026): a TikTok/USA cheapest-cost pick
    // landed on a 45%-rate operator and never delivered a code, while an
    // 80%-rate operator that cost slightly more worked cleanly.
    const result = selectBestOperator({
      cheapButUnreliable: { cost: 0.18, count: 100, rate: 45 },
      pricierButReliable: { cost: 0.2, count: 100, rate: 80 },
    });

    expect(result?.operator).toBe("pricierButReliable");
  });

  it("picks the cheapest among operators that all clear the reliability floor", () => {
    const result = selectBestOperator({
      reliableExpensive: { cost: 0.3, count: 50, rate: 90 },
      reliableCheaper: { cost: 0.2, count: 50, rate: 75 },
    });

    expect(result?.operator).toBe("reliableCheaper");
  });

  it("excludes an operator right below the 70 floor, includes one right at it", () => {
    const result = selectBestOperator({
      justBelowFloor: { cost: 0.1, count: 50, rate: 69 },
      atFloor: { cost: 0.2, count: 50, rate: 70 },
    });

    expect(result?.operator).toBe("atFloor");
  });

  it("excludes out-of-stock operators even when they're cheapest and reliable", () => {
    const result = selectBestOperator({
      outOfStock: { cost: 0.1, count: 0, rate: 95 },
      inStock: { cost: 0.25, count: 10, rate: 70 },
    });

    expect(result?.operator).toBe("inStock");
  });

  it("treats a missing rate as neutral, not disqualifying", () => {
    // Observed live: 5sim omits `rate` entirely for some operators
    // regardless of stock level — that's "no data," not "unreliable."
    const result = selectBestOperator({
      noRateData: { cost: 0.15, count: 100 },
      confirmedUnreliable: { cost: 0.1, count: 100, rate: 20 },
    });

    expect(result?.operator).toBe("noRateData");
  });

  it("falls back to the cheapest in-stock operator when none clear the floor", () => {
    const result = selectBestOperator({
      worse: { cost: 0.3, count: 10, rate: 10 },
      leastBad: { cost: 0.2, count: 10, rate: 30 },
    });

    expect(result?.operator).toBe("leastBad");
  });

  it("returns null when nothing is in stock", () => {
    const result = selectBestOperator({
      onlyOperator: { cost: 0.1, count: 0, rate: 90 },
    });

    expect(result).toBeNull();
  });
});
