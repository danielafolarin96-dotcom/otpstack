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
// Confirmed via a real diagnostic (Sept 2026): a TikTok/USA purchase from
// the cheapest operator (45% rate) never delivered its code, while a
// slightly pricier operator (80% rate) on the same product/country
// delivered cleanly on a direct test against 5sim's own site. 50 is a
// floor, not a target — high enough to exclude operators like that 45%
// one, low enough that most product/country pairs still have an eligible
// operator.
const MIN_ACCEPTABLE_DELIVERY_RATE = 50;

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
