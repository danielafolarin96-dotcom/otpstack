import "server-only";

// Verified live against a real 5sim account (Sept 2026) while building
// this file: GET /user/profile, GET /guest/countries,
// GET /guest/products/{country}/any, GET /guest/prices?country=, and one
// real $0.0897 test purchase (buy -> check -> cancel) on
// GET /user/buy/activation/nigeria/any/microsoft.
// Base URL, auth header, and the fields below all match what was actually
// observed. /user/finish and /user/ban were NOT exercised live — inferred
// to share the same response shape as buy/check/cancel (they did, for
// every verb actually tried), but flagged here since that's an inference,
// not a direct observation.
const BASE_URL = "https://5sim.net/v1";

export interface FiveSimSmsMessage {
  // Verified: `sms` is an array, empty when no code has arrived yet.
  // Item shape when non-empty is NOT verified against a real populated
  // example — based on general 5sim documentation. Confirm the first time
  // a real SMS actually lands in production and adjust extractOtpCode in
  // lib/5sim/status.ts if the real field names differ.
  created_at?: string;
  date?: string;
  sender?: string;
  text?: string;
  code?: string;
}

export interface FiveSimOrder {
  id: number;
  phone: string;
  operator: string;
  product: string;
  price: number;
  status: string;
  expires: string;
  sms: FiveSimSmsMessage[] | null;
  created_at: string;
  country: string;
}

export interface FiveSimProfile {
  id: number;
  email: string;
  balance: number;
  rating: number;
}

export interface FiveSimOperatorPrice {
  operator: string;
  cost: number;
  count: number;
  // 5sim omits this field entirely for some operators regardless of stock
  // level — observed live on /guest/prices: an operator with 900k+ in
  // stock had no `rate` at all, while a near-empty one did. So a missing
  // `rate` means "no data reported," not "confirmed unreliable," and is
  // treated as neutral (not disqualifying) below.
  rate?: number;
  // 5sim's 7-day delivery rate. Preferred over `rate` whenever present (see
  // judgedRate) — a recent window reflects how the operator is delivering
  // now, not an all-time average a bad week can hide inside. Not verified
  // as always-present on a live response, so absence falls back to `rate`.
  rate168?: number;
}

// Each product maps to its recommended operator, or null when 5sim lists
// the product in this country but nothing is in stock / clears the floor.
// A product 5sim doesn't list for this country at all is absent entirely —
// the catalog hides those instead of showing them as unavailable.
export type FiveSimProductPrices = Record<string, FiveSimOperatorPrice | null>;

type FiveSimRawOperatorPrice = { cost: number; count: number; rate?: number; rate168?: number };

interface FiveSimGuestPricesResponse {
  [country: string]: {
    [product: string]: {
      [operator: string]: FiveSimRawOperatorPrice;
    };
  };
}

// The delivery rate the floor and the ranking are both judged on: the
// 7-day `rate168` when 5sim reports it, else the overall `rate`. undefined
// (neither reported) means unrated. This is also the value stored in
// orders.fivesim_operator_rate (see lib/orders/purchase.ts), so the stored
// rate is always the one the operator was actually judged on.
export function judgedRate(price: { rate?: number; rate168?: number }): number | undefined {
  return price.rate168 ?? price.rate;
}

// Minimum delivery success rate (judgedRate: 5sim's 7-day `rate168`,
// falling back to the overall `rate` — a percentage) an operator must clear to be *offered to the customer at
// all* — below this, hidden entirely rather than ranked low. Replaces the
// old auto-pick model this file used to have: a 70% floor
// (MIN_ACCEPTABLE_DELIVERY_RATE) with a silent fallback to the cheapest
// operator whenever nothing cleared it, plus a hard per-route block with
// no fallback at all on usa/whatsapp, usa/telegram, and malaysia/whatsapp
// (HARD_RELIABILITY_FLOOR_ROUTES — see git history on this file for that
// model's full incident writeup). That model existed to protect a customer
// who had zero visibility into what they were buying. Now the real rate is
// shown and the customer chooses (see rankOperators below), so the floor
// only needs to filter out options that are essentially never going to
// work, not ones merely below "very good" — 20% is deliberately looser
// than 70% for that reason, and the three previously-hard-blocked routes
// are sellable again whenever something clears it.
export const MIN_ACCEPTABLE_RATE = 20;

export interface RankedOperators {
  // null when options is empty — nothing in stock clears the floor, and
  // no unrated operator exists either.
  recommended: FiveSimOperatorPrice | null;
  // In-stock, judgedRate undefined or >= MIN_ACCEPTABLE_RATE, sorted
  // recommended-first: every rated operator first (highest judgedRate, ties
  // broken by lower cost), then every unrated operator (lowest cost
  // first). An unrated operator only ever ranks first overall — i.e. is
  // ever "recommended" — when no rated operator clears the floor; a
  // confirmed rate, even just over the floor, outranks no data at all.
  options: FiveSimOperatorPrice[];
}

// Single source of truth for "what operators can we offer for this
// product, and which one do we recommend" — used both by getProductPrices
// (the catalog grid's single "from ₦X" tile price, which takes
// `recommended`) and getOperatorPrices (the buy-flow picker, which shows
// the full `options` list). Keeping both on this one function is
// deliberate: the tile and the picker must never disagree about which
// operator is "the" price or the recommendation.
export function rankOperators(operators: Record<string, FiveSimRawOperatorPrice>): RankedOperators {
  const inStock = Object.entries(operators)
    .filter(([, price]) => price.count > 0)
    .map(([operator, price]) => {
      const option: FiveSimOperatorPrice = { operator, ...price };
      return { option, judged: judgedRate(option) };
    });

  const eligible = inStock.filter((p) => p.judged === undefined || p.judged >= MIN_ACCEPTABLE_RATE);

  const rated = eligible
    .filter((p): p is typeof p & { judged: number } => p.judged !== undefined)
    .sort((a, b) => b.judged - a.judged || a.option.cost - b.option.cost);
  const unrated = eligible.filter((p) => p.judged === undefined).sort((a, b) => a.option.cost - b.option.cost);

  const options = [...rated, ...unrated].map((p) => p.option);
  return { recommended: options[0] ?? null, options };
}

export class FiveSimError extends Error {
  constructor(
    public path: string,
    public status: number,
    public body: string,
  ) {
    super(`5sim ${path} failed: ${status} ${body}`);
  }
}

// Confirmed live (Sept 2026): GET /user/buy/activation/.../.../tiktok
// against a known-zero-stock operator returned HTTP 200,
// Content-Type: text/plain, body "no free phones" — not JSON, and not
// even a non-2xx status. response.json() on that throws a raw
// SyntaxError ("Unexpected token 'o', "no free phones" is not valid
// JSON") that used to escape all the way to the customer verbatim. Read
// the body as text unconditionally and JSON.parse it ourselves instead,
// so any non-JSON 5sim response — this one included, and any other we
// haven't seen yet — becomes a normal FiveSimError instead of an
// uncaught parser exception.
async function fiveSimFetch<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${process.env.FIVESIM_API_KEY}`,
      Accept: "application/json",
    },
  });

  const body = await response.text();

  if (!response.ok) {
    throw new FiveSimError(path, response.status, body);
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new FiveSimError(path, response.status, body);
  }
}

// Every response GET /user/buy/activation/{country}/{operator}/{product}
// can return, per https://5sim.net/docs' "Buy activation number" section
// (confirmed Sept 2026, fetched directly — not inferred): "no free
// phones" comes back as HTTP 200 plain text (the bug above); "not enough
// user balance", "not enough rating", "select country", "select
// operator", "bad country", "bad operator", "no product", and "server
// offline" come back as HTTP 400; "internal error" as HTTP 500. None of
// these are messages a customer should see verbatim — "not enough user
// balance" in particular is about *our* 5sim account balance, not the
// customer's wallet, and would be actively misleading shown as-is. Only
// "no free phones" gets a distinct, actionable customer message; every
// other known (and any unrecognized) failure gets the same generic
// message, since none of them are something the customer can act on —
// they're all either transient upstream issues or a bug on our side, and
// either way the raw string is logged server-side (lib/orders/purchase.ts)
// for us to investigate, not shown.
const FIVESIM_BUY_ERROR_MESSAGES: Record<string, string> = {
  "no free phones":
    "No numbers currently available for this service/country — try again shortly or pick a different country.",
};

const GENERIC_PURCHASE_FAILURE_MESSAGE = "Something went wrong purchasing this number — please try again.";

export function customerFacingPurchaseErrorMessage(rawMessage: string): string {
  const normalized = rawMessage.trim().toLowerCase();
  for (const [known, customerMessage] of Object.entries(FIVESIM_BUY_ERROR_MESSAGES)) {
    if (normalized.includes(known)) return customerMessage;
  }
  return GENERIC_PURCHASE_FAILURE_MESSAGE;
}

export function getProfile(): Promise<FiveSimProfile> {
  return fiveSimFetch<FiveSimProfile>("/user/profile");
}

// 60s cache of the whole-country /guest/prices response, for
// getProductPrices only (the catalog grid and dashboard search, which
// re-render on every page view). getOperatorPrices deliberately bypasses
// it: the operator picker and purchaseNumber's re-validation must see live
// stock and rates. In-process memory rather than Next's fetch cache — a
// whole-country response can be large enough to exceed that cache's
// per-item size limit, and this keeps the fresh/cached split explicit in
// one file. Per server instance, so different instances may briefly
// disagree; 60s bounds that. In-flight promises are cached too so
// concurrent renders share one upstream call; a failed fetch is evicted
// immediately rather than cached.
export const GUEST_PRICES_CACHE_TTL_MS = 60_000;
const guestPricesCache = new Map<string, { expiresAt: number; body: Promise<FiveSimGuestPricesResponse> }>();

function getCachedGuestPrices(countryCode: string): Promise<FiveSimGuestPricesResponse> {
  const now = Date.now();
  const hit = guestPricesCache.get(countryCode);
  if (hit && hit.expiresAt > now) return hit.body;

  const body = fiveSimFetch<FiveSimGuestPricesResponse>(`/guest/prices?country=${countryCode}`);
  guestPricesCache.set(countryCode, { expiresAt: now + GUEST_PRICES_CACHE_TTL_MS, body });
  body.catch(() => {
    if (guestPricesCache.get(countryCode)?.body === body) guestPricesCache.delete(countryCode);
  });
  return body;
}

// Test-only: the cache is module state and would otherwise leak between tests.
export function clearGuestPricesCache() {
  guestPricesCache.clear();
}

// One call returns every product's price across every operator for the
// whole country — used to price the entire catalog grid without one
// request per service. For each product, collapses the operator list down
// to rankOperators' `recommended` pick — see that function for the full
// floor/ranking precedence. This is a single representative price for a
// grid tile ("Get X from ₦Y"); the buy flow itself uses getOperatorPrices
// below to show every option, not just this one. Cached for 60s — see
// getCachedGuestPrices.
export async function getProductPrices(countryCode: string): Promise<FiveSimProductPrices> {
  const body = await getCachedGuestPrices(countryCode);
  const countryBody = body[countryCode] ?? {};
  const result: FiveSimProductPrices = {};

  for (const [product, operators] of Object.entries(countryBody)) {
    result[product] = rankOperators(operators).recommended;
  }

  return result;
}

// Every ranked operator option for a single (countryCode, product) pair —
// powers the buy-flow operator picker (components reached via
// app/api/catalog/operators/route.ts) and purchaseNumber's re-validation
// of a customer's chosen operator at purchase time.
//
// Deliberately reuses the same whole-country /guest/prices?country=
// endpoint getProductPrices already calls (verified live — see this
// file's header comment) and filters to one product in code, rather than
// 5sim's documented product-scoped variant (/guest/prices?country=&
// product=, see ARCHITECTURE.md's 5sim integration table). That scoped
// query has NOT actually been exercised against a live response — its
// exact shape is unconfirmed, and this sits directly on the purchase path,
// so per AGENT.md ("don't invent 5sim API behavior") this intentionally
// costs a slightly bigger payload for a verified-correct response shape
// instead. Switch once someone's confirmed the scoped variant's shape
// live.
export async function getOperatorPrices(countryCode: string, product: string): Promise<RankedOperators> {
  const body = await fiveSimFetch<FiveSimGuestPricesResponse>(`/guest/prices?country=${countryCode}`);
  const operators = body[countryCode]?.[product] ?? {};
  return rankOperators(operators);
}

// `operator` is the specific 5sim operator name to buy from — callers
// should pass the exact one the customer chose from getOperatorPrices'
// options (re-validated server-side, see purchaseNumber), not "any", so
// the number actually purchased is the one that was shown and vetted, not
// whatever 5sim's own "any" logic happens to choose. "any" remains a
// valid value (confirmed working in the live test purchase, it returned a
// real virtual2 number) for callers that intentionally want to defer to
// 5sim's own pick.
export function buyActivation(
  countryCode: string,
  operator: string,
  productCode: string,
): Promise<FiveSimOrder> {
  return fiveSimFetch<FiveSimOrder>(`/user/buy/activation/${countryCode}/${operator}/${productCode}`);
}

export function checkOrder(fivesimOrderId: string): Promise<FiveSimOrder> {
  return fiveSimFetch<FiveSimOrder>(`/user/check/${fivesimOrderId}`);
}

export function finishOrder(fivesimOrderId: string): Promise<FiveSimOrder> {
  return fiveSimFetch<FiveSimOrder>(`/user/finish/${fivesimOrderId}`);
}

export function cancelOrder(fivesimOrderId: string): Promise<FiveSimOrder> {
  return fiveSimFetch<FiveSimOrder>(`/user/cancel/${fivesimOrderId}`);
}

export function banOrder(fivesimOrderId: string): Promise<FiveSimOrder> {
  return fiveSimFetch<FiveSimOrder>(`/user/ban/${fivesimOrderId}`);
}
