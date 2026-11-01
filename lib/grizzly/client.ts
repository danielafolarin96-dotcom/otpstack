import "server-only";
import { parseGetStatus, parseGetStatusV2, type GrizzlyActivationState } from "./status";

// Grizzly SMS — SMS-Activate-compatible API, docs at
// https://grizzlysms.com/docs (fetched 29 Oct 2026). Verified live the same
// day with read-only calls on our account: getBalance ("ACCESS_BALANCE:3.0000",
// text/plain), getCountries, getServicesList, and getPricesV3 with and
// without `country` (JSON, shape below). getNumberV2 / getStatus /
// getStatusV2 / setStatus shapes are from the docs only — not yet observed
// live; confirm on the first real test purchase.
//
// Every call is a GET to one handler with the key as the `api_key` query
// parameter. Because the key rides in the URL, this file never puts a URL
// into an error or log line: GrizzlyError carries the action name, HTTP
// status and response body only, and scrubs the key from the body too in
// case a response ever echoes it.
const BASE_URL = "https://api.grizzlysms.com/stubs/handler_api.php";

// getNumberV2 also returns a `currency` field (an ISO 4217 numeric code in
// the docs' example: 840). It does NOT describe what our account is charged
// in: the first live purchase (1 Nov 2026, activation 688865291) returned
// currency 643 (RUB) with activationCost 0.01, while our USD balance moved
// by exactly $0.01 (3.00 -> 2.99, back to 3.00 on cancel). activationCost
// is in the account currency (USD); `currency` is logged, never trusted or
// gated on (product decision, 1 Nov 2026).

const ERROR_BODY_MAX_LENGTH = 300;

// Pulls an activation id out of a getNumber/getNumberV2 response we
// otherwise couldn't use (unparseable, missing fields, non-2xx) — if one is
// there, Grizzly may have reserved a number for us that must be cancelled.
// Accepts the V2 JSON field and the v1 "ACCESS_NUMBER:<id>:<phone>" form.
export function extractActivationId(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { activationId?: unknown };
    const id = parsed?.activationId;
    if ((typeof id === "number" && Number.isInteger(id)) || (typeof id === "string" && /^\d+$/.test(id))) {
      return String(id);
    }
  } catch {
    // not JSON — fall through to the text patterns
  }
  return (
    /"activationId"\s*:\s*"?(\d+)/.exec(body)?.[1] ?? /ACCESS_NUMBER:(\d+)/.exec(body)?.[1] ?? undefined
  );
}

export class GrizzlyError extends Error {
  public body: string;
  // getNumber* only: an activation id found in the failed response.
  public activationId?: string;

  // `body` may be the full response; it's truncated here, after the
  // activation id (if any) has been read from the whole thing.
  constructor(
    public action: string,
    public status: number,
    body: string,
  ) {
    const truncated = body.slice(0, ERROR_BODY_MAX_LENGTH);
    super(`grizzly ${action} failed: ${status} ${truncated}`);
    this.body = truncated;
    if (action.startsWith("getNumber")) this.activationId = extractActivationId(body);
  }
}

export function redactGrizzlyKey(text: string): string {
  const key = process.env.GRIZZLY_API_KEY;
  return key ? text.split(key).join("[redacted]") : text;
}

async function grizzlyFetch(params: Record<string, string>): Promise<string> {
  const action = params.action;
  const url = new URL(BASE_URL);
  url.searchParams.set("api_key", process.env.GRIZZLY_API_KEY ?? "");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch (err) {
    // A network-level failure: report the error's own message, never the URL.
    const message = err instanceof Error ? err.message : String(err);
    throw new GrizzlyError(action, 0, redactGrizzlyKey(message).slice(0, ERROR_BODY_MAX_LENGTH));
  }

  const body = redactGrizzlyKey((await response.text()).trim());
  if (!response.ok) {
    throw new GrizzlyError(action, response.status, body);
  }
  return body;
}

// Errors (NO_NUMBERS, NO_BALANCE, BAD_KEY, ...) come back as HTTP 200 plain
// text where JSON was expected — same trap as 5sim's "no free phones" (see
// lib/5sim/client.ts) — so the body is parsed here, and anything that
// isn't JSON becomes a GrizzlyError carrying that text.
async function grizzlyJson<T>(params: Record<string, string>): Promise<T> {
  const body = await grizzlyFetch(params);
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new GrizzlyError(params.action, 200, body);
  }
}

// ── prices ──────────────────────────────────────────────────────────────

// One Grizzly supplier ("provider" in Grizzly's API, e.g. 438) for one
// service in one country. Grizzly lists several price steps per supplier
// but a single stock count, so we quote the HIGHEST step (product decision,
// 29 Oct 2026): sent as maxPrice, it means a purchase always fills inside
// our quote instead of failing with NO_NUMBERS when the cheapest step has
// sold out. What Grizzly actually charges is recorded separately.
export interface GrizzlySupplier {
  supplierId: string;
  count: number;
  prices: number[];
  cost: number;
}

// For one service: Grizzly country id -> its suppliers. A country Grizzly
// doesn't list for the service is absent; one it lists with no suppliers
// maps to [].
export type GrizzlyServicePrices = Record<string, GrizzlySupplier[]>;

type RawProvider = { count?: unknown; price?: unknown; provider_id?: unknown };
type RawPricesV3 = Record<string, Record<string, { price?: unknown; count?: unknown; providers?: Record<string, RawProvider> | RawProvider[] }>>;

function toNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

// getPricesV3: { "<country>": { "<service>": { price, count, providers: {
// "<id>": { count, price: [p1, p2], provider_id } } } }. The top-level
// `price` is Grizzly's headline "from" price, which often has almost no
// stock (seen 29 Oct: headline $0.026, real purchase $0.52), so only the
// per-supplier data is used. An empty providers set can arrive as [] (PHP
// JSON), and `price` may be a bare number rather than an array.
export function parsePricesV3(body: RawPricesV3, service: string): GrizzlyServicePrices {
  const result: GrizzlyServicePrices = {};
  for (const [countryId, services] of Object.entries(body ?? {})) {
    const entry = services?.[service];
    if (!entry) continue;
    const providers = Array.isArray(entry.providers) ? {} : (entry.providers ?? {});
    const suppliers: GrizzlySupplier[] = [];
    for (const [key, raw] of Object.entries(providers)) {
      const count = toNumber(raw?.count) ?? 0;
      const priceList = (Array.isArray(raw?.price) ? raw.price : [raw?.price])
        .map(toNumber)
        .filter((p): p is number => p !== null && p > 0);
      if (priceList.length === 0) continue;
      suppliers.push({
        supplierId: String(raw?.provider_id ?? key),
        count,
        prices: priceList,
        cost: Math.max(...priceList),
      });
    }
    result[countryId] = suppliers;
  }
  return result;
}

// 60s in-process cache of one service's prices across every country (one
// call without `country` returns them all — verified live 29 Oct), for the
// catalog grid and dashboard search only, same contract as 5sim's
// getProductPrices cache (lib/5sim/client.ts). The picker and purchase use
// getSupplierPrices below, which is always fresh.
export const GRIZZLY_PRICES_CACHE_TTL_MS = 60_000;
const pricesCache = new Map<string, { expiresAt: number; body: Promise<GrizzlyServicePrices> }>();

export function getCachedServicePrices(service: string): Promise<GrizzlyServicePrices> {
  const now = Date.now();
  const hit = pricesCache.get(service);
  if (hit && hit.expiresAt > now) return hit.body;

  const body = grizzlyJson<RawPricesV3>({ action: "getPricesV3", service }).then((raw) => parsePricesV3(raw, service));
  pricesCache.set(service, { expiresAt: now + GRIZZLY_PRICES_CACHE_TTL_MS, body });
  body.catch(() => {
    if (pricesCache.get(service)?.body === body) pricesCache.delete(service);
  });
  return body;
}

// Test-only: the cache is module state.
export function clearGrizzlyPricesCache() {
  pricesCache.clear();
}

// Fresh suppliers for one (service, country) — the operator picker and
// purchaseNumber's re-validation. null = Grizzly doesn't list it at all.
export async function getSupplierPrices(service: string, countryId: number): Promise<GrizzlySupplier[] | null> {
  const raw = await grizzlyJson<RawPricesV3>({ action: "getPricesV3", service, country: String(countryId) });
  return parsePricesV3(raw, service)[String(countryId)] ?? null;
}

// Recommended needs at least this much stock. Grizzly gives no delivery
// rates, so until our own per-supplier delivery data exists (see
// orders.provider_supplier_id) the rule is: cheapest supplier with stock >= 20.
export const GRIZZLY_RECOMMENDED_MIN_STOCK = 20;

export interface RankedSuppliers {
  // null only when options is empty.
  recommended: GrizzlySupplier | null;
  // In stock, cheapest first (ties: more stock first, then supplier id).
  options: GrizzlySupplier[];
}

export function rankSuppliers(suppliers: GrizzlySupplier[]): RankedSuppliers {
  const options = suppliers
    .filter((s) => s.count > 0 && s.cost > 0)
    .sort((a, b) => a.cost - b.cost || b.count - a.count || a.supplierId.localeCompare(b.supplierId));
  const recommended = options.find((s) => s.count >= GRIZZLY_RECOMMENDED_MIN_STOCK) ?? options[0] ?? null;
  return { recommended, options };
}

// ── purchase ────────────────────────────────────────────────────────────

export interface GrizzlyActivation {
  activationId: string;
  phoneNumber: string;
  activationCost: number;
  currency: number | null;
  activationTime: string | null;
}

// getNumberV2 with providerIds=<one supplier> and maxPrice=<our quote>, so
// Grizzly can only sell from the supplier the customer chose and never
// above the price we quoted them. Documented success body:
// {"activationId":38496653,"phoneNumber":"66846426435","activationCost":12.34,
//  "currency":840,"countryCode":"2","canGetAnotherSms":"1","activationTime":"2025-12-31 23:30:55"}
// Errors arrive as plain text (NO_NUMBERS, NO_BALANCE, BAD_KEY, ...).
export async function buyActivation(params: {
  service: string;
  countryId: number;
  supplierId: string;
  maxPrice: number;
}): Promise<GrizzlyActivation> {
  const action = "getNumberV2";
  const raw = await grizzlyJson<Record<string, unknown>>({
    action,
    service: params.service,
    country: String(params.countryId),
    providerIds: params.supplierId,
    maxPrice: String(params.maxPrice),
  });
  const activationId = raw.activationId;
  const phoneNumber = raw.phoneNumber;
  const activationCost = toNumber(raw.activationCost);
  if ((typeof activationId !== "number" && typeof activationId !== "string") || typeof phoneNumber !== "string" || activationCost === null) {
    throw new GrizzlyError(action, 200, JSON.stringify(raw));
  }
  return {
    activationId: String(activationId),
    phoneNumber: phoneNumber.startsWith("+") ? phoneNumber : `+${phoneNumber}`,
    activationCost,
    currency: toNumber(raw.currency),
    activationTime: typeof raw.activationTime === "string" ? raw.activationTime : null,
  };
}

// Customer-facing message for a failed purchase. The raw Grizzly text is
// never shown: NO_BALANCE is about OUR Grizzly account, not the customer's
// wallet (same reasoning as lib/5sim/client.ts's message map).
export function customerFacingGrizzlyPurchaseMessage(body: string): string {
  return body.trim() === "NO_NUMBERS"
    ? "No numbers currently available for this service/country — try again shortly or pick a different country."
    : "Something went wrong purchasing this number — please try again.";
}

// ── activation status ───────────────────────────────────────────────────

// See lib/grizzly/status.ts for why getStatus drives the state and
// getStatusV2 is only asked for the SMS details (text, dateTime). A
// failing getStatusV2 still returns the code getStatus already gave.
export async function getActivationState(activationId: string): Promise<GrizzlyActivationState> {
  const body = await grizzlyFetch({ action: "getStatus", id: activationId });
  const state = parseGetStatus(body);
  if (!state) throw new GrizzlyError("getStatus", 200, body.slice(0, ERROR_BODY_MAX_LENGTH));
  if (state.state !== "received") return state;

  try {
    const details = parseGetStatusV2(await grizzlyFetch({ action: "getStatusV2", id: activationId }));
    if (details) {
      return {
        state: "received",
        code: details.code ?? state.code,
        text: details.text,
        smsDateTime: details.dateTime,
      };
    }
  } catch (err) {
    console.error(`Grizzly getStatusV2 failed for activation ${activationId} — using getStatus code:`, err);
  }
  return state;
}

// setStatus=8 cancels an activation. Only ACCESS_CANCEL counts as success.
// Grizzly refuses cancels for ~5 minutes after purchase (observed live 29
// Oct; the refusal text isn't documented — SMS-Activate's convention is
// EARLY_CANCEL_DENIED), so every other answer throws and callers decide
// whether to queue a retry (lib/orders/upstream-cancel.ts).
export async function cancelActivation(activationId: string): Promise<void> {
  const body = await grizzlyFetch({ action: "setStatus", status: "8", id: activationId });
  if (body !== "ACCESS_CANCEL") throw new GrizzlyError("setStatus", 200, body.slice(0, ERROR_BODY_MAX_LENGTH));
}

// setStatus=6 completes an activation after its code was delivered.
// Best-effort only: Grizzly charges when the SMS arrives either way.
export async function finishActivation(activationId: string): Promise<void> {
  const body = await grizzlyFetch({ action: "setStatus", status: "6", id: activationId });
  if (body !== "ACCESS_ACTIVATION") throw new GrizzlyError("setStatus", 200, body.slice(0, ERROR_BODY_MAX_LENGTH));
}

// ── account ─────────────────────────────────────────────────────────────

// "ACCESS_BALANCE:3.0000" (verified live 29 Oct 2026), USD.
export async function getBalance(): Promise<number> {
  const body = await grizzlyFetch({ action: "getBalance" });
  const match = /^ACCESS_BALANCE:([\d.]+)$/.exec(body);
  const balance = match ? Number(match[1]) : NaN;
  if (!Number.isFinite(balance)) throw new GrizzlyError("getBalance", 200, body.slice(0, ERROR_BODY_MAX_LENGTH));
  return balance;
}
