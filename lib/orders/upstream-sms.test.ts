import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkOrder, FiveSimError, type FiveSimOrder } from "@/lib/5sim/client";
import { describeUpstreamCancelError, fetchUpstreamSms, firstSmsArrivedAt } from "./upstream-sms";

vi.mock("@/lib/5sim/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/5sim/client")>();
  return { FiveSimError: actual.FiveSimError, checkOrder: vi.fn() };
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchUpstreamSms", () => {
  it("returns the order's sms entries", async () => {
    const sms = [{ created_at: "2026-10-12T02:08:31Z", code: "123456" }];
    vi.mocked(checkOrder).mockResolvedValue({ sms } as FiveSimOrder);
    await expect(fetchUpstreamSms("999")).resolves.toEqual(sms);
  });

  it("normalizes a null sms field to an empty array", async () => {
    vi.mocked(checkOrder).mockResolvedValue({ sms: null } as FiveSimOrder);
    await expect(fetchUpstreamSms("999")).resolves.toEqual([]);
  });

  it("returns null (caller falls back to refunding) when the check fails", async () => {
    vi.mocked(checkOrder).mockRejectedValue(new Error("5sim unreachable"));
    await expect(fetchUpstreamSms("999")).resolves.toBeNull();
  });
});

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
  afterEach(() => {
    process.env.FIVESIM_API_KEY = originalKey;
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

  it("handles non-Error throwables", () => {
    expect(describeUpstreamCancelError("plain string")).toBe("plain string");
  });
});
