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

// Minimum overall delivery success rate (5sim's per-operator `rate` field,
// a percentage) an operator must clear to be picked by getProductPrices.
// Originally 50, justified by exactly one diagnostic (Sept 2026): a
// TikTok/USA purchase from the cheapest operator (45% rate) never
// delivered its code, while a slightly pricier operator (80% rate) on the
// same product/country delivered cleanly. That's a thin basis for a real
// number, and a low floor plausibly let through operators unlikely to ever
// deliver an SMS — timing the order out regardless of expiry-sweep speed
// (see lib/orders/expire-and-refund.ts and that change's commit message).
//
// Raised to 70 (Sept 2026) as a conservative interim value given the two
// known data points (45 failed, 80 succeeded — 70 sits closer to the
// success side without assuming everything above 50 is actually fine).
// orders.fivesim_operator / orders.fivesim_operator_rate (see that
// migration) now capture the operator + rate actually used on every
// purchase going forward specifically so this can be revisited with a real
// sms_received-vs-expired distribution by rate bucket instead of guessed —
// do that before moving this again. See that commit's message for the
// full before/after catalog-impact analysis (operators excluded, cost
// deltas, product/country combos that lose every "reliable" operator and
// fall back to cheapest-overall) this value change was reviewed against.
const MIN_ACCEPTABLE_DELIVERY_RATE = 70;

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
}

export type FiveSimProductPrices = Record<string, FiveSimOperatorPrice>;

interface FiveSimGuestPricesResponse {
  [country: string]: {
    [product: string]: {
      [operator: string]: { cost: number; count: number; rate?: number };
    };
  };
}

// Scoped per-(country, product) live rate floor — replaces a name-based
// denylist (see git history) that banned "virtual8" outright for
// usa/whatsapp. A name ban needs hand-maintenance forever: if that
// operator's real delivery rate recovers it stays banned regardless, and
// if a *different* operator on the same route goes bad nobody notices
// until another string gets added. This instead re-checks 5sim's own live
// `rate` for every operator on this route on every request and excludes
// whichever ones are currently below the floor — self-correcting in both
// directions, no code change needed either way.
//
// Deliberately separate from MIN_ACCEPTABLE_DELIVERY_RATE (70) below, and
// scoped to usa/whatsapp only — not a change to the general "reliable"
// tier used everywhere else. This is a pre-filter selectBestOperator never
// sees past; its own 70%-floor logic still runs afterward on whatever
// survives here, so a route with an operator that actually clears 70% will
// still prefer it over a merely-above-30% one.
//
// Floor derivation (2026-09-20), from orders.fivesim_operator_rate joined
// against orders.status — thin so far (12 rows) but a clean split: every
// order whose operator's rate at purchase time was below ~20% failed to
// deliver (8/8: virtual8, virtual51, virtual63, rates 0-16.3), while both
// of our only two sms_received orders came from operators at 25% and
// 34.48%. 30 sits a safe margin above that observed failure ceiling
// without being as strict as the general 70% floor, which live data shows
// would exclude operators on this route that otherwise look functional
// (virtual28 at 38-49%, virtual63 at ~48%, observed same day) — the
// problem being solved is virtual8-grade near-zero rates (0-1%), not
// merely-imperfect ones. Revisit as orders.fivesim_operator_rate
// accumulates more rows to bucket against.
const ROUTE_RATE_FLOORS: Record<string, Record<string, number>> = {
  usa: { whatsapp: 30 },
};

// Explicit "always sell this named operator when it's in stock" pin —
// distinct from ROUTE_RATE_FLOORS above, which recomputes a live threshold
// every request and lets whichever operator currently clears it win on
// cost. A pin is for a route we've deliberately reviewed and decided one
// *specific* operator's reliability is worth its cost premium regardless
// of what looks cheapest-in-stock this minute, because the live `rate`
// field swings too much request-to-request to drive operator choice on
// this route: usa/whatsapp's rate floor alone flip-flopped between
// excluding and admitting virtual28 across two live checks made minutes
// apart on 2026-09-23 (9.47% then 26.89%), which would otherwise have the
// customer-facing operator (and price) change from one page load to the
// next. Pinned here to virtual28 specifically — $1.9231/unit but a
// meaningfully better delivery rate (~27-32% across recent checks) than
// virtual8's near-zero rate (~2-4%) at roughly half the cost. Falls back
// to the normal route-floor + cheapest-in-stock selection below if the
// pinned operator itself runs out of stock, so the product doesn't vanish
// just because one named operator is briefly sold out. Revisit (raise,
// lower, or unpin) as orders.fivesim_operator_rate accumulates more
// virtual28-specific outcomes to check this against.
const ROUTE_OPERATOR_PINS: Record<string, Record<string, string>> = {
  usa: { whatsapp: "virtual28" },
};

// Reliability-first operator selection (confirmed rule — see
// MIN_ACCEPTABLE_DELIVERY_RATE above and ARCHITECTURE.md's 5sim
// integration section): prefer the cheapest operator among those that are
// in stock and not confirmed unreliable. If every in-stock operator falls
// below the floor, fall back to the cheapest in-stock operator overall —
// a worse number still beats no number at all.
export function selectBestOperator(
  operators: Record<string, { cost: number; count: number; rate?: number }>,
): FiveSimOperatorPrice | null {
  const inStock = Object.entries(operators)
    .filter(([, price]) => price.count > 0)
    .map(([operator, price]) => ({ operator, ...price }));
  if (inStock.length === 0) return null;

  const reliable = inStock.filter(
    (price) => price.rate === undefined || price.rate >= MIN_ACCEPTABLE_DELIVERY_RATE,
  );
  const pool = reliable.length > 0 ? reliable : inStock;

  return pool.reduce((best, price) => (price.cost < best.cost ? price : best));
}

// Resolves the single operator getProductPrices sells for one
// (countryCode, product) pair, in precedence order:
//   1. ROUTE_OPERATOR_PINS — a named operator we've deliberately chosen for
//      this exact route, used whenever it's in stock, regardless of cost,
//      rate, or ROUTE_RATE_FLOORS.
//   2. ROUTE_RATE_FLOORS + selectBestOperator — the live-rate-driven
//      selection used everywhere else (or as this route's own fallback if
//      the pinned operator is out of stock).
//   3. selectBestOperator over the full unfiltered operator list, in case
//      the route floor excluded every in-stock operator.
export function selectOperatorForRoute(
  countryCode: string,
  product: string,
  operators: Record<string, { cost: number; count: number; rate?: number }>,
): FiveSimOperatorPrice | null {
  const pinnedOperatorName = ROUTE_OPERATOR_PINS[countryCode]?.[product];
  const pinned = pinnedOperatorName ? operators[pinnedOperatorName] : undefined;
  if (pinned && pinned.count > 0) {
    return { operator: pinnedOperatorName as string, ...pinned };
  }

  const routeFloor = ROUTE_RATE_FLOORS[countryCode]?.[product];
  const candidates =
    routeFloor === undefined
      ? operators
      : Object.fromEntries(
          Object.entries(operators).filter(([, price]) => price.rate === undefined || price.rate >= routeFloor),
        );

  // The route floor is a *preference*, not a hard "don't sell this" rule —
  // same philosophy as MIN_ACCEPTABLE_DELIVERY_RATE's own fallback in
  // selectBestOperator. If every in-stock operator on this route happens
  // to be below the route floor right now (rates move day to day — see
  // ROUTE_RATE_FLOORS's derivation comment above), fall back to selecting
  // from the full unfiltered operator list instead of treating the
  // product as unavailable. Confirmed live 2026-09-23: usa/whatsapp's only
  // two in-stock operators (virtual28 at 9.47%, virtual8 at 2.76%) both
  // dropped under the 30 floor, which — with no fallback — made WhatsApp
  // disappear from the USA catalog entirely even though it was in stock
  // and purchasable, just at worse-than-preferred reliability.
  return selectBestOperator(candidates) ?? selectBestOperator(operators);
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

// One call returns every product's price across every operator for the
// whole country — used to price the entire catalog grid without one
// request per service. For each product, collapses the operator list down
// to the single one selectOperatorForRoute picks — see that function for
// the full pin / rate-floor / fallback precedence.
export async function getProductPrices(countryCode: string): Promise<FiveSimProductPrices> {
  const body = await fiveSimFetch<FiveSimGuestPricesResponse>(`/guest/prices?country=${countryCode}`);
  const countryBody = body[countryCode] ?? {};
  const result: FiveSimProductPrices = {};

  for (const [product, operators] of Object.entries(countryBody)) {
    const best = selectOperatorForRoute(countryCode, product, operators);
    if (best) result[product] = best;
  }

  return result;
}

// `operator` is the specific 5sim operator name to buy from — callers
// should pass the one getProductPrices already picked for reliability
// rather than "any", so the number actually purchased is the one that was
// vetted, not whatever 5sim's own "any" logic happens to choose. "any"
// remains a valid value (confirmed working in the live test purchase, it
// returned a real virtual2 number) for callers that intentionally want to
// defer to 5sim's own pick.
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
