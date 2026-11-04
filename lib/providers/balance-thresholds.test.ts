import { describe, expect, it } from "vitest";
import { isLowBalance, LOW_BALANCE_THRESHOLD_USD } from "./balance-thresholds";

describe("isLowBalance", () => {
  it("flags a balance below the 5sim threshold", () => {
    expect(isLowBalance("5sim", LOW_BALANCE_THRESHOLD_USD["5sim"] - 0.01)).toBe(true);
  });

  it("flags a balance exactly at the threshold (boundary is inclusive)", () => {
    expect(isLowBalance("5sim", LOW_BALANCE_THRESHOLD_USD["5sim"])).toBe(true);
  });

  it("does not flag a balance above the 5sim threshold", () => {
    expect(isLowBalance("5sim", LOW_BALANCE_THRESHOLD_USD["5sim"] + 0.01)).toBe(false);
  });

  it("flags a balance below the grizzly threshold", () => {
    expect(isLowBalance("grizzly", LOW_BALANCE_THRESHOLD_USD.grizzly - 1)).toBe(true);
  });

  it("does not flag a balance above the grizzly threshold", () => {
    expect(isLowBalance("grizzly", LOW_BALANCE_THRESHOLD_USD.grizzly + 1)).toBe(false);
  });

  it("flags a zero balance", () => {
    expect(isLowBalance("5sim", 0)).toBe(true);
  });
});
