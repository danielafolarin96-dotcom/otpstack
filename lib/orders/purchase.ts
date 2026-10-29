import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  buyActivation,
  cancelOrder,
  customerFacingPurchaseErrorMessage,
  getOperatorPrices,
  judgedRate,
} from "@/lib/5sim/client";
import {
  buyActivation as buyGrizzlyActivation,
  customerFacingGrizzlyPurchaseMessage,
  getSupplierPrices,
  GRIZZLY_USD_CURRENCY,
  GrizzlyError,
  rankSuppliers,
} from "@/lib/grizzly/client";
import type { PurchaseFailureReason } from "./purchase-failures";
import {
  CANCEL_GIVE_UP_AFTER_MS,
  enqueueUpstreamCancel,
  GRIZZLY_CANCEL_LOCK_SECONDS,
  type UpstreamCancelReason,
} from "./upstream-cancel-queue";
import {
  effectiveFxRate,
  fetchAllPricingRules,
  fetchPricingFxRates,
  priceFromRulesAndRate,
} from "@/lib/pricing/engine";
import { computeFeeKobo, fetchActiveFeeSchedule } from "@/lib/finance/fee-schedule";
import { scheduleOrderExpiry } from "@/lib/qstash/client";
import { resolveProvider, type ProviderName } from "@/lib/providers/route";

// The customer-facing hold, for both providers (product decision, 29 Oct
// 2026; previously 3 minutes, and 10 before that).
//
// History: the hold was cut to 3 minutes in Sept 2026 on the belief that
// once 5sim auto-timed-out an order (~5 minutes, no SMS) the upstream cost
// was lost, so our cancel had to land first. A check of 5sim's own payment
// history (29 Oct 2026, ARCHITECTURE.md) showed the opposite: 5sim only
// debits FINISHED orders — none of its TIMEOUT orders were ever charged.
// So a hold that outlasts 5sim's timeout costs nothing, and the expiry
// path records a TIMEOUT-with-no-SMS as cost recovered.
//
// 5 minutes also matches Grizzly, which locks cancel for ~5 minutes after
// purchase: the expiry cancel (TTL + the QStash pad below) lands just after
// the lock, and if it still hits it the cancel is queued and retried
// (lib/orders/upstream-cancel-queue.ts).
const ORDER_TTL_MINUTES = 5;
// Padding added to the QStash callback's delay (not to the TTL/expires_at
// itself): the cron route's query is `lt("expires_at", now())` at the
// moment the callback lands — scheduling the callback for exactly TTL
// would race that check if QStash fires even slightly early (clock skew,
// delivery jitter), making expires_at <= now() and silently skipping the
// order until a later backstop sweep catches it. 10s is comfortably past
// any observed QStash delivery jitter.
const QSTASH_CALLBACK_PADDING_SECONDS = 10;
// SECURITY.md's rate-limiting example for purchase: "a cap on concurrent
// active/pending orders" — distinct from the time-windowed limits in
// app/api/orders/route.ts, this bounds how many numbers one user can be
// holding at once regardless of how spread out in time the purchases were.
const MAX_CONCURRENT_ORDERS_PER_USER = 3;
// Both providers price in USD (5sim observed; Grizzly's getNumberV2 reports
// currency 840 = USD, checked on every purchase below).
const UPSTREAM_CURRENCY_PAIR = "USD_NGN";
// Float slack when comparing Grizzly's charge with our quote — both are
// Grizzly's own decimal strings, so anything beyond this is a real excess.
const PRICE_EPSILON_USD = 1e-9;

export interface PurchaseErrorOptions {
  // Short code recorded in purchase_failures (lib/orders/purchase-failures.ts).
  reason?: PurchaseFailureReason;
  // 402 only: how much more the wallet needs, in kobo — sent to the client
  // so it can offer a pre-filled top-up. Absent when unknown (the RPC's
  // balance-race path, where the balance moved under us).
  shortfallKobo?: number;
  // Server-side detail for purchase_failures.message (e.g. the provider's
  // raw response) — never sent to the client; `message` is what the
  // customer sees.
  internalMessage?: string;
  // Which provider the attempt was routed to, once known — recorded in
  // purchase_failures.provider.
  provider?: ProviderName;
}

export class PurchaseError extends Error {
  public reason: PurchaseFailureReason;
  public shortfallKobo?: number;
  public internalMessage?: string;
  public provider?: ProviderName;

  constructor(
    message: string,
    public status: number = 400,
    options: PurchaseErrorOptions = {},
  ) {
    super(message);
    this.reason = options.reason ?? "other";
    this.shortfallKobo = options.shortfallKobo;
    this.internalMessage = options.internalMessage;
    this.provider = options.provider;
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

async function safeCancelUpstream(fivesimOrderId: string) {
  try {
    await cancelOrder(fivesimOrderId);
  } catch (err) {
    console.error(`Failed to cancel upstream 5sim order ${fivesimOrderId} after a local failure:`, err);
  }
}

// Undo an upstream purchase we're not going to sell. 5sim cancels
// immediately; Grizzly refuses cancels for ~5 minutes, so the cancel is
// queued for after the lock (lib/orders/upstream-cancel-queue.ts). Grizzly
// only charges when an SMS arrives, and nobody holds this number, so the
// queued cancel is tidying up rather than recovering money.
async function abandonUpstreamPurchase(
  admin: SupabaseClient<Database>,
  provider: ProviderName,
  providerOrderId: string,
  reason: UpstreamCancelReason,
  lastError: string,
) {
  if (provider === "5sim") {
    await safeCancelUpstream(providerOrderId);
    return;
  }
  const now = Date.now();
  await enqueueUpstreamCancel(admin, {
    provider,
    providerOrderId,
    reason,
    notBefore: new Date(now + GRIZZLY_CANCEL_LOCK_SECONDS * 1000),
    giveUpAt: new Date(now + CANCEL_GIVE_UP_AFTER_MS),
    lastError: lastError.slice(0, 500),
  });
}

// The customer's chosen option, re-validated against a fresh provider
// fetch, and what we pay for it (USD).
type Quote =
  | { provider: "5sim"; operator: string; costUsd: number; judgedRate: number | undefined }
  | { provider: "grizzly"; supplierId: string; costUsd: number; serviceCode: string; countryId: number };

// What the provider actually sold us.
interface UpstreamPurchase {
  providerOrderId: string;
  phone: string;
  chargedUsd: number;
  activationTime: string | null;
}

type ServiceRow = Database["public"]["Tables"]["services"]["Row"];
type CountryRow = Database["public"]["Tables"]["countries"]["Row"];

function operatorUnavailable(service: ServiceRow, country: CountryRow, provider: ProviderName): PurchaseError {
  return new PurchaseError(
    `That operator is no longer available for ${service.name} in ${country.name} — please choose another.`,
    409,
    { reason: "operator_unavailable", provider },
  );
}

// Re-validates the customer's chosen operator against a fresh fetch rather
// than trusting whatever was displayed when they opened the picker — stock
// and price can shift in the moments between fetching options and
// confirming a purchase. A chosen operator that's dropped out of the
// options is rejected rather than silently substituted for a different
// one; the client's job on a 409 is to re-fetch the options and let the
// customer choose again, not to retry blindly.
async function quoteChosenOption(
  provider: ProviderName,
  service: ServiceRow,
  country: CountryRow,
  operator: string,
): Promise<Quote> {
  if (provider === "grizzly") {
    // pickProvider only returns grizzly when both mappings exist.
    const serviceCode = service.grizzly_service_code!;
    const countryId = country.grizzly_country_id!;
    const suppliers = await getSupplierPrices(serviceCode, countryId);
    const chosen = rankSuppliers(suppliers ?? []).options.find((s) => s.supplierId === operator);
    if (!chosen) throw operatorUnavailable(service, country, provider);
    return { provider, supplierId: chosen.supplierId, costUsd: chosen.cost, serviceCode, countryId };
  }

  // 5sim: a chosen operator that's out of stock or whose rate fell below
  // MIN_ACCEPTABLE_RATE (lib/5sim/client.ts's rankOperators) is gone.
  const { options } = await getOperatorPrices(country.fivesim_country_code, service.fivesim_product_code);
  const chosen = options.find((option) => option.operator === operator);
  if (!chosen) throw operatorUnavailable(service, country, provider);
  return { provider, operator: chosen.operator, costUsd: chosen.cost, judgedRate: judgedRate(chosen) };
}

// Point of no return — this spends real money upstream. Full provider
// error detail is logged and kept in internalMessage; the customer only
// ever sees the mapped message, since some provider errors (5sim's "not
// enough user balance", Grizzly's NO_BALANCE) describe OUR provider
// account, not the customer's wallet, and would be actively misleading.
async function buyFromProvider(
  admin: SupabaseClient<Database>,
  quote: Quote,
  service: ServiceRow,
  country: CountryRow,
): Promise<UpstreamPurchase> {
  if (quote.provider === "grizzly") {
    let activation;
    try {
      activation = await buyGrizzlyActivation({
        service: quote.serviceCode,
        countryId: quote.countryId,
        supplierId: quote.supplierId,
        maxPrice: quote.costUsd,
      });
    } catch (err) {
      console.error(`Grizzly getNumberV2 failed for ${quote.serviceCode}/${quote.countryId}/${quote.supplierId}:`, err);
      const body = err instanceof GrizzlyError ? err.body.trim() : "";
      throw new PurchaseError(customerFacingGrizzlyPurchaseMessage(body), 502, {
        reason: body === "NO_NUMBERS" ? "upstream_no_numbers" : body === "NO_BALANCE" ? "provider_balance" : "other",
        internalMessage: errorMessage(err),
        provider: "grizzly",
      });
    }

    // maxPrice should make this impossible, but the quote is a promise to
    // the customer: if Grizzly charged more than we quoted (or in a
    // currency our cost conversion doesn't cover), don't sell the number.
    // No debit happens; the activation is queued for cancel after the lock.
    const overQuote = activation.activationCost > quote.costUsd + PRICE_EPSILON_USD;
    const wrongCurrency = activation.currency !== null && activation.currency !== GRIZZLY_USD_CURRENCY;
    if (overQuote || wrongCurrency) {
      const detail = `Grizzly charged ${activation.activationCost} (currency ${activation.currency}) against a quote of ${quote.costUsd} USD for activation ${activation.activationId}`;
      console.error(detail);
      await abandonUpstreamPurchase(admin, "grizzly", activation.activationId, "price_above_quote", detail);
      throw new PurchaseError("Something went wrong purchasing this number — please try again.", 502, {
        reason: "other",
        internalMessage: detail,
        provider: "grizzly",
      });
    }

    return {
      providerOrderId: activation.activationId,
      phone: activation.phoneNumber,
      chargedUsd: activation.activationCost,
      activationTime: activation.activationTime,
    };
  }

  try {
    const fivesimOrder = await buyActivation(country.fivesim_country_code, quote.operator, service.fivesim_product_code);
    return {
      providerOrderId: String(fivesimOrder.id),
      phone: fivesimOrder.phone,
      // 5sim's actual charged price can differ from the quote (observed
      // live during testing).
      chargedUsd: fivesimOrder.price,
      activationTime: null,
    };
  } catch (err) {
    console.error(`5sim buyActivation failed for ${service.fivesim_product_code}/${country.fivesim_country_code}:`, err);
    const rawMessage = errorMessage(err);
    const lowerMessage = rawMessage.toLowerCase();
    throw new PurchaseError(customerFacingPurchaseErrorMessage(rawMessage), 502, {
      reason: lowerMessage.includes("no free phones")
        ? "upstream_no_numbers"
        : // Our 5sim account is out of funds, not the customer's wallet.
          lowerMessage.includes("not enough user balance")
          ? "provider_balance"
          : "other",
      internalMessage: rawMessage,
      provider: "5sim",
    });
  }
}

// Order lifecycle step 1-2 (ARCHITECTURE.md): balance check -> buy -> debit
// -> order created. There's no separate "quote" step to re-validate
// against — we never trust a client-supplied price, so fetching the
// provider's current price and running it through the pricing engine right
// here *is* the re-validation ARCHITECTURE.md's pricing engine step 6
// calls for. Which provider sells the number comes from provider_routes
// (lib/providers/route.ts).
export async function purchaseNumber(
  admin: SupabaseClient<Database>,
  params: { userId: string; serviceId: string; countryId: string; operator: string },
): Promise<PurchaseResult> {
  // Freeze check first, before any provider call or DB write — a frozen
  // account shouldn't even trigger the upstream price lookup. Only blocks
  // *new* purchases; an order already in flight when an account gets
  // frozen still resolves through its normal expiry/refund path untouched.
  const { data: userRow, error: userError } = await admin
    .from("users")
    .select("is_frozen")
    .eq("id", params.userId)
    .maybeSingle();
  if (userError) throw userError;
  if (!userRow) throw new PurchaseError("User not found", 404);
  if (userRow.is_frozen) {
    throw new PurchaseError("Your account is frozen — contact support", 403);
  }

  const { count: concurrentOrders, error: concurrentOrdersError } = await admin
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("user_id", params.userId)
    // Only numbers still held count. sms_received is terminal (the code was
    // delivered and the status never changes again), so counting it blocked
    // any user with 3 successful orders permanently. Pending rows past
    // expires_at are also excluded: the expiry callback may not have flipped
    // them yet, but the hold is already over.
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString());
  if (concurrentOrdersError) throw concurrentOrdersError;
  if ((concurrentOrders ?? 0) >= MAX_CONCURRENT_ORDERS_PER_USER) {
    throw new PurchaseError(
      `You can only hold ${MAX_CONCURRENT_ORDERS_PER_USER} active numbers at once — finish or let one expire first`,
      429,
      { reason: "concurrent_order" },
    );
  }

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

  const provider = await resolveProvider(admin, service, country);
  const quote = await quoteChosenOption(provider, service, country, params.operator);

  const [allRules, fxRates, feeSchedule] = await Promise.all([
    fetchAllPricingRules(admin),
    fetchPricingFxRates(admin, UPSTREAM_CURRENCY_PAIR),
    fetchActiveFeeSchedule(admin),
  ]);
  // Real funding cost of the provider that sells this number, not just the
  // market rate (see effectiveFxRate) — used for both the price and
  // upstream_cost_kobo below, so profit reports reflect what that
  // provider's balance actually cost us.
  const fxRate = effectiveFxRate(fxRates, provider);

  const resolved = priceFromRulesAndRate(allRules, fxRate, service.id, country.id, {
    amount: quote.costUsd,
    currency: "USD",
  });

  // No configured schedule degrades to a $0 imputed fee rather than
  // blocking the purchase — see lib/finance/fee-schedule.ts. Computed here
  // (not in SQL) so the fee formula lives in exactly one, unit-tested place.
  const paymentFeeKobo = feeSchedule ? computeFeeKobo(resolved.priceKobo, feeSchedule) : 0;

  const { data: wallet, error: walletError } = await admin
    .from("wallets")
    .select("balance_kobo")
    .eq("user_id", params.userId)
    .maybeSingle();
  if (walletError) throw walletError;
  const balanceKobo = wallet?.balance_kobo ?? 0;
  if (balanceKobo < resolved.priceKobo) {
    throw new PurchaseError("Insufficient wallet balance", 402, {
      reason: "insufficient_balance",
      shortfallKobo: resolved.priceKobo - balanceKobo,
      provider,
    });
  }

  // Nothing above this line has written anything or cost anything.
  const bought = await buyFromProvider(admin, quote, service, country);

  // upstream_cost_kobo is what we were really charged, for accurate margin
  // reporting; price_kobo is what we charge the user, the quote we already
  // committed to.
  const upstreamCostKobo = Math.round(bought.chargedUsd * fxRate * 100);
  const expiresAt = new Date(Date.now() + ORDER_TTL_MINUTES * 60_000).toISOString();

  // Order creation and the wallet debit happen as one Postgres transaction
  // (see the create_order_and_debit_wallet migration) — if the debit fails
  // for any reason (most likely the negative-balance guard catching a race
  // lost against another concurrent purchase), the order insert rolls back
  // automatically with it. Nothing left to compensate-delete on our side;
  // only the upstream purchase can still need cancelling.
  const { data: order, error: rpcError } = await admin.rpc("create_order_and_debit_wallet", {
    p_user_id: params.userId,
    p_service_id: service.id,
    p_country_code: country.fivesim_country_code,
    // The upstream order id for p_provider (named for 5sim for backwards
    // compatibility — see the 20261029120000 migration).
    p_fivesim_order_id: bought.providerOrderId,
    p_phone_number: bought.phone,
    p_price_kobo: resolved.priceKobo,
    p_upstream_cost_kobo: upstreamCostKobo,
    p_expires_at: expiresAt,
    p_metadata: {
      provider,
      provider_order_id: bought.providerOrderId,
      ...(provider === "5sim" ? { fivesim_order_id: Number(bought.providerOrderId) } : {}),
      service: service.name,
      country: country.name,
    },
    // 5sim: the customer's chosen operator and the rate it was judged on at
    // purchase time (judgedRate: 7-day rate168, else overall rate), so
    // order outcomes can be joined against the rate that cleared the floor.
    // Grizzly: the chosen supplier and our quoted vs. charged USD, for the
    // same per-supplier delivery analysis (Grizzly reports no rates).
    ...(quote.provider === "5sim"
      ? { p_fivesim_operator: quote.operator, p_fivesim_operator_rate: quote.judgedRate }
      : {
          p_provider_supplier_id: quote.supplierId,
          p_upstream_quoted_usd: quote.costUsd,
          p_upstream_charged_usd: bought.chargedUsd,
          ...(bought.activationTime ? { p_upstream_activation_time: bought.activationTime } : {}),
        }),
    p_payment_fee_kobo: paymentFeeKobo,
    p_fee_schedule_id: feeSchedule?.id,
    p_provider: provider,
  });

  if (rpcError || !order) {
    const message = errorMessage(rpcError);
    await abandonUpstreamPurchase(admin, provider, bought.providerOrderId, "order_record_failed", message);
    const lostBalanceRace = message.includes("negative");
    throw new PurchaseError(
      lostBalanceRace ? "Insufficient wallet balance" : "Failed to record the purchase — it was reversed",
      lostBalanceRace ? 402 : 500,
      { reason: lostBalanceRace ? "insufficient_balance" : "other", internalMessage: message, provider },
    );
  }

  // Best-effort, non-blocking of the response below (same pattern as
  // safeCancelUpstream) — schedules the one-shot callback that's meant to
  // actually land the upstream cancel promptly at expiry (see
  // ORDER_TTL_MINUTES' comment above and lib/qstash/client.ts). If this
  // fails, the order isn't lost — the GitHub Actions/daily-cron backstops
  // still eventually sweep it, just slower. scheduleOrderExpiry already
  // catches its own errors internally and never throws, but the promise
  // this makes ("never blocks the purchase response") is important enough
  // to hold here too, not just trust that implementation detail.
  try {
    await scheduleOrderExpiry(order.id, ORDER_TTL_MINUTES * 60 + QSTASH_CALLBACK_PADDING_SECONDS);
  } catch (err) {
    console.error(`Failed to schedule expiry callback for order ${order.id}:`, err);
  }

  return {
    order: {
      id: order.id,
      phoneNumber: order.phone_number,
      expiresAt: order.expires_at,
    },
  };
}
