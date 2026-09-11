import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { initializeTransaction } from "@/lib/paystack/client";
import { isValidTopupAmount, MIN_TOPUP_KOBO } from "@/lib/paystack/validate-topup-amount";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit/check";

const TOPUP_WINDOW_SECONDS = 60 * 60;
const TOPUP_MAX_PER_USER = 10;
const TOPUP_MAX_PER_IP = 20;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // RLS scopes this to the caller's own row — no admin client needed.
  // Only blocks *new* top-up attempts; doesn't touch anything already in
  // flight.
  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("is_frozen")
    .eq("id", user.id)
    .single();
  if (profileError) {
    console.error("Failed to check account status before top-up:", profileError);
    return NextResponse.json({ error: "Failed to verify account status" }, { status: 500 });
  }
  if (profile.is_frozen) {
    return NextResponse.json(
      { error: "Your account is frozen — contact support" },
      { status: 403 },
    );
  }

  const admin = createAdminClient();
  const [allowedForUser, allowedForIp] = await Promise.all([
    checkRateLimit(admin, {
      key: `topup:user:${user.id}`,
      windowSeconds: TOPUP_WINDOW_SECONDS,
      max: TOPUP_MAX_PER_USER,
    }),
    checkRateLimit(admin, {
      key: `topup:ip:${getClientIp(request)}`,
      windowSeconds: TOPUP_WINDOW_SECONDS,
      max: TOPUP_MAX_PER_IP,
    }),
  ]);
  if (!allowedForUser || !allowedForIp) {
    return NextResponse.json(
      { error: "Too many top-up attempts. Try again later." },
      { status: 429 },
    );
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
