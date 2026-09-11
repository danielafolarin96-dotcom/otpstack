import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { buyActivation, cancelOrder, getProductPrices } from "@/lib/5sim/client";
import { recordWalletTransaction } from "@/lib/wallet/ledger";
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

  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert({
      user_id: params.userId,
      service_id: service.id,
      country_code: country.fivesim_country_code,
      fivesim_order_id: String(fivesimOrder.id),
      phone_number: fivesimOrder.phone,
      status: "pending",
      price_kobo: resolved.priceKobo,
      upstream_cost_kobo: upstreamCostKobo,
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (orderError || !order) {
    await safeCancelUpstream(fivesimOrder.id);
    throw new PurchaseError(
      "Failed to record the order — the 5sim number was not charged to your wallet",
      500,
    );
  }

  try {
    await recordWalletTransaction(admin, {
      userId: params.userId,
      type: "purchase",
      amountKobo: -resolved.priceKobo,
      reference: `purchase_${order.id}`,
      orderId: order.id,
      metadata: { fivesim_order_id: fivesimOrder.id, service: service.name, country: country.name },
    });
  } catch (err) {
    // Debit failed — most likely the negative-balance guard catching a
    // race lost against another concurrent purchase. Compensate on both
    // sides rather than leaving an unpaid order in the table.
    await safeCancelUpstream(fivesimOrder.id);
    await admin.from("orders").delete().eq("id", order.id);
    const message = errorMessage(err);
    throw new PurchaseError(
      message.includes("negative") ? "Insufficient wallet balance" : "Failed to debit wallet — purchase was reversed",
      402,
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
