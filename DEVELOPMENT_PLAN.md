# OtpStack — Development Plan

Phased so each stage produces something testable. No fixed dates — sequence and dependency order are what matter; you set the pace working in Claude Code.

## Phase 0 — Foundation
- Initialize Next.js (App Router, TypeScript) in this folder, connect to GitHub, connect to Vercel.
- Create the Supabase project, wire up local `.env.local`, get `npx supabase link` working.
- Confirm SKILL.md / DESIGN.md / AGENT.md / SECURITY.md / ARCHITECTURE.md sit in the repo root so every future Claude Code session here loads with full context.
- Set up Tailwind with the DESIGN.md token set (light + dark).

## Phase 1 — Auth & user shell
- Supabase Auth: email/password + Google OAuth; signup form (full name, email, username, password, confirm, ToS/Privacy checkbox) — no email verification gate.
- `users` + `wallets` tables + RLS policies.
- Basic dashboard shell (sidebar nav, empty states) matching the mockup.

## Phase 2 — Wallet & Paystack funding
- `wallet_transactions` ledger table + balance-derivation logic.
- Paystack top-up flow (₦500 minimum) + signed webhook handler, idempotent.
- Dashboard wallet card wired to a real balance; transaction history table.

## Phase 3 — Catalog & pricing engine
- `services`, `countries`, `pricing_rules`, `fx_rates` tables.
- Curate the initial launch list (roughly 15-20 popular services x 10-15 countries to start; expand later).
- Build the pricing engine (tiered markup + minimum margin + per-service/country overrides) and a simple admin-only pricing rule editor.
- Service catalog grid on the landing page and the dashboard's "Get a number" page, live-priced.

## Phase 4 — 5sim integration & order flow
- `lib/5sim/client.ts` typed wrapper.
- Purchase flow: balance check -> buy -> debit -> order created.
- Polling job for SMS arrival; dashboard "active number" panel with a live countdown.
- 10-minute TTL cron + auto-refund logic; manual cancel-for-refund.

## Phase 5 — Admin panel
- Orders table, transactions table, 5sim balance widget, user list with freeze/unfreeze, manual refund tool, audit log view.

## Phase 6 — Abuse prevention & hardening
- Rate limits on signup, top-up initiation, number purchase.
- Review RLS policies end-to-end against a non-admin test account.
- Test the expire-orders cron for correctness under concurrent orders.

## Phase 7 — Legal & content
- Terms of Service + Acceptable Use Policy (prohibits fraud/spam use) + Privacy Policy, linked at signup and in the footer.
- FAQ content, support contact.

## Phase 8 — QA & launch prep
- End-to-end test: signup -> top-up -> buy number -> receive/miss code -> refund path -> admin visibility, all against Paystack/5sim test or sandbox modes.
- Switch Paystack and 5sim to live keys; re-run the same checklist with small real transactions.
- Deploy to Vercel on the current `vercel.app` domain; move to a custom domain later per SECURITY.md's "before going live" checklist.

## Phase 9 — Post-launch
- Monitor actual margin against the 60% target; tune `pricing_rules` accordingly.
- Watch for abuse patterns not caught pre-launch; iterate on Phase 6.
- Expand the curated service/country list based on demand.
