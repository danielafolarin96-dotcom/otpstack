# OtpStack — Security Policy (SECURITY.md)

## Secrets & keys
- `5SIM_API_KEY`, `PAYSTACK_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY` live only in Vercel environment variables (and local `.env.local`, gitignored). Never exposed to the client bundle.
- Rotate a key immediately if it is ever accidentally committed or logged.
- `PAYSTACK_PUBLIC_KEY` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are the only credentials allowed client-side.

## Payments (Paystack)
- Wallet top-ups are confirmed via the Paystack **webhook**, never trusted from the client redirect alone — a client-side "success" callback only triggers a UI refresh; the wallet is credited only when the signed webhook event arrives.
- Webhook signature verified via `x-paystack-signature` (HMAC SHA512 with the secret key) on every request; requests that fail verification are rejected and logged, never processed.
- Webhook handler is idempotent, keyed on Paystack's transaction reference — a retried webhook must never double-credit a wallet.

## Wallet integrity
- Wallet balance is never directly writable from any API route. All changes go through an append-only `wallet_transactions` ledger; balance is a derived sum (see ARCHITECTURE.md). Every credit/debit is auditable by inspection.
- Every debit for a number purchase and every auto-refund is logged against its triggering order ID.

## 5sim integration
- `5SIM_API_KEY` is used server-side only, via `lib/5sim/client.ts`. Nothing client-side ever calls 5sim directly.
- Purchase, status polling, and cancellation happen through our own API routes, which enforce ownership (a user can only check/cancel their own order) and rate limits.

## Auth & access
- Supabase Auth (email/password + Google OAuth). Session cookies are httpOnly, secure, SameSite=Lax.
- Row Level Security enabled on every table holding user data — a user's Postgres role can only read/write rows where `user_id = auth.uid()`. Admin routes use the service role key server-side only, gated by an `is_admin` check on the authenticated user, never by a client-supplied flag.
- No email verification required at signup (product decision) — compensated by rate limiting on signup/top-up endpoints and monitoring for abuse patterns (many accounts, same card/device fingerprint) as an ongoing concern.

## Rate limiting & abuse
- Per-user and per-IP rate limits on: signup, wallet top-up initiation, number purchase (e.g. cap on concurrent active/pending orders).
- Admin panel can freeze an account (blocks purchases and top-ups) without deleting data, pending investigation.

## Data handling
- Passwords never stored or logged in plaintext — handled entirely by Supabase Auth.
- OTP codes received from 5sim are retained only long enough to display them and support dispute resolution — not kept indefinitely.
- No card numbers ever touch OtpStack's servers — Paystack's hosted checkout handles all card data; PCI scope stays with Paystack.

## Admin actions
- Every admin action (manual refund, account freeze/unfreeze) is written to `admin_audit_log`: who, what, when, why.

## Responsible disclosure
- Security issues should go directly to the founder (contact to be added before launch) rather than a public GitHub issue.

## Before going live
- [ ] Rotate all keys from test to live mode
- [ ] Confirm the Paystack webhook URL is set to the production domain and verified
- [ ] Confirm RLS policies tested against a non-admin account
- [ ] Terms of Service / Acceptable Use Policy published and linked at signup
