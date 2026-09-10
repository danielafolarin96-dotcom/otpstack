# OtpStack — Agent Instructions (AGENT.md)

This file governs how an AI coding agent (Claude Code or similar) should operate inside this repository. Read this before making changes.

## Ground rules
1. **Never commit secrets.** `.env.local` is gitignored. Never hardcode API keys, Supabase service role keys, or Paystack secret keys in source. If a task seems to need a real key in code, stop and ask.
2. **Money logic is high-stakes.** Any change touching `lib/wallet/`, `lib/pricing/`, the Paystack webhook handler, or refund logic requires: (a) reading ARCHITECTURE.md's ledger design first, (b) a test covering the change, (c) a plain-English note in the commit message explaining the money-flow impact.
3. **Never mutate a wallet balance directly.** Always insert a `wallet_transactions` row and let the balance be derived — see ARCHITECTURE.md. A change that does `UPDATE wallets SET balance = ...` outside the ledger function should be rejected.
4. **Ask before:** deleting a migration, changing a Paystack/5sim integration's auth mechanism, changing RLS policies, or touching anything under `app/(admin)/`.
5. **Don't invent 5sim or Paystack API behavior.** If unsure about an endpoint, contract, or error shape, say so explicitly and flag it for the user to verify against current provider docs rather than guessing silently.
6. **Follow SKILL.md** for conventions and DESIGN.md for anything user-facing.
7. **Small, reviewable commits.** Prefer several focused commits over one large one.

## Before marking a task done
- `npm run lint && npm run typecheck && npm run test` all pass.
- New/changed API routes have at least a happy-path and a failure-path test.
- Any new DB migration is idempotent and reversible where possible.

## Key files to know
- `lib/pricing/engine.ts` — markup + minimum-margin calculation, recomputed on upstream price change
- `lib/wallet/ledger.ts` — the only place wallet balances are written
- `app/api/webhooks/paystack/route.ts` — Paystack funding webhook, signature-verified
- `lib/5sim/client.ts` — 5sim API wrapper
- `app/api/cron/expire-orders/route.ts` — 10-minute TTL sweep + auto-refund job

## Escalate to the user (don't guess) when:
- A decision affects money (margin, refund policy, pricing rules).
- A decision affects legal exposure (Terms of Service wording, data retention).
- Test 5sim/Paystack credentials behave unexpectedly — could be an account/config issue on their end, not a code bug.
