import { afterEach, describe, expect, it } from "vitest";
import { FiveSimError } from "@/lib/5sim/client";
import { GrizzlyError } from "@/lib/grizzly/client";
import { describeUpstreamCancelError, firstSmsArrivedAt } from "./upstream-sms";

describe("firstSmsArrivedAt", () => {
  it("returns the earliest arrival across entries", () => {
    expect(
      firstSmsArrivedAt([{ created_at: "2026-10-12T02:09:00Z" }, { created_at: "2026-10-12T02:08:31Z" }]),
    ).toBe(new Date("2026-10-12T02:08:31Z").getTime());
  });

  it("falls back to `date` when created_at is absent", () => {
    expect(firstSmsArrivedAt([{ date: "2026-10-12T02:08:31Z" }])).toBe(new Date("2026-10-12T02:08:31Z").getTime());
  });

  it("returns null when no entry has a parseable timestamp", () => {
    expect(firstSmsArrivedAt([{ code: "1" }, { created_at: "not a date" }])).toBeNull();
  });
});

describe("describeUpstreamCancelError", () => {
  const originalKey = process.env.FIVESIM_API_KEY;
  const originalGrizzlyKey = process.env.GRIZZLY_API_KEY;
  afterEach(() => {
    process.env.FIVESIM_API_KEY = originalKey;
    process.env.GRIZZLY_API_KEY = originalGrizzlyKey;
  });

  it("uses the FiveSimError message (path, status, body)", () => {
    expect(describeUpstreamCancelError(new FiveSimError("/user/cancel/999", 400, "order has sms"))).toBe(
      "5sim /user/cancel/999 failed: 400 order has sms",
    );
  });

  it("truncates to 500 chars", () => {
    const message = describeUpstreamCancelError(new Error("x".repeat(2000)));
    expect(message).toHaveLength(500);
  });

  it("scrubs the API key if an error ever echoes it back", () => {
    process.env.FIVESIM_API_KEY = "test-secret-key";
    expect(describeUpstreamCancelError(new Error("bad token test-secret-key here"))).toBe("bad token [redacted] here");
  });

  it("uses the GrizzlyError message and scrubs the Grizzly key too", () => {
    process.env.GRIZZLY_API_KEY = "grizzly-secret";
    expect(describeUpstreamCancelError(new GrizzlyError("setStatus", 200, "EARLY_CANCEL_DENIED grizzly-secret"))).toBe(
      "grizzly setStatus failed: 200 EARLY_CANCEL_DENIED [redacted]",
    );
  });

  it("handles non-Error throwables", () => {
    expect(describeUpstreamCancelError("plain string")).toBe("plain string");
  });
});
