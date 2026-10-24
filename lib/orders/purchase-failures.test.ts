import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PURCHASE_FAILURE_REASONS, recordPurchaseFailure, sanitizeFailureMessage } from "./purchase-failures";

const SERVICE_ID = "11111111-1111-4111-8111-111111111111";
const COUNTRY_ID = "22222222-2222-4222-8222-222222222222";

function fakeAdminClient(options: { insertError?: unknown; insertThrows?: boolean } = {}) {
  const insert = vi.fn(() => {
    if (options.insertThrows) throw new Error("network down");
    return Promise.resolve({ error: options.insertError ?? null });
  });
  const countriesBuilder = {
    select: () => countriesBuilder,
    eq: () => countriesBuilder,
    maybeSingle: () => Promise.resolve({ data: { fivesim_country_code: "nigeria" }, error: null }),
  };
  const from = vi.fn((table: string) => (table === "countries" ? countriesBuilder : { insert }));
  return { client: { from } as unknown as SupabaseClient<Database>, insert, from };
}

const FAILURE = {
  userId: "user-1",
  serviceId: SERVICE_ID,
  countryId: COUNTRY_ID,
  operator: "virtual2",
  reason: "insufficient_balance" as const,
  httpStatus: 402,
  message: "Insufficient wallet balance",
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("recordPurchaseFailure", () => {
  it("inserts one row with the country code resolved from countryId", async () => {
    const { client, insert } = fakeAdminClient();

    await recordPurchaseFailure(client, FAILURE);

    expect(insert).toHaveBeenCalledWith({
      user_id: "user-1",
      service_id: SERVICE_ID,
      country_code: "nigeria",
      operator: "virtual2",
      reason: "insufficient_balance",
      http_status: 402,
      message: "Insufficient wallet balance",
    });
  });

  it("stores null for non-UUID ids and non-string operators instead of failing the insert", async () => {
    const { client, insert, from } = fakeAdminClient();

    await recordPurchaseFailure(client, { ...FAILURE, serviceId: "not-a-uuid", countryId: 42, operator: { x: 1 } });

    expect(from).not.toHaveBeenCalledWith("countries");
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ service_id: null, country_code: null, operator: null }),
    );
  });

  it("never throws when the insert returns an error", async () => {
    const { client } = fakeAdminClient({ insertError: { message: "relation does not exist" } });
    await expect(recordPurchaseFailure(client, FAILURE)).resolves.toBeUndefined();
  });

  it("never throws when the client itself throws", async () => {
    const { client } = fakeAdminClient({ insertThrows: true });
    await expect(recordPurchaseFailure(client, FAILURE)).resolves.toBeUndefined();
  });
});

describe("sanitizeFailureMessage", () => {
  it("caps the message at 300 characters", () => {
    expect(sanitizeFailureMessage("x".repeat(500))).toHaveLength(300);
  });

  it("redacts bearer tokens, JWTs, and Paystack keys", () => {
    const raw =
      "failed with Bearer abc123.def and eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.sig and sk_live_abcdef123";
    const cleaned = sanitizeFailureMessage(raw);
    expect(cleaned).not.toMatch(/abc123|eyJhbGci|sk_live_abcdef/);
    expect(cleaned).toContain("[redacted]");
  });

  it("collapses whitespace and leaves ordinary messages alone", () => {
    expect(sanitizeFailureMessage("  5sim failed:\n 400   bad operator ")).toBe("5sim failed: 400 bad operator");
  });
});

describe("PURCHASE_FAILURE_REASONS", () => {
  it("matches the reason check constraint in the create_purchase_failures migration", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/20261022130000_create_purchase_failures.sql"),
      "utf8",
    );
    const constraint = sql.match(/reason in \(([^)]*)\)/)?.[1] ?? "";
    const inMigration = [...constraint.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(inMigration).toEqual([...PURCHASE_FAILURE_REASONS]);
  });
});
