import { describe, expect, it } from "vitest";
import { computeFeeKobo } from "./fee-schedule";

describe("computeFeeKobo", () => {
  it("applies a percent-only schedule", () => {
    // 1.5% of ₦10,000 (1,000,000 kobo) = ₦150 (15,000 kobo)
    expect(computeFeeKobo(1_000_000, { percentBps: 150, flatKobo: 0, capKobo: null })).toBe(15_000);
  });

  it("adds a flat fee on top of the percent", () => {
    expect(computeFeeKobo(1_000_000, { percentBps: 150, flatKobo: 10_000, capKobo: null })).toBe(25_000);
  });

  it("caps the fee when it would exceed capKobo", () => {
    expect(computeFeeKobo(10_000_000, { percentBps: 150, flatKobo: 0, capKobo: 50_000 })).toBe(50_000);
  });

  it("never returns a negative fee", () => {
    expect(computeFeeKobo(0, { percentBps: 150, flatKobo: 0, capKobo: null })).toBe(0);
  });

  it("rounds to the nearest kobo", () => {
    // 1.5% of 333 kobo = 4.995 -> rounds to 5
    expect(computeFeeKobo(333, { percentBps: 150, flatKobo: 0, capKobo: null })).toBe(5);
  });
});
