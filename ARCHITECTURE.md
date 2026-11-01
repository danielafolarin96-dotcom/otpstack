# OtpStack — System Architecture (ARCHITECTURE.md)

## Overview
OtpStack resells temporary phone numbers sourced from 5sim.net and Grizzly SMS (see "Providers & routing"), priced in Nigerian Naira via a dynamic markup engine, funded through Paystack (card/bank transfer), spent from a wallet.

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
- `provider` (text, `5sim` | `grizzly`) — which upstream sold the number, resolved from `provider_routes` at purchase time
- `provider_order_id` (text — the upstream id for `provider`: 5sim order id or Grizzly activationId; unique per provider). Use this for every upstream call.
- `fivesim_order_id` (text, nullable — legacy 5sim-only copy of `provider_order_id`; null for Grizzly orders)
- `fivesim_operator`, `fivesim_operator_rate` (5sim only — operator bought from and the rate it was judged on)
- `provider_supplier_id`, `upstream_quoted_usd`, `upstream_charged_usd`, `upstream_activation_time` (Grizzly only — supplier bought from, the quote sent as `maxPrice`, what Grizzly actually charged, and Grizzly's own activationTime)
- `upstream_cancel_succeeded`, `upstream_cancel_error` (refunded orders — whether the upstream cost was recovered, and the provider's error if our cancel failed)
- `phone_number` (text)
- `status` (enum: `pending`, `sms_received`, `expired_refunded`, `cancelled_refunded`, `banned`)
- `price_kobo` (bigint — what the user was charged)
- `upstream_cost_kobo` (bigint — our cost, snapshotted at purchase time for margin reporting)
- `otp_code` (text, nullable)
- `expires_at` (timestamptz — created_at + 5 minutes)
- `created_at`, `completed_at`

### `services` (curated catalog, not 5sim's full list)
- `id`, `name` (e.g. "WhatsApp"), `5sim_product_code`, `category`, `icon_key`, `is_active`
- `provider` (default `5sim` — the fallback when no `provider_routes` row applies)
- `grizzly_service_code` (nullable — explicit Grizzly mapping, e.g. `wa`; null = never bought from Grizzly)

### `countries` (curated)
- `id`, `name`, `5sim_country_code`, `flag_emoji`, `is_active`
- `grizzly_country_id` (nullable, unique — explicit Grizzly mapping, e.g. 187; null = this country stays on 5sim)

### `provider_routes` (which provider sells a service, optionally per country)
- `service_id`, `country_id` (nullable = any country), `provider`, `is_active`, `note`; unique per (service, country)

### `upstream_cancel_queue` (Grizzly cancels waiting out the ~5-minute lock)
- `provider`, `provider_order_id` (unique together), `order_id` (nullable), `reason` (`price_above_quote` | `order_record_failed` | `cancel_locked`), `not_before`, `give_up_at`, `attempts`, `last_error`, `resolved_at`, `outcome` (`cancelled` | `already_closed` | `sms_arrived` | `gave_up`)

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
4. Enforce `min_margin_pct` (30% floor) as a floor — if the markup formula would yield less than the minimum margin, use the minimum-margin price instead. This is a floor, not a target: the current standing target (since 2026-10-22) is a 100% markup — price = 2x 5sim cost, i.e. 50% margin — on every `pricing_rules` row (global tiers, country, service, and service_country alike), well above the 30% floor, which with every rule at 100% never binds and stays only as a safety net. See `supabase/migrations/20261022120000_reprice_to_50pct_margin_everywhere.sql`. There are no exclusions any more: the four flat_kobo service_country overrides (WhatsApp/USA, WhatsApp/Australia, Telegram/UK, TikTok/UK) were converted to the same percent markup, since their flat add-ons let the margin sink to the 30-40% floor whenever 5sim's cost rose. (This replaced the earlier 80.83% markup / ~44.7% margin target from `20260920120000_reprice_to_44_7pct_standing_margin.sql`, which `scripts/apply-margin-reprice.mjs` applied — that script is historical and still describes the 44.7% reprice.)
5. Convert upstream cost (5sim's currency) to NGN using the latest `fx_rates` entry, refreshed regularly — never a hardcoded constant. `fx_rates` is append-only (no unique constraint on `pair`): refreshing means inserting a new row, and `fetchLatestFxRate` always reads the most recent one by `fetched_at`. Automated via `/api/cron/refresh-fx-rate` (`vercel.json`, daily), pulling USD_NGN from `open.er-api.com` — free, keyless, confirmed reachable live (Sept 2026), chosen over a mid-market quote (e.g. Wise) specifically for the automated path since it has a stable JSON endpoint rather than a scrapeable web page; its own rate came in noticeably lower than Wise's mid-market rate the one time both were compared, so don't assume the two track identically. If the upstream call fails or returns an implausible rate, the cron route errors without writing anything, so pricing keeps running off the last known-good rate rather than being poisoned by a bad response. **Funding rate (28 Oct 2026):** the rate actually used is `max(latest market USD_NGN, latest provider_funding_rates row for the service's provider)` (`effectiveFxRate` in `lib/pricing/engine.ts`) — our real cost of topping up a provider, fees included, is above market (₦1,562 vs ~₦1,353 at the time, seeded for both `5sim` and `grizzly`). A provider with no row prices at market. `provider_funding_rates` is versioned: insert a new row with a later `effective_from` to change it, never update. `orders.upstream_cost_kobo` uses the same effective rate so profit reports reflect real cost. The daily FX cron is unchanged.
6. Recompute and cache displayed prices whenever the upstream price feed changes; always re-validate the exact price at the moment of purchase (it may have moved since page load) and reject/re-quote if it drifted materially.

## Order lifecycle
1. User selects service + country -> server checks wallet balance >= current price.
2. Server resolves the provider (`provider_routes`), calls it to purchase a number -> debits wallet (ledger entry, type=`purchase`) -> creates an `orders` row, `status=pending`, `expires_at = now() + 5 min`.
3. Server polls the provider for SMS status (short interval, e.g. every 3-5s) until a code arrives or `expires_at` passes. A QStash one-shot callback (see `lib/qstash/client.ts`) is also scheduled at purchase time to hit `/api/cron/expire-orders` shortly after `expires_at`, so the sweep below runs promptly per-order instead of waiting on a slower backstop.
4. **Code arrives:** store `otp_code`, `status=sms_received`, `completed_at=now()`.
5. **No code by `expires_at`:** a scheduled sweep (`/api/cron/expire-orders`) finds expired `pending` orders, first re-checks upstream (an SMS that arrived inside the window is delivered instead of refunded), then cancels them upstream, sets `status=expired_refunded`, and writes a `refund` ledger entry crediting the wallet. If the cancel fails but the provider shows the order already closed with no SMS, the cost still counts as recovered (`upstream_cancel_succeeded = true`, error kept). A Grizzly cancel that hits Grizzly's lock is queued in `upstream_cancel_queue` and retried; a later success writes a `provider_cost_recovered` finance event. Triggered on a layered set of schedules, not Vercel Cron alone — see that route's own comment for why (Vercel's Hobby plan only allows a once-daily cron, far too infrequent against this 5-minute TTL, see the 5sim integration section below).
6. User can also manually cancel a still-`pending` 5sim order before expiry for the same refund treatment (`status=cancelled_refunded`). Grizzly orders can't be cancelled by the customer (Grizzly locks cancel for the whole 5-minute hold): the cancel route returns 409 and the dashboard shows "Refunds automatically if no code arrives" instead of the button.

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

**Operator selection (confirmed, Sept 2026; floor raised Sept 2026; hard floor added Sept 24 2026)** — `/guest/prices` nests operators under each product, and their reliability varies independently of cost. A real diagnostic purchase found the cheapest operator for a TikTok/USA number had only a 45% delivery rate and never delivered a code, while a slightly pricier operator on the same product/country had an 80% rate and delivered cleanly. `getProductPrices` therefore prefers reliability over raw cost: it excludes out-of-stock operators, then excludes any operator with a confirmed `rate` below 70% (`MIN_ACCEPTABLE_DELIVERY_RATE` in `lib/5sim/client.ts` — raised from an initial 50, which was justified by only that one diagnostic; 70 is still an interim conservative value given the two known data points, not a data-derived optimum), then picks the cheapest of what's left. An operator with no `rate` field at all (5sim omits it for some operators regardless of stock — observed live) is treated as unproven rather than unreliable, so it isn't excluded by the floor. By default, if every in-stock operator falls below the floor, the cheapest in-stock operator is used as a fallback rather than returning nothing — confirmed via a live catalog-wide simulation (Sept 2026, ~20.5k active product/country combos) that raising 50→70 changes the actually-purchased operator in ~0.8% of combos and pushes ~0.6% more into that fallback path; see the floor-change commit for the full breakdown. `orders.fivesim_operator` / `orders.fivesim_operator_rate` record what was actually used per order, specifically so this floor can be re-tuned against real delivery outcomes instead of guessed again. `purchaseNumber` (`lib/orders/purchase.ts`) buys from the exact operator this selection returns — not `"any"` — so the reliability check governs the number that's actually purchased, not just the displayed price.

usa/whatsapp briefly (2026-09-23 to 2026-09-24) had a hardcoded pin to a specific operator ("worth the cost premium regardless of rate") after its live rate proved too volatile for the floor alone to produce a stable customer-facing price. A 2026-09-24 audit of the live `orders` table found the pin hadn't solved the underlying problem: it was refunding roughly half its orders. The same audit found usa/telegram — which had no route-specific handling at all — was refunding 6 of 7 orders, every one of them via an operator whose recorded rate at purchase time was under 30%, well below the 70% floor, because the general fallback above was quietly selling through it anyway. Both routes are now in `HARD_RELIABILITY_FLOOR_ROUTES` (`lib/5sim/client.ts`): unlike every other product/country combo, they never fall back to a below-floor operator — `selectOperatorForRoute` returns null (product unavailable) instead. `computeCatalogPrices` already renders that as "price unavailable" and `purchaseNumber` already 409s with "not currently available in `<country>`", so no other code changed. This trades order volume for avoiding refund losses on these two routes specifically; whether it should extend to other routes is an open question pending more `orders.fivesim_operator_rate` data.

malaysia/whatsapp was added to the same set on 2026-09-24, pre-emptively rather than in response to refunds — it has zero historical orders. A live check found the same underlying shape anyway: its only in-stock operator (virtual34) has a 0% delivery rate across every window 5sim reports, and the general fallback would have silently sold through it the first time anyone bought the route. Checking a route's live `/guest/prices` shape before it accumulates refund history — not just after — is now the expected practice for any route that looks similarly thin (one in-stock operator, well under 70%) before adding it here.

**Current rule (Oct 2026):** the model above was later replaced by a customer-facing operator picker (see `rankOperators` in `lib/5sim/client.ts`): the floor is `MIN_ACCEPTABLE_RATE` = 20 with no fallback and no per-route blocks. Since 2026-10-22 the floor and the ranking are both judged on 5sim's 7-day `rate168` when present, falling back to the overall `rate` when it's missing (neither = unrated, not excluded); that judged value is what `orders.fivesim_operator_rate` stores. `rate168` was added on the user's instruction and its presence on live `/guest/prices` responses hasn't been independently confirmed here. The catalog grid and dashboard search read `/guest/prices?country=` through a 60-second in-process cache (`getProductPrices`); the operator picker and purchase re-validation (`getOperatorPrices`) always fetch fresh.

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
- **Cancel/hold window (Sept 2026, corrected 29 Oct 2026):** 5sim's own docs (`/docs`, "Buy activation number" -> Request limits) state "Maximum waiting time is 15 minutes. Timeout no sms 5 minute" — an activation order auto-transitions to `TIMEOUT` upstream around 5 minutes after purchase if no SMS has arrived, and from then on `/user/cancel/{id}` fails (`400 order expired`). In Sept 2026 that was read as "the upstream cost is not recoverable", and the customer-facing TTL was cut from 10 to 3 minutes so our cancel would land first. **That reading was wrong:** a read-only reconciliation of 5sim's own payment history (`/user/payments`, all 29 rows 9 Sept-27 Oct, balance chain unbroken) against `/user/orders` on 29 Oct 2026 showed 5sim debits an order only when it is FINISHED (26 `buy` rows = the 26 FINISHED orders, each debited at close), and none of the 5 TIMEOUT-with-no-SMS orders — including `1090837536`, which the 14 Sept backfill marked as lost — has any debit. So a 5sim order that times out with no SMS costs us nothing. The TTL is therefore 5 minutes for both providers (`ORDER_TTL_MINUTES`, `lib/orders/purchase.ts`; QStash callback at TTL + 10s), and the refund paths record a failed cancel on a TIMEOUT/CANCELED-with-no-SMS order as cost recovered. Historical orders were not backfilled, so the Margin page still counts some pre-29-Oct TIMEOUT refunds as lost. The sweep-frequency fix (see `.github/workflows/expire-orders.yml` and the cron route's comment) remains the backstop for when the QStash callback doesn't land.

Sources: [5SIM API Docs](https://5sim.net/docs), [Working with API](https://5sim.net/support/working-with-api)

## Providers & routing (29 Oct 2026)
- Two providers: 5sim and Grizzly SMS. `lib/providers/route.ts` (`pickProvider`) decides per (service, country): an active `provider_routes` row for that exact (service, country), else an active (service, any-country) row, else `services.provider`. A Grizzly result falls back to 5sim only when the service has no `grizzly_service_code` or the country no `grizzly_country_id` — there is no stock-based fallback; a Grizzly-routed product with no Grizzly stock shows as unavailable.
- Seeded by `supabase/migrations/20261029120000_add_grizzly_provider.sql`: WhatsApp, Telegram, TikTok, Facebook, Instagram and Google -> Grizzly (any country), plus 41 per-country rows back to 5sim for pairs where 5sim had stock and Grizzly didn't (live snapshot 29 Oct 2026; revisit as stock moves). Kill switch: set the six any-country rows `is_active = false`.
- Mapping (reviewed 29 Oct 2026): services `wa`/`tg`/`lf`/`fb`/`ig`/`go`; 78 of 80 countries mapped by name (Argentina = 39 "Argentinas", Czechia = 63 "Czech", UK = 16, USA = **187 only** — Grizzly's 12 "USA (2)" virtual pool is deliberately unmapped). Congo (Grizzly has both 18 "DR Congo" and 150 "Republic of the Congo") and Namibia (not listed) are unmapped.
- `lib/providers/upstream.ts` gives the status poll, manual cancel, expiry, admin refund and the cancel queue one provider-neutral view (`fetchUpstreamState`, `cancelUpstream`, `finishUpstream`). `orders.provider` is what every later step dispatches on.
- Pricing: Grizzly costs are USD, converted at `effectiveFxRate(rates, 'grizzly')` (`provider_funding_rates` 'grizzly' = 1562), through the same `pricing_rules` (100% markup).

## Grizzly integration (verified against grizzlysms.com/docs, 29 Oct 2026)
- Base: `https://api.grizzlysms.com/stubs/handler_api.php?api_key=$GRIZZLY_API_KEY&action=...` (SMS-Activate compatible). The key rides in the query string, so `lib/grizzly/client.ts` never puts a URL into an error or log and scrubs the key from response bodies.
- Verified live (read-only, 29 Oct): `getBalance` -> `ACCESS_BALANCE:3.0000` (text/plain, USD); `getCountries`; `getServicesList`; `getPricesV3` with and without `country` (without it, one call returns every country for the service). Shape: `{country:{service:{price,count,providers:{id:{count, price:[steps], provider_id}}}}}` — the top-level `price` is a headline "from" price with little stock and is ignored.
- From the docs only, **not yet observed live** (confirm on the first real test purchase): `getNumberV2` -> `{activationId, phoneNumber, activationCost, currency, countryCode, canGetAnotherSms, activationTime}` (live 1 Nov 2026: `currency` came back **643** while the USD balance moved by exactly `activationCost`, so `activationCost` is in the account currency (USD) and `currency` is only logged, never gated on); errors as plain text (`NO_NUMBERS`, `NO_BALANCE`, `BAD_KEY`, `SERVICE_UNAVAILABLE_REGION`, ...). `getStatus` -> `STATUS_WAIT_CODE` / `STATUS_WAIT_RETRY:x` / `STATUS_WAIT_RESEND` / `STATUS_CANCEL` / `STATUS_OK:code`. `getStatusV2` -> `{verificationType, sms:{dateTime, code, text}}` (only the received case is documented). `setStatus` 8 = cancel (`ACCESS_CANCEL`), 6 = complete (`ACCESS_ACTIVATION`). The early-cancel refusal text is undocumented (SMS-Activate convention: `EARLY_CANCEL_DENIED`); any non-`ACCESS_CANCEL` answer is treated as "not cancelled".
- Confirmed by a manual test on the Grizzly site (29 Oct 2026): cancel is locked for roughly the first 5 minutes; activations last 20 minutes; Grizzly only debits when an SMS arrives — a cancelled unused number returns the full hold.
- **Suppliers ("Operator N"):** each supplier in stock for the service/country is one picker option, priced at its **highest** listed price step (product decision — sent as `maxPrice`, so the purchase always fills inside the quote). Sorted cheapest first; recommended = cheapest supplier with stock >= 20 (`GRIZZLY_RECOMMENDED_MIN_STOCK`), else the cheapest in stock. Grizzly reports no delivery rates; `orders.provider_supplier_id` exists so our own delivery rate per supplier can be measured.
- **Purchase:** `getNumberV2` with `providerIds=<supplier>` and `maxPrice=<quote>`. If `activationCost` exceeds the quote, the customer is not debited and the activation is queued for cancel after the lock. `upstream_cost_kobo` = `activationCost` x funding rate. Failures map to `purchase_failures.reason`: `NO_BALANCE` -> `provider_balance`, `NO_NUMBERS` -> `upstream_no_numbers`, anything else -> `other`.
- **Status:** `getStatus` drives the state; on `STATUS_OK` `getStatusV2` supplies the SMS text and `dateTime`. A delivered code is completed with `setStatus 6` (best-effort). SMS punctuality is judged on Grizzly's own clock (`sms.dateTime - activationTime`, added to our `created_at`), since Grizzly's timezone is undocumented. `STATUS_CANCEL` during a poll refunds with the cost recorded as recovered.
- **Cancel queue** (`lib/orders/upstream-cancel-queue.ts`): abandoned purchases wait `GRIZZLY_CANCEL_LOCK_SECONDS` (330s); expiry cancels refused by the lock retry every 60s via a QStash call to `/api/cron/expire-orders?queue=1`, and every sweep also processes due rows. A row resolves when the cancel lands (`cancelled`), the activation is already cancelled (`already_closed`), an SMS arrived (`sms_arrived` — a real loss), or after 30 minutes (`gave_up`).
- Rate limits: undocumented. The dashboard polls each pending order every 4s (one `getStatus` call; two once a code arrives).

## Paystack integration
- Funding flow: client requests a top-up -> server creates a Paystack transaction (amount in kobo, minimum ₦500) -> client is redirected to Paystack's hosted checkout -> Paystack sends a signed webhook on completion -> server verifies signature, checks idempotency by reference, credits the wallet via a ledger entry (type=`topup`).
- The client-side "payment successful" redirect only triggers a status refresh/poll — it never credits the wallet itself.

## Currency
- User-facing wallet balance and prices: NGN only, integer kobo internally.
- 5sim cost basis: tracked in its native pricing, converted via `fx_rates` at computation time — never a hardcoded constant, since both the naira/dollar rate and 5sim's own prices drift.

## Admin panel (data needs)
- All orders (filterable by status/user/service), all wallet transactions, current 5sim account balance (server-side check, so the founder knows when to top up upstream), user list with freeze/unfreeze, manual refund action (writes ledger + audit log), pricing rule editor.
