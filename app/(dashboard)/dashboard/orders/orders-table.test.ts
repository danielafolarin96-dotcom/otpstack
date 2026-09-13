import { describe, expect, it } from "vitest";
import { isCodeRevealable } from "./orders-table";

describe("isCodeRevealable", () => {
  it("reveals the code for a delivered order", () => {
    expect(isCodeRevealable({ status: "sms_received", otp_code: "654321" })).toBe(true);
  });

  it("does not reveal a code for a pending order, even if otp_code were somehow already set", () => {
    expect(isCodeRevealable({ status: "pending", otp_code: "654321" })).toBe(false);
  });

  it("does not reveal a code for sms_received with no otp_code yet (status/code race)", () => {
    expect(isCodeRevealable({ status: "sms_received", otp_code: null })).toBe(false);
  });

  it("does not reveal a code for expired, cancelled, or banned orders", () => {
    expect(isCodeRevealable({ status: "expired_refunded", otp_code: null })).toBe(false);
    expect(isCodeRevealable({ status: "cancelled_refunded", otp_code: null })).toBe(false);
    expect(isCodeRevealable({ status: "banned", otp_code: null })).toBe(false);
  });
});
