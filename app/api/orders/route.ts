import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { PurchaseError, purchaseNumber } from "@/lib/orders/purchase";
import { recordPurchaseFailure, type PurchaseFailureReason } from "@/lib/orders/purchase-failures";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit/check";

const PURCHASE_WINDOW_SECONDS = 60 * 60;
const PURCHASE_MAX_PER_USER = 20;
const PURCHASE_MAX_PER_IP = 40;

// Who/what a failed attempt was for, filled in as the handler learns it —
// null until the user is authenticated (unauthenticated requests aren't
// logged: there's no user to attribute them to).
interface FailureContext {
  admin: SupabaseClient<Database>;
  userId: string;
  serviceId?: unknown;
  countryId?: unknown;
  operator?: unknown;
}

// Every authenticated failure exit goes through here: records a
// purchase_failures row (best-effort — recordPurchaseFailure never throws),
// then returns exactly the response the customer would have got anyway.
async function failureResponse(
  context: FailureContext | null,
  status: number,
  error: string,
  log: { reason: PurchaseFailureReason; message?: string },
  extra: Record<string, unknown> = {},
) {
  if (context) {
    await recordPurchaseFailure(context.admin, {
      userId: context.userId,
      serviceId: context.serviceId,
      countryId: context.countryId,
      operator: context.operator,
      reason: log.reason,
      httpStatus: status,
      message: log.message ?? error,
    });
  }
  return NextResponse.json({ error, ...extra }, { status });
}

// Bug fix (Sept 2026): everything below used to run with only the final
// purchaseNumber() call wrapped in try/catch — the auth check, both
// rate-limit lookups, and body parsing could all throw uncaught (e.g. a
// transient Supabase hiccup on checkRateLimit), which Next.js turns into
// a raw, non-JSON error response instead of the clean JSON error message
// the frontend (BuyableCatalogGrid) expects. The whole handler body is
// now one try/catch so every exit path — success, a known PurchaseError,
// or anything unexpected — returns proper JSON, never an unhandled crash.
export async function POST(request: Request) {
  let context: FailureContext | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const admin = createAdminClient();
    context = { admin, userId: user.id };
    const [allowedForUser, allowedForIp] = await Promise.all([
      checkRateLimit(admin, {
        key: `purchase:user:${user.id}`,
        windowSeconds: PURCHASE_WINDOW_SECONDS,
        max: PURCHASE_MAX_PER_USER,
      }),
      checkRateLimit(admin, {
        key: `purchase:ip:${getClientIp(request)}`,
        windowSeconds: PURCHASE_WINDOW_SECONDS,
        max: PURCHASE_MAX_PER_IP,
      }),
    ]);
    if (!allowedForUser || !allowedForIp) {
      return failureResponse(context, 429, "Too many purchase attempts. Try again later.", {
        reason: "rate_limited",
      });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return failureResponse(context, 400, "Invalid JSON body", { reason: "other" });
    }

    const { serviceId, countryId, operator } =
      (body as { serviceId?: unknown; countryId?: unknown; operator?: unknown }) ?? {};
    context = { ...context, serviceId, countryId, operator };
    if (typeof serviceId !== "string" || typeof countryId !== "string" || typeof operator !== "string") {
      return failureResponse(context, 400, "serviceId, countryId, and operator are required", {
        reason: "other",
      });
    }

    const result = await purchaseNumber(admin, { userId: user.id, serviceId, countryId, operator });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof PurchaseError) {
      return failureResponse(
        context,
        err.status,
        err.message,
        { reason: err.reason, message: err.internalMessage },
        err.shortfallKobo !== undefined ? { shortfallKobo: err.shortfallKobo } : {},
      );
    }
    console.error("Unexpected error in POST /api/orders:", err);
    return failureResponse(context, 500, "Something went wrong", {
      reason: "other",
      // Supabase errors are plain objects with a `message`, not Error instances.
      message: String((err as { message?: unknown })?.message ?? err),
    });
  }
}
