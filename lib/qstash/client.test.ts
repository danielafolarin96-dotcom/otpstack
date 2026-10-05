import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const publishJSON = vi.fn();
vi.mock("@upstash/qstash", () => ({
  Client: class {
    publishJSON = publishJSON;
  },
}));

describe("scheduleOrderExpiry", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.APP_URL = "https://otpstack.com.ng";
    process.env.CRON_SECRET = "test-cron-secret";
    process.env.QSTASH_TOKEN = "test-qstash-token";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("publishes a one-shot delayed message to our own expire-orders route, scoped to this order", async () => {
    publishJSON.mockResolvedValue({ messageId: "msg_1" });
    const { scheduleOrderExpiry } = await import("./client");

    await scheduleOrderExpiry("order-1", 180);

    expect(publishJSON).toHaveBeenCalledWith({
      url: "https://otpstack.com.ng/api/cron/expire-orders?orderId=order-1",
      headers: { Authorization: "Bearer test-cron-secret" },
      delay: 180,
      body: {},
    });
  });

  it("never throws when QStash publishing fails — the purchase response must not depend on this succeeding", async () => {
    publishJSON.mockRejectedValue(new Error("qstash unreachable"));
    const { scheduleOrderExpiry } = await import("./client");

    await expect(scheduleOrderExpiry("order-1", 180)).resolves.toBeUndefined();
  });

  it("skips scheduling (no throw) when APP_URL isn't set in this environment", async () => {
    delete process.env.APP_URL;
    const { scheduleOrderExpiry } = await import("./client");

    await expect(scheduleOrderExpiry("order-1", 180)).resolves.toBeUndefined();
    expect(publishJSON).not.toHaveBeenCalled();
  });
});
