import "server-only";

const OPEN_ER_API_URL = "https://open.er-api.com/v6/latest/USD";

interface OpenErApiResponse {
  result?: string;
  rates?: Record<string, number>;
}

// Pulled out from fetchUsdToNgnRate so the validation itself — a
// non-success result, a missing/non-numeric/non-positive NGN rate — is
// directly testable without mocking fetch, matching lib/5sim/client.ts's
// selectBestOperator. A bad response here must throw, not return a
// fallback: this feeds fx_rates, which the pricing engine treats as the
// live cost basis for every order.
export function parseUsdToNgnRate(body: OpenErApiResponse): number {
  if (body.result !== "success") {
    throw new Error(`open.er-api.com returned a non-success result: ${JSON.stringify(body)}`);
  }

  const rate = body.rates?.NGN;
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) {
    throw new Error(`open.er-api.com returned an invalid NGN rate: ${rate}`);
  }

  return rate;
}

// Free, keyless, no-signup USD-base rate API — confirmed reachable live
// (Sept 2026). Its rate-derivation methodology isn't documented by the
// provider; the one time it was compared live against Wise's mid-market
// quote it came in notably lower (closer to an official/interbank-style
// rate), so don't assume the two track identically.
export async function fetchUsdToNgnRate(): Promise<number> {
  const response = await fetch(OPEN_ER_API_URL, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`open.er-api.com request failed: ${response.status} ${response.statusText}`);
  }

  return parseUsdToNgnRate((await response.json()) as OpenErApiResponse);
}
