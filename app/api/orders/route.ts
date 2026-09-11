import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PurchaseError, purchaseNumber } from "@/lib/orders/purchase";

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

  const { serviceId, countryId } = (body as { serviceId?: unknown; countryId?: unknown }) ?? {};
  if (typeof serviceId !== "string" || typeof countryId !== "string") {
    return NextResponse.json({ error: "serviceId and countryId are required" }, { status: 400 });
  }

  const admin = createAdminClient();

  try {
    const result = await purchaseNumber(admin, { userId: user.id, serviceId, countryId });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof PurchaseError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("Unexpected error in POST /api/orders:", err);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
