# OtpStack — System Architecture (ARCHITECTURE.md)

## Overview
OtpStack resells temporary phone numbers sourced from 5sim.net, priced in Nigerian Naira via a dynamic markup engine, funded through Paystack (card/bank transfer), spent from a wallet.

## Data model (Postgres / Supabase)

### `users` (Supabase Auth + profile extension)
- `id` (uuid, PK, = auth.users.id)
- `full_name`, `username` (unique), `email` (unique)
- `is_admin` (bool, default false)
- `is_frozen` (bool, default false)
- `created_at`

### `wallets`
- `user_id` (PK, FK → users.id)
- `balance_kobo` (bigint) — **derived/cached** from `wallet_transactions`; never written directly by app code
- `updated_at`

### `wallet_transactions` (append-only ledger — source of truth)
- `id` (uuid, PK)
- `user_id` (FK)
- `type` (enum: `topup`, `purchase`, `refund`, `admin_adjustment`)
- `amount_kobo` (bigint, signed — positive = credit, negative = debit)
- `reference` (text — Paystack ref or order id, unique per source event for idempotency)
- `order_id` (nullable FK → orders.id)
- `metadata` (jsonb)
- `created_at`

### `orders` (a rented number)
- `id` (uuid, PK)
- `user_id` (FK)
- `service_id` (FK → services)
- `country_code`
- `5sim_order_id` (text — upstream id)
- `phone_number` (text)
- `status` (enum: `pending`, `sms_received`, `expired_refunded`, `cancelled_refunded`, `banned`)
- `price_kobo` (bigint — what the user was charged)
- `upstream_cost_kobo` (bigint — our cost, snapshotted at purchase time for margin reporting)
- `otp_code` (text, nullable)
- `expires_at` (timestamptz — created_at + 10 minutes)
- `created_at`, `completed_at`

### `services` (curated catalog, not 5sim's full list)
- `id`, `name` (e.g. "WhatsApp"), `5sim_product_code`, `category`, `icon_key`, `is_active`

### `countries` (curated)
- `id`, `name`, `5sim_country_code`, `flag_emoji`, `is_active`

### `pricing_rules` (the markup engine's config)
- `id`
- `scope` (enum: `global`, `service`, `country`, `service_country`)
- `service_id` (nullable), `country_id` (nullable)
- `markup_type` (enum: `percent`, `flat_kobo`, `tiered`)
- `markup_value` (numeric, or jsonb for tiers — e.g. `[{"max_cost_kobo":.., "markup_pct":..}, ...]`)
- `min_margin_pct` (numeric — floor, e.g. 30)
- `priority` (int — service_country > service > country > global when resolving)
- `updated_at`

### `fx_rates`
- `pair` (e.g. `USD_NGN`), `rate`, `source`, `fetched_at`

### `admin_audit_log`
- `id`, `admin_id`, `action`, `target_type`, `target_id`, `reason`, `created_at`

## Pricing engine
1. Poll/refresh 5sim's price list for active services x countries on an interval (e.g. every 5-15 min), plus an on-demand check at purchase time, since 5sim prices and availability shift during the day.
2. For a given (service, country), resolve the most specific applicable `pricing_rules` row: service_country > service > country > global.
3. Compute a candidate NGN price: upstream_cost_ngn x (1 + markup_pct), or upstream_cost_ngn + flat_kobo, or per-tier if `tiered`.
4. Enforce `min_margin_pct` (30% target) as a floor — if the markup formula would yield less than the minimum margin, use the minimum-margin price instead.
5. Convert upstream cost (5sim's currency) to NGN using the latest `fx_rates` entry, refreshed regularly — never a hardcoded constant. `fx_rates` is append-only (no unique constraint on `pair`): refreshing means inserting a new row, and `fetchLatestFxRate` always reads the most recent one by `fetched_at`. Automated via `/api/cron/refresh-fx-rate` (`vercel.json`, daily), pulling USD_NGN from `open.er-api.com` — free, keyless, confirmed reachable live (Sept 2026), chosen over a mid-market quote (e.g. Wise) specifically for the automated path since it has a stable JSON endpoint rather than a scrapeable web page; its own rate came in noticeably lower than Wise's mid-market rate the one time both were compared, so don't assume the two track identically. If the upstream call fails or returns an implausible rate, the cron route errors without writing anything, so pricing keeps running off the last known-good rate rather than being poisoned by a bad response.
6. Recompute and cache displayed prices whenever the upstream price feed changes; always re-validate the exact price at the moment of purchase (it may have moved since page load) and reject/re-quote if it drifted materially.

## Order lifecycle
1. User selects service + country -> server checks wallet balance >= current price.
2. Server calls 5sim to purchase a number -> debits wallet (ledger entry, type=`purchase`) -> creates an `orders` row, `status=pending`, `expires_at = now() + 10 min`.
3. Server polls 5sim for SMS status (short interval, e.g. every 3-5s) until a code arrives or `expires_at` passes.
4. **Code arrives:** store `otp_code`, `status=sms_received`, `completed_at=now()`.
5. **No code by `expires_at`:** a scheduled job (Vercel Cron -> `/api/cron/expire-orders`) finds expired `pending` orders, cancels them upstream, sets `status=expired_refunded`, and writes a `refund` ledger entry crediting the wallet.
6. User can also manually cancel a still-`pending` order before expiry for the same refund treatment (`status=cancelled_refunded`).

## 5sim integration (verified against 5sim.net/docs, Sept 2026 — endpoint paths confirmed live)
- Base URL: `https://5sim.net/v1`
- Auth: `Authorization: Bearer $FIVESIM_API_KEY` header, `Accept: application/json`. The token is generated from the 5sim account: profile icon (top right) → "Get API key" — it's used directly as the bearer token, no separate OAuth exchange.
- **Open item to confirm before building:** 5sim's support docs mention two protocols — "5SIM protocol" (current) and "API1" (deprecated, for older integrations) — each with its own API key. The endpoints below are the classic `/v1/...` REST paths; confirm in the 5sim dashboard which protocol the generated key is issued for before wiring `lib/5sim/client.ts`, since the deprecated path may be phased out.

**Products & pricing**
| Endpoint | Method | Purpose |
|---|---|---|
| `/guest/countries` | GET | List available countries/operators |
| `/guest/products/{country}/{operator}` | GET | Available products + pricing for a country/operator |
| `/guest/prices?country=&product=` | GET | Full price list, per operator, with each operator's `cost`, `count` (stock), and `rate` (overall delivery success %, sometimes several windowed variants like `rate1`/`rate24`/`rate720`, sometimes omitted entirely) — used by `getProductPrices` in `lib/5sim/client.ts`, see the operator-selection rule below |

**Operator selection (confirmed, Sept 2026)** — `/guest/prices` nests operators under each product, and their reliability varies independently of cost. A real diagnostic purchase found the cheapest operator for a TikTok/USA number had only a 45% delivery rate and never delivered a code, while a slightly pricier operator on the same product/country had an 80% rate and delivered cleanly. `getProductPrices` therefore prefers reliability over raw cost: it excludes out-of-stock operators, then excludes any operator with a confirmed `rate` below 50% (a floor, not a target — chosen to exclude clearly-bad operators without starving most product/country pairs of an eligible one), then picks the cheapest of what's left. An operator with no `rate` field at all (5sim omits it for some operators regardless of stock — observed live) is treated as unproven rather than unreliable, so it isn't excluded by the floor. If every in-stock operator falls below the floor, the cheapest in-stock operator is used as a fallback rather than returning nothing. `purchaseNumber` (`lib/orders/purchase.ts`) buys from the exact operator this selection returns — not `"any"` — so the reliability check governs the number that's actually purchased, not just the displayed price.

**Purchase**
| Endpoint | Method | Purpose |
|---|---|---|
| `/user/buy/activation/{country}/{operator}/{product}` | GET | Buy an activation number (params: `forwarding`, `number`, `reuse`, `voice`, `ref`, `maxPrice`) |
| `/user/reuse/{product}/{number}` | GET | Repurchase a previously used number for the same product |

**Order management**
| Endpoint | Method | Purpose |
|---|---|---|
| `/user/check/{id}` | GET | Poll order status + retrieve received SMS |
| `/user/sms/inbox/{id}` | GET | Full SMS inbox for a rented number |
| `/user/finish/{id}` | GET | Mark order complete |
| `/user/cancel/{id}` | GET | Cancel a pending order (refund path) |
| `/user/ban/{id}` | GET | Ban a number that didn't work |

**Account**
| Endpoint | Method | Purpose |
|---|---|---|
| `/user/profile` | GET | Account balance + rating — poll this for the admin panel's "5sim balance" widget |
| `/user/orders` | GET | Order history (params: `category`, `limit`, `offset`, `order`, `reverse`) |

**Rate limits:** ~100 requests/second per IP and per API key; buy operations are more tightly throttled — the purchase flow and the SMS-polling job should both have backoff/retry handling, not tight loops.

**Status values:** 5sim's `check` endpoint returns a status string per order (commonly `PENDING`, `RECEIVED`, `CANCELED`, `TIMEOUT`, `FINISHED`, `BANNED` in their ecosystem) — confirm the exact set and casing with a live test call early in Phase 4, then map it to our internal `orders.status` enum rather than storing 5sim's raw string directly.
- 5sim does not push webhooks for SMS arrival — our own polling job (hitting `/user/check/{id}`) is the source of truth for "did the code arrive yet."

Sources: [5SIM API Docs](https://5sim.net/docs), [Working with API](https://5sim.net/support/working-with-api)

## Paystack integration
- Funding flow: client requests a top-up -> server creates a Paystack transaction (amount in kobo, minimum ₦500) -> client is redirected to Paystack's hosted checkout -> Paystack sends a signed webhook on completion -> server verifies signature, checks idempotency by reference, credits the wallet via a ledger entry (type=`topup`).
- The client-side "payment successful" redirect only triggers a status refresh/poll — it never credits the wallet itself.

## Currency
- User-facing wallet balance and prices: NGN only, integer kobo internally.
- 5sim cost basis: tracked in its native pricing, converted via `fx_rates` at computation time — never a hardcoded constant, since both the naira/dollar rate and 5sim's own prices drift.

## Admin panel (data needs)
- All orders (filterable by status/user/service), all wallet transactions, current 5sim account balance (server-side check, so the founder knows when to top up upstream), user list with freeze/unfreeze, manual refund action (writes ledger + audit log), pricing rule editor.
