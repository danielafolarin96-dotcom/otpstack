import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { updatePassword } from "@/lib/settings/update-password";

const MIN_PASSWORD_LENGTH = 6; // matches the signup form's own minLength

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

  const { password } = (body as { password?: unknown }) ?? {};
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` },
      { status: 400 },
    );
  }

  try {
    const result = await updatePassword(supabase, password);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to update password:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
