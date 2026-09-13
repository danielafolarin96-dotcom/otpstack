import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { refreshFxRate } from "@/lib/fx/refresh";

vi.mock("@/lib/fx/refresh", () => ({
  refreshFxRate: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({}),
}));

function makeRequest(authHeader?: string) {
  return new Request("http://localhost:3000/api/cron/refresh-fx-rate", {
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = "test-secret";
});

afterEach(() => {
  process.env.CRON_SECRET = ORIGINAL_CRON_SECRET;
});

describe("GET /api/cron/refresh-fx-rate", () => {
  it("rejects with 401 when the bearer secret doesn't match, without refreshing anything", async () => {
    const response = await GET(makeRequest("Bearer wrong-secret"));

    expect(response.status).toBe(401);
    expect(refreshFxRate).not.toHaveBeenCalled();
  });

  it("rejects with 401 when CRON_SECRET isn't configured, even with a header present", async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(makeRequest("Bearer test-secret"));

    expect(response.status).toBe(401);
    expect(refreshFxRate).not.toHaveBeenCalled();
  });

  it("refreshes the fx rate and returns the inserted row on success", async () => {
    const row = { id: "row-1", pair: "USD_NGN", rate: 1366.63, source: "open.er-api.com" };
    vi.mocked(refreshFxRate).mockResolvedValue(row as never);

    const response = await GET(makeRequest("Bearer test-secret"));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.inserted).toEqual(row);
    expect(refreshFxRate).toHaveBeenCalledWith(expect.anything());
  });

  it("returns 500 without throwing when refreshFxRate fails", async () => {
    vi.mocked(refreshFxRate).mockRejectedValue(new Error("open.er-api.com request failed"));

    const response = await GET(makeRequest("Bearer test-secret"));
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.error).toBeTruthy();
  });
});
