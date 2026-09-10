import { describe, expect, it } from "vitest";
import { isValidTopupAmount, MIN_TOPUP_KOBO } from "./validate-topup-amount";

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
