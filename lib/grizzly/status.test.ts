import { describe, expect, it } from "vitest";
import { parseGetStatus, parseGetStatusV2, smsArrivedAtOnOurClock } from "./status";

describe("parseGetStatus", () => {
  it.each([
    ["STATUS_WAIT_CODE", { state: "waiting" }],
    ["STATUS_WAIT_RESEND", { state: "waiting" }],
    ["STATUS_CANCEL", { state: "cancelled" }],
    ["STATUS_OK:852508", { state: "received", code: "852508", text: null, smsDateTime: null }],
    // A code was already delivered; Grizzly is waiting for a follow-up one.
    ["STATUS_WAIT_RETRY:1234", { state: "received", code: "1234", text: null, smsDateTime: null }],
  ])("%s", (body, expected) => {
    expect(parseGetStatus(body)).toEqual(expected);
  });

  it("treats STATUS_OK / STATUS_WAIT_RETRY with no code as unknown, never as received", () => {
    expect(parseGetStatus("STATUS_OK:")).toBeNull();
    expect(parseGetStatus("STATUS_OK:   ")).toBeNull();
    expect(parseGetStatus("STATUS_WAIT_RETRY:")).toBeNull();
  });

  it("returns null for anything unrecognised, e.g. an error token", () => {
    expect(parseGetStatus("NO_ACTIVATION")).toBeNull();
    expect(parseGetStatus("")).toBeNull();
  });
});

describe("parseGetStatusV2", () => {
  it("reads the documented sms object", () => {
    expect(
      parseGetStatusV2(JSON.stringify({ verificationType: 2, sms: { dateTime: "2026-02-26 12:05:55", code: "852508", text: "852508" } })),
    ).toEqual({ code: "852508", text: "852508", dateTime: "2026-02-26 12:05:55" });
  });

  it("takes the newest entry when sms is an array", () => {
    expect(parseGetStatusV2(JSON.stringify({ sms: [{ code: "1" }, { code: "2", dateTime: "2026-01-01 00:00:01" }] }))).toEqual({
      code: "2",
      text: null,
      dateTime: "2026-01-01 00:00:01",
    });
  });

  it("returns null when there's no SMS or the body isn't JSON", () => {
    expect(parseGetStatusV2(JSON.stringify({ verificationType: 2 }))).toBeNull();
    expect(parseGetStatusV2("STATUS_WAIT_CODE")).toBeNull();
  });
});

describe("smsArrivedAtOnOurClock", () => {
  const order = { created_at: "2026-10-29T10:00:01.000Z", upstream_activation_time: "2026-10-29 13:00:00" };

  it("measures arrival relative to Grizzly's own activationTime, whatever its timezone", () => {
    // Grizzly's clock reads 3h ahead of UTC here; the SMS landed 4m30s after activation.
    expect(smsArrivedAtOnOurClock(order, "2026-10-29 13:04:30")).toBe(new Date("2026-10-29T10:04:31.000Z").getTime());
  });

  it("is null when a timestamp is missing or unparseable — not proven on time", () => {
    expect(smsArrivedAtOnOurClock(order, null)).toBeNull();
    expect(smsArrivedAtOnOurClock({ ...order, upstream_activation_time: null }, "2026-10-29 13:04:30")).toBeNull();
    expect(smsArrivedAtOnOurClock(order, "yesterday")).toBeNull();
  });
});
