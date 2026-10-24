import { describe, expect, it } from "vitest";
import { isValidTopupAmount, MIN_TOPUP_KOBO, topupAmountForShortfall } from "./validate-topup-amount";

describe("topupAmountForShortfall", () => {
  it("never suggests less than the minimum top-up", () => {
    expect(MIN_TOPUP_KOBO).toBe(50_000);
    expect(topupAmountForShortfall(1)).toBe(MIN_TOPUP_KOBO);
    expect(topupAmountForShortfall(39_600)).toBe(MIN_TOPUP_KOBO);
  });

  it("rounds a shortfall above the minimum up to the next ₦50", () => {
    expect(topupAmountForShortfall(120_001)).toBe(125_000); // ₦1,200.01 -> ₦1,250
    expect(topupAmountForShortfall(124_950)).toBe(125_000); // ₦1,249.50 -> ₦1,250
  });

  it("leaves an exact ₦50 multiple as-is", () => {
    expect(topupAmountForShortfall(125_000)).toBe(125_000);
  });
});

describe("isValidTopupAmount", () => {
  it("accepts exactly the ₦500 minimum", () => {
    expect(isValidTopupAmount(MIN_TOPUP_KOBO)).toBe(true);
  });

  it("accepts an amount above the minimum", () => {
    expect(isValidTopupAmount(100_000)).toBe(true);
  });

  it("rejects an amount below the ₦500 minimum", () => {
    expect(isValidTopupAmount(MIN_TOPUP_KOBO - 1)).toBe(false);
  });

  it("rejects a non-integer amount", () => {
    expect(isValidTopupAmount(50_000.5)).toBe(false);
  });

  it("rejects a non-numeric amount", () => {
    expect(isValidTopupAmount("50000")).toBe(false);
    expect(isValidTopupAmount(undefined)).toBe(false);
    expect(isValidTopupAmount(null)).toBe(false);
  });
});
