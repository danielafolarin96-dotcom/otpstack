import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";

export type WalletTransactionType =
  Database["public"]["Enums"]["wallet_transaction_type"];

export interface RecordWalletTransactionInput {
  userId: string;
  type: WalletTransactionType;
  amountKobo: number;
  reference: string;
  orderId?: string | null;
  metadata?: Record<string, Json>;
}

export interface RecordWalletTransactionResult {
  inserted: boolean;
}

const UNIQUE_VIOLATION = "23505";

// The only place server code writes to wallet_transactions. Never touches
// wallets.balance_kobo directly — that's kept in sync by the
// sync_wallet_balance trigger (see the Phase 2 migration) as part of the
// same insert transaction. Pass an admin (service-role) client: RLS grants
// no insert on this table to any other role by design.
export async function recordWalletTransaction(
  supabase: SupabaseClient<Database>,
  input: RecordWalletTransactionInput,
): Promise<RecordWalletTransactionResult> {
  const { error } = await supabase.from("wallet_transactions").insert({
    user_id: input.userId,
    type: input.type,
    amount_kobo: input.amountKobo,
    reference: input.reference,
    order_id: input.orderId ?? null,
    metadata: input.metadata ?? {},
  });

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      // Already recorded — e.g. a retried Paystack webhook hitting the
      // unique constraint on `reference`. Idempotent no-op, not a failure.
      return { inserted: false };
    }
    throw error;
  }

  return { inserted: true };
}
