import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeOperatorPrices, type PricedOperatorOption } from "@/lib/pricing/catalog";

function serialize(option: PricedOperatorOption) {
  return {
    operator: option.operator,
    priceKobo: option.price.priceKobo,
    ratePct: option.ratePct,
  };
}

// Backs the buy-flow operator picker (operator-picker-modal.tsx) — every
// real, priced option for one (service, country) pair, not just the
// catalog grid's single representative price. Auth-gated: reached only
// from the authenticated "Get a number" page, and operator-level cost/rate
// data is more operationally specific than the single blended price the
// public catalog grid already shows, so it stays behind login rather than
// matching that page's unauthenticated read.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const serviceId = searchParams.get("serviceId");
  const countryId = searchParams.get("countryId");
  if (!serviceId || !countryId) {
    return NextResponse.json({ error: "serviceId and countryId are required" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const admin = createAdminClient();

  try {
    const result = await computeOperatorPrices(admin, serviceId, countryId);
    if (!result) {
      // Mirrors computeCatalogPrices' price:null convention — covers both
      // "service/country not found" and "nothing clears the floor right
      // now" with the same shape, since the modal handles both the same
      // way (show "not available", let the customer pick something else).
      return NextResponse.json({ recommended: null, options: [] });
    }

    return NextResponse.json({
      recommended: serialize(result.recommended),
      options: result.options.map(serialize),
    });
  } catch (err) {
    console.error(`Failed to fetch operator prices for service=${serviceId} country=${countryId}:`, err);
    return NextResponse.json(
      { error: "Couldn't reach the number provider — try again shortly." },
      { status: 503 },
    );
  }
}
