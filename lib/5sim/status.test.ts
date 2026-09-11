import { describe, expect, it } from "vitest";
import { extractOtpCode, mapFiveSimOrderToStatus } from "./status";

describe("mapFiveSimOrderToStatus", () => {
  it("maps a non-empty sms array to sms_received regardless of status", () => {
    expect(mapFiveSimOrderToStatus({ status: "RECEIVED", sms: [{ text: "123456" }] })).toBe(
      "sms_received",
    );
    expect(mapFiveSimOrderToStatus({ status: "PENDING", sms: [{ text: "123456" }] })).toBe(
      "sms_received",
    );
  });

  it("maps RECEIVED with an empty sms array to pending (allocation succeeded, no code yet)", () => {
    expect(mapFiveSimOrderToStatus({ status: "RECEIVED", sms: [] })).toBe("pending");
  });

  it("maps PENDING with no sms to pending", () => {
    expect(mapFiveSimOrderToStatus({ status: "PENDING", sms: null })).toBe("pending");
  });

  it("maps CANCELED to cancelled_refunded", () => {
    expect(mapFiveSimOrderToStatus({ status: "CANCELED", sms: [] })).toBe("cancelled_refunded");
  });

  it("maps TIMEOUT to expired_refunded", () => {
    expect(mapFiveSimOrderToStatus({ status: "TIMEOUT", sms: null })).toBe("expired_refunded");
  });

  it("maps BANNED to banned", () => {
    expect(mapFiveSimOrderToStatus({ status: "BANNED", sms: [] })).toBe("banned");
  });

  it("falls back to pending for an unrecognized status string", () => {
    expect(mapFiveSimOrderToStatus({ status: "SOMETHING_NEW", sms: null })).toBe("pending");
  });
});

describe("extractOtpCode", () => {
  it("returns null for no messages", () => {
    expect(extractOtpCode(null)).toBeNull();
    expect(extractOtpCode([])).toBeNull();
  });

  it("prefers a `code` field when present", () => {
    expect(extractOtpCode([{ code: "654321", text: "Your code is 654321" }])).toBe("654321");
  });

  it("falls back to `text` when there's no code field", () => {
    expect(extractOtpCode([{ text: "Your code is 654321" }])).toBe("Your code is 654321");
  });

  it("uses the most recent (last) message when there are several", () => {
    expect(extractOtpCode([{ code: "111111" }, { code: "222222" }])).toBe("222222");
  });
});
