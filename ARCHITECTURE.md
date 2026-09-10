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
- `min_margin_pct` (numeric — floor, e.g. 60)
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
4. Enforce `min_margin_pct` (60% target) as a floor — if the markup formula would yield less than the minimum margin, use the minimum-margin price instead.
5. Convert upstream cost (5sim's currency) to NGN using the latest `fx_rates` entry, refreshed regularly — never a hardcoded constant.
6. Recompute and cache displayed prices whenever the upstream price feed changes; always re-validate the exact price at the moment of purchase (it may have moved since page load) and reject/re-quote if it drifted materially.

## Order lifecycle
1. User selects service + country -> server checks wallet balance >= current price.
2. Server calls 5sim to purchase a number -> debits wallet (ledger entry, type=`purchase`) -> creates an `orders` row, `status=pending`, `expires_at = now() + 10 min`.
3. Server polls 5sim for SMS status (short interval, e.g. every 3-5s) until a code arrives or `expires_at` passes.
4. **Code arrives:** store `otp_code`, `status=sms_received`, `completed_at=now()`.
5. **No code by `expires_at`:** a scheduled job (Vercel Cron -> `/api/cron/expire-orders`) finds expired `pending` orders, cancels them upstream, sets `status=expired_refunded`, and writes a `refund` ledger entry crediting the wallet.
6. User can also manually cancel a still-`pending` order before expiry for the same refund treatment (`status=cancelled_refunded`).

## 5sim integration (reference only — verify against current 5sim docs before building; provider APIs change)
- Auth: bearer token (`5SIM_API_KEY`) on every request.
- Typical endpoints used: list prices for country/product, purchase/activate a number, check SMS status by order id, cancel an order, finish (mark complete) an order, ban a number if invalid.
- 5sim does not push webhooks for SMS arrival — our own polling job is the source of truth for "did the code arrive yet."

## Paystack integration
- Funding flow: client requests a top-up -> server creates a Paystack transaction (amount in kobo, minimum ₦500) -> client is redirected to Paystack's hosted checkout -> Paystack sends a signed webhook on completion -> server verifies signature, checks idempotency by reference, credits the wallet via a ledger entry (type=`topup`).
- The client-side "payment successful" redirect only triggers a status refresh/poll — it never credits the wallet itself.

## Currency
- User-facing wallet balance and prices: NGN only, integer kobo internally.
- 5sim cost basis: tracked in its native pricing, converted via `fx_rates` at computation time — never a hardcoded constant, since both the naira/dollar rate and 5sim's own prices drift.

## Admin panel (data needs)
- All orders (filterable by status/user/service), all wallet transactions, current 5sim account balance (server-side check, so the founder knows when to top up upstream), user list with freeze/unfreeze, manual refund action (writes ledger + audit log), pricing rule editor.
