import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { recordFinanceEvent } from "./ledger";

function fakeSupabase(insertResult: { error: { code?: string; message?: string } | null }) {
  const insert = vi.fn().mockResolvedValue(insertResult);
  const from = vi.fn().mockReturnValue({ insert });
  return { client: { from } as unknown as SupabaseClient<Database>, insert, from };
}

const baseInput = {
  orderId: "order-1",
  userId: "user-1",
  eventType: "revenue_recognized" as const,
  serviceId: "service-1",
  countryCode: "usa",
  provider: "5sim",
  revenueKobo: 100_000,
  providerCostKobo: 20_000,
  paymentFeeKobo: 1_500,
};

describe("recordFinanceEvent", () => {
  it("inserts the ledger row and reports inserted:true on success", async () => {
    const { client, insert, from } = fakeSupabase({ error: null });

    const result = await recordFinanceEvent(client, baseInput);

    expect(result).toEqual({ inserted: true });
    expect(from).toHaveBeenCalledWith("finance_events");
    expect(insert).toHaveBeenCalledWith({
      order_id: "order-1",
      user_id: "user-1",
      event_type: "revenue_recognized",
      service_id: "service-1",
      country_code: "usa",
      provider: "5sim",
      revenue_kobo: 100_000,
      provider_cost_kobo: 20_000,
      payment_fee_kobo: 1_500,
      fee_schedule_id: null,
      metadata: {},
    });
  });

  it("treats a duplicate (order_id, event_type) as an idempotent no-op", async () => {
    const { client } = fakeSupabase({ error: { code: "23505", message: "duplicate key" } });

    const result = await recordFinanceEvent(client, baseInput);

    expect(result).toEqual({ inserted: false });
  });

  it("rethrows any other database error instead of silently swallowing it", async () => {
    const { client } = fakeSupabase({ error: { code: "23503", message: "fk violation" } });

    await expect(recordFinanceEvent(client, baseInput)).rejects.toMatchObject({
      code: "23503",
    });
  });
});
