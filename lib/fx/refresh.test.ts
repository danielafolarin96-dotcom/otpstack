import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { fetchUsdToNgnRate } from "./client";
import { refreshFxRate } from "./refresh";

vi.mock("./client", () => ({
  fetchUsdToNgnRate: vi.fn(),
}));

function fakeAdminClient(insertResult: { data: unknown; error: unknown }) {
  const single = vi.fn(() => Promise.resolve(insertResult));
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  const from = vi.fn(() => ({ insert }));
  return { client: { from } as unknown as SupabaseClient<Database>, insert, from };
}

describe("refreshFxRate", () => {
  it("inserts a new USD_NGN row with the fetched rate on success", async () => {
    vi.mocked(fetchUsdToNgnRate).mockResolvedValue(1366.63);
    const row = { id: "row-1", pair: "USD_NGN", rate: 1366.63, source: "open.er-api.com" };
    const { client, insert, from } = fakeAdminClient({ data: row, error: null });

    const result = await refreshFxRate(client);

    expect(from).toHaveBeenCalledWith("fx_rates");
    expect(insert).toHaveBeenCalledWith({ pair: "USD_NGN", rate: 1366.63, source: "open.er-api.com" });
    expect(result).toEqual(row);
  });

  it("throws without inserting anything when the upstream fetch fails", async () => {
    vi.mocked(fetchUsdToNgnRate).mockRejectedValue(new Error("open.er-api.com request failed"));
    const { client, insert } = fakeAdminClient({ data: null, error: null });

    await expect(refreshFxRate(client)).rejects.toThrow(/request failed/);
    expect(insert).not.toHaveBeenCalled();
  });

  it("throws when the insert itself fails", async () => {
    vi.mocked(fetchUsdToNgnRate).mockResolvedValue(1366.63);
    const { client } = fakeAdminClient({ data: null, error: { message: "insert failed" } });

    await expect(refreshFxRate(client)).rejects.toMatchObject({ message: "insert failed" });
  });
});
