import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";

export type FinanceEventType = Database["public"]["Enums"]["finance_event_type"];

export interface RecordFinanceEventInput {
  orderId: string;
  userId: string;
  eventType: FinanceEventType;
  serviceId: string;
  countryCode: string;
  provider: string;
  revenueKobo: number;
  providerCostKobo: number;
  paymentFeeKobo: number;
  feeScheduleId?: string | null;
  metadata?: Record<string, Json>;
}

export interface RecordFinanceEventResult {
  inserted: boolean;
}

const UNIQUE_VIOLATION = "23505";

// The only place server code writes to finance_events — mirrors
// lib/wallet/ledger.ts's recordWalletTransaction exactly: append-only,
// never updates a row. Called from the same three refund code paths that
// already call recordWalletTransaction (lib/orders/expire-and-refund.ts,
// lib/orders/manual-refund.ts, app/api/orders/[id]/cancel/route.ts) —
// revenue_recognized itself is written inside create_order_and_debit_wallet
// (the Postgres function), not here, so it's atomic with the order+wallet
// insert.
//
// Idempotency: each refund code path only ever reaches this after winning a
// conditional UPDATE that claims the order (status still 'pending' or
// 'sms_received' at the moment it runs) — that claim can only be won once
// per order, so this can't naturally double-fire. The unique index on
// (order_id, event_type) is a defensive backstop, same role as
// wallet_transactions.reference's uniqueness.
export async function recordFinanceEvent(
  supabase: SupabaseClient<Database>,
  input: RecordFinanceEventInput,
): Promise<RecordFinanceEventResult> {
  const { error } = await supabase.from("finance_events").insert({
    order_id: input.orderId,
    user_id: input.userId,
    event_type: input.eventType,
    service_id: input.serviceId,
    country_code: input.countryCode,
    provider: input.provider,
    revenue_kobo: input.revenueKobo,
    provider_cost_kobo: input.providerCostKobo,
    payment_fee_kobo: input.paymentFeeKobo,
    fee_schedule_id: input.feeScheduleId ?? null,
    metadata: input.metadata ?? {},
  });

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      // Already recorded for this order+event_type — idempotent no-op.
      return { inserted: false };
    }
    throw error;
  }

  return { inserted: true };
}
