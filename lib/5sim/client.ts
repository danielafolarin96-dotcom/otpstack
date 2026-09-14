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

class FiveSimError extends Error {
  constructor(
    public path: string,
    public status: number,
    public body: string,
  ) {
    super(`5sim ${path} failed: ${status} ${body}`);
  }
}

async function fiveSimFetch<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${process.env.FIVESIM_API_KEY}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new FiveSimError(path, response.status, body);
  }

  return response.json() as Promise<T>;
}

export function getProfile(): Promise<FiveSimProfile> {
  return fiveSimFetch<FiveSimProfile>("/user/profile");
}

// One call returns every product's price across every operator for the
// whole country — used to price the entire catalog grid without one
// request per service. For each product, collapses the operator list down
// to the single one selectBestOperator picks.
export async function getProductPrices(countryCode: string): Promise<FiveSimProductPrices> {
  const body = await fiveSimFetch<FiveSimGuestPricesResponse>(`/guest/prices?country=${countryCode}`);
  const countryBody = body[countryCode] ?? {};
  const result: FiveSimProductPrices = {};

  for (const [product, operators] of Object.entries(countryBody)) {
    const best = selectBestOperator(operators);
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
