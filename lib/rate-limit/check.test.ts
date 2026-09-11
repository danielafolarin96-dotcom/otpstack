import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { checkRateLimit, getClientIp } from "./check";

function fakeSupabase(rpcResult: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  return { client: { rpc } as unknown as SupabaseClient<Database>, rpc };
}

describe("checkRateLimit", () => {
  it("calls check_rate_limit with the given key/window/max and returns its result", async () => {
    const { client, rpc } = fakeSupabase({ data: true, error: null });

    const result = await checkRateLimit(client, {
      key: "signup:ip:1.2.3.4",
      windowSeconds: 3600,
      max: 5,
    });

    expect(result).toBe(true);
    expect(rpc).toHaveBeenCalledWith("check_rate_limit", {
      p_key: "signup:ip:1.2.3.4",
      p_window_seconds: 3600,
      p_max_count: 5,
    });
  });

  it("returns false once the limit is exhausted", async () => {
    const { client } = fakeSupabase({ data: false, error: null });

    const result = await checkRateLimit(client, {
      key: "signup:ip:1.2.3.4",
      windowSeconds: 3600,
      max: 5,
    });

    expect(result).toBe(false);
  });

  it("propagates a database error instead of silently allowing the request", async () => {
    const { client } = fakeSupabase({ data: null, error: { message: "db down" } });

    await expect(
      checkRateLimit(client, { key: "k", windowSeconds: 60, max: 1 }),
    ).rejects.toMatchObject({ message: "db down" });
  });
});

describe("getClientIp", () => {
  it("takes the first entry of x-forwarded-for", () => {
    const request = new Request("http://localhost", {
      headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3" },
    });

    expect(getClientIp(request)).toBe("1.1.1.1");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const request = new Request("http://localhost", {
      headers: { "x-real-ip": "9.9.9.9" },
    });

    expect(getClientIp(request)).toBe("9.9.9.9");
  });

  it("falls back to \"unknown\" when neither header is present", () => {
    const request = new Request("http://localhost");

    expect(getClientIp(request)).toBe("unknown");
  });
});
