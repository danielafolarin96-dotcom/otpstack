import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { updateProfile } from "@/lib/settings/update-profile";

// Matches the signup form's own username pattern (app/(auth)/signup/signup-form.tsx)
// — validated here too since a client-side `pattern` attribute is only a UI
// hint, never enforced against a direct request to this route.
const USERNAME_PATTERN = /^[a-zA-Z0-9_]+$/;

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

  const { fullName, username } = (body as { fullName?: unknown; username?: unknown }) ?? {};
  if (typeof fullName !== "string" || fullName.trim().length === 0) {
    return NextResponse.json({ error: "Full name is required" }, { status: 400 });
  }
  if (typeof username !== "string" || !USERNAME_PATTERN.test(username)) {
    return NextResponse.json(
      { error: "Username must contain only letters, numbers, and underscores" },
      { status: 400 },
    );
  }

  try {
    const result = await updateProfile(supabase, user.id, { fullName: fullName.trim(), username });
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to update profile:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
