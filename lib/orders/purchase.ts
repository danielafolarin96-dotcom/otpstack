import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { buyActivation, cancelOrder, getProductPrices } from "@/lib/5sim/client";
import { fetchAllPricingRules, fetchLatestFxRate, priceFromRulesAndRate } from "@/lib/pricing/engine";

const ORDER_TTL_MINUTES = 10;
const UPSTREAM_CURRENCY_PAIR = "USD_NGN"; // 5sim prices observed in USD — see lib/5sim/client.ts

export class PurchaseError extends Error {
  constructor(
    message: string,
    public status: number = 400,
  ) {
    super(message);
  }
}

export interface PurchaseResult {
  order: {
    id: string;
    phoneNumber: string;
    expiresAt: string;
  };
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  const withMessage = err as { message?: unknown };
  return typeof withMessage?.message === "string" ? withMessage.message : String(err);
}

async function safeCancelUpstream(fivesimOrderId: number) {
  try {
    await cancelOrder(String(fivesimOrderId));
  } catch (err) {
    console.error(`Failed to cancel upstream 5sim order ${fivesimOrderId} after a local failure:`, err);
  }
}

// Order lifecycle step 1-2 (ARCHITECTURE.md): balance check -> buy -> debit
// -> order created. There's no separate "quote" step to re-validate
// against — we never trust a client-supplied price, so fetching 5sim's
// current price and running it through the pricing engine right here *is*
// the re-validation ARCHITECTURE.md's pricing engine step 6 calls for.
export async function purchaseNumber(
  admin: SupabaseClient<Database>,
  params: { userId: string; serviceId: string; countryId: string },
): Promise<PurchaseResult> {
  const [serviceResult, countryResult] = await Promise.all([
    admin.from("services").select("*").eq("id", params.serviceId).eq("is_active", true).maybeSingle(),
    admin.from("countries").select("*").eq("id", params.countryId).eq("is_active", true).maybeSingle(),
  ]);
  if (serviceResult.error) throw serviceResult.error;
  if (countryResult.error) throw countryResult.error;
  const service = serviceResult.data;
  const country = countryResult.data;
  if (!service) throw new PurchaseError("Service not found or inactive", 404);
  if (!country) throw new PurchaseError("Country not found or inactive", 404);

  const productPrices = await getProductPrices(country.fivesim_country_code);
  const upstreamProduct = productPrices[service.fivesim_product_code];
  if (!upstreamProduct) {
    throw new PurchaseError(`${service.name} is not currently available in ${country.name}`, 409);
  }

  const [allRules, fxRate] = await Promise.all([
    fetchAllPricingRules(admin),
    fetchLatestFxRate(admin, UPSTREAM_CURRENCY_PAIR),
  ]);

  const resolved = priceFromRulesAndRate(allRules, fxRate, service.id, country.id, {
    amount: upstreamProduct.Price,
    currency: "USD",
  });

  const { data: wallet, error: walletError } = await admin
    .from("wallets")
    .select("balance_kobo")
    .eq("user_id", params.userId)
    .maybeSingle();
  if (walletError) throw walletError;
  if (!wallet || wallet.balance_kobo < resolved.priceKobo) {
    throw new PurchaseError("Insufficient wallet balance", 402);
  }

  // Point of no return — this spends real money on 5sim's side. Nothing
  // above this line has written anything or cost anything.
  let fivesimOrder;
  try {
    fivesimOrder = await buyActivation(country.fivesim_country_code, service.fivesim_product_code);
  } catch (err) {
    throw new PurchaseError(`Failed to purchase from 5sim: ${errorMessage(err)}`, 502);
  }

  // 5sim's actual charged price can differ from the quote we just computed
  // (observed live during testing) — upstream_cost_kobo is what we were
  // really charged, for accurate margin reporting; price_kobo is what we
  // charge the user, the quote we already committed to.
  const upstreamCostKobo = Math.round(fivesimOrder.price * fxRate * 100);
  const expiresAt = new Date(Date.now() + ORDER_TTL_MINUTES * 60_000).toISOString();

  // Order creation and the wallet debit happen as one Postgres transaction
  // (see the create_order_and_debit_wallet migration) — if the debit fails
  // for any reason (most likely the negative-balance guard catching a race
  // lost against another concurrent purchase), the order insert rolls back
  // automatically with it. Nothing left to compensate-delete on our side;
  // only the upstream 5sim purchase can still need cancelling.
  const { data: order, error: rpcError } = await admin.rpc("create_order_and_debit_wallet", {
    p_user_id: params.userId,
    p_service_id: service.id,
    p_country_code: country.fivesim_country_code,
    p_fivesim_order_id: String(fivesimOrder.id),
    p_phone_number: fivesimOrder.phone,
    p_price_kobo: resolved.priceKobo,
    p_upstream_cost_kobo: upstreamCostKobo,
    p_expires_at: expiresAt,
    p_metadata: { fivesim_order_id: fivesimOrder.id, service: service.name, country: country.name },
  });

  if (rpcError || !order) {
    await safeCancelUpstream(fivesimOrder.id);
    const message = errorMessage(rpcError);
    throw new PurchaseError(
      message.includes("negative")
        ? "Insufficient wallet balance"
        : "Failed to record the purchase — it was reversed",
      message.includes("negative") ? 402 : 500,
    );
  }

  return {
    order: {
      id: order.id,
      phoneNumber: order.phone_number,
      expiresAt: order.expires_at,
    },
  };
}
