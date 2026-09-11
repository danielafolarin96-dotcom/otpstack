import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit/check";

// Per SECURITY.md: no email verification gate at signup, "compensated by
// rate limiting on signup/top-up endpoints". Signup has no user id yet, so
// this is IP-only. Routed through our own API (rather than calling
// supabase.auth.signUp() straight from the client, as before) so this
// check actually runs before an account gets created — a client-side-only
// check couldn't stop a request that skips the browser entirely.
//
// This can't fully close off signup abuse: the Supabase anon key is
// public, so a determined caller can still hit Supabase Auth's REST
// endpoint directly, bypassing this route. Supabase's own project-level
// auth rate limits are the backstop for that; this route is the
// app-specific layer on top (tighter limit, our own key scheme).
const SIGNUP_WINDOW_SECONDS = 60 * 60;
const SIGNUP_MAX_PER_IP = 5;

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const admin = createAdminClient();
  const allowed = await checkRateLimit(admin, {
    key: `signup:ip:${ip}`,
    windowSeconds: SIGNUP_WINDOW_SECONDS,
    max: SIGNUP_MAX_PER_IP,
  });
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many signup attempts from this network. Try again later." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { fullName, email, username, password } =
    (body as { fullName?: unknown; email?: unknown; username?: unknown; password?: unknown }) ?? {};
  if (
    typeof fullName !== "string" ||
    typeof email !== "string" ||
    typeof username !== "string" ||
    typeof password !== "string"
  ) {
    return NextResponse.json(
      { error: "fullName, email, username, and password are required" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName, username },
    },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ hasSession: Boolean(data.session) });
}
