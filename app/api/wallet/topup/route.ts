import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { initializeTransaction } from "@/lib/paystack/client";
import { isValidTopupAmount, MIN_TOPUP_KOBO } from "@/lib/paystack/validate-topup-amount";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const amountKobo = (body as { amountKobo?: unknown } | null)?.amountKobo;
  if (!isValidTopupAmount(amountKobo)) {
    return NextResponse.json(
      { error: `Minimum top-up is ₦${MIN_TOPUP_KOBO / 100}` },
      { status: 400 },
    );
  }

  const reference = `topup_${randomUUID()}`;
  const origin = new URL(request.url).origin;

  try {
    const { data } = await initializeTransaction({
      email: user.email!,
      amountKobo,
      reference,
      callbackUrl: `${origin}/dashboard/wallet?reference=${reference}`,
      metadata: { user_id: user.id },
    });

    return NextResponse.json({ authorizationUrl: data.authorization_url });
  } catch (error) {
    console.error("Paystack initialize failed:", error);
    return NextResponse.json({ error: "Failed to start payment" }, { status: 502 });
  }
}
