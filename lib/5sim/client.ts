import "server-only";

// Verified live against a real 5sim account (Sept 2026) while building
// this file: GET /user/profile, GET /guest/countries,
// GET /guest/products/{country}/any, and one real $0.0897 test purchase
// (buy -> check -> cancel) on GET /user/buy/activation/nigeria/any/microsoft.
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

export type FiveSimProductPrices = Record<string, { Category: string; Qty: number; Price: number }>;

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

// One call returns every product's current price for the whole country —
// used to price the entire catalog grid without one request per service.
export function getProductPrices(countryCode: string): Promise<FiveSimProductPrices> {
  return fiveSimFetch<FiveSimProductPrices>(`/guest/products/${countryCode}/any`);
}

// operator "any" lets 5sim pick — confirmed working in the live test
// purchase (it returned a real virtual2 number).
export function buyActivation(countryCode: string, productCode: string): Promise<FiveSimOrder> {
  return fiveSimFetch<FiveSimOrder>(`/user/buy/activation/${countryCode}/any/${productCode}`);
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
