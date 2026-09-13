import { describe, expect, it } from "vitest";
import { parseUsdToNgnRate } from "./client";

describe("parseUsdToNgnRate", () => {
  it("returns the NGN rate on a successful response", () => {
    expect(parseUsdToNgnRate({ result: "success", rates: { NGN: 1366.63, EUR: 0.9 } })).toBe(
      1366.63,
    );
  });

  it("throws when result isn't success", () => {
    expect(() => parseUsdToNgnRate({ result: "error", rates: { NGN: 1366.63 } })).toThrow(
      /non-success result/,
    );
  });

  it("throws when the NGN rate is missing", () => {
    expect(() => parseUsdToNgnRate({ result: "success", rates: { EUR: 0.9 } })).toThrow(
      /invalid NGN rate/,
    );
  });

  it("throws when the NGN rate isn't a number", () => {
    expect(() =>
      parseUsdToNgnRate({ result: "success", rates: { NGN: "1366.63" as unknown as number } }),
    ).toThrow(/invalid NGN rate/);
  });

  it("throws when the NGN rate is zero, negative, or non-finite", () => {
    expect(() => parseUsdToNgnRate({ result: "success", rates: { NGN: 0 } })).toThrow(
      /invalid NGN rate/,
    );
    expect(() => parseUsdToNgnRate({ result: "success", rates: { NGN: -1366.63 } })).toThrow(
      /invalid NGN rate/,
    );
    expect(() => parseUsdToNgnRate({ result: "success", rates: { NGN: Infinity } })).toThrow(
      /invalid NGN rate/,
    );
    expect(() => parseUsdToNgnRate({ result: "success", rates: { NGN: NaN } })).toThrow(
      /invalid NGN rate/,
    );
  });
});
