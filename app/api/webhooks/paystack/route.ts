import { NextResponse } from "next/server";
import { verifyPaystackSignature } from "@/lib/paystack/verify-signature";
import { recordWalletTransaction } from "@/lib/wallet/ledger";
import { maybeGrantFirstTopupMatch } from "@/lib/wallet/first-topup-promo";
import { createAdminClient } from "@/lib/supabase/admin";

interface PaystackWebhookPayload {
  event: string;
  data: {
    reference: string;
    amount: number;
    status: string;
    metadata?: { user_id?: string };
  };
}

// Verified against SECURITY.md's "Payments (Paystack)" section: signature
// checked before anything else, idempotent on Paystack's reference, wallet
// only ever credited here — never from the client-side redirect.
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-paystack-signature");

  if (!verifyPaystackSignature(rawBody, signature, process.env.PAYSTACK_SECRET_KEY!)) {
    console.error("Paystack webhook: signature verification failed");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: PaystackWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.error("Paystack webhook: invalid JSON body");
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (payload.event !== "charge.success") {
    // Not an event we act on (e.g. charge.failed) — acknowledge so
    // Paystack doesn't keep retrying, but do nothing.
    return NextResponse.json({ received: true });
  }

  const userId = payload.data.metadata?.user_id;
  if (!userId || payload.data.status !== "success") {
    console.error(
      "Paystack webhook: charge.success event missing user_id metadata or non-success status",
      payload.data,
    );
    return NextResponse.json({ error: "Unprocessable event" }, { status: 422 });
  }

  const supabase = createAdminClient();
  try {
    await recordWalletTransaction(supabase, {
      userId,
      type: "topup",
      amountKobo: payload.data.amount,
      reference: payload.data.reference,
      metadata: { paystack_event: payload.event },
    });

    // Signup growth incentive: ₦500 match on a user's first real top-up
    // only. Called unconditionally (not just when the top-up above was
    // newly inserted) because maybeGrantFirstTopupMatch is itself
    // idempotent — that also means a retried webhook, or a webhook that
    // succeeded here but failed before, self-heals instead of losing the
    // promo silently. See lib/wallet/first-topup-promo.ts for the full
    // reasoning.
    await maybeGrantFirstTopupMatch(supabase, userId);
  } catch (error) {
    console.error("Paystack webhook: failed to record wallet transaction", error);
    return NextResponse.json({ error: "Failed to process" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
