# OtpStack — Project Context

This file is auto-loaded by Claude Code at the start of every session in this repo. Read the following files in full before doing any work here — they are the actual project spec, not optional background:

- **AGENT.md** — ground rules for how you (the coding agent) should operate in this repo: what requires a test, what requires asking first, what never to guess at.
- **ARCHITECTURE.md** — the system spec: full DB schema, pricing engine logic, order lifecycle, and the verified 5sim + Paystack API integration contracts. This is the source of truth for how the system works.
- **DESIGN.md** — color tokens, typography, layout rules, and the core screen structure (landing page + dashboard). Follow this for anything user-facing.
- **SECURITY.md** — secret handling, payment/webhook verification, wallet ledger integrity rules, RLS policy expectations.
- **SKILL.md** — stack, coding conventions, folder structure, local setup steps.
- **DEVELOPMENT_PLAN.md** — the phased build order. Check which phase is current before starting new work, and don't jump ahead of unfinished phases without asking.

## Quick facts
- Stack: Next.js (App Router, TypeScript) + Supabase (Postgres/Auth) + Paystack (funding) + 5sim.net (number inventory) + Vercel (hosting).
- All money is integer kobo. Wallet balance is never written directly — always through the `wallet_transactions` ledger.
- Target gross margin: 60%, enforced as a floor in the pricing engine (see ARCHITECTURE.md).
- No email verification at signup; ₦500 minimum wallet top-up; 10-minute number hold with auto-refund on timeout.

If anything in these docs seems to conflict with a new instruction from the user, point out the conflict rather than silently overriding the spec.
