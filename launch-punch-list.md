# OtpStack — Launch Punch List

Compiled after tonight's QA pass (bug fix + Parts A–E + real-SMS test + Phase 6 RLS/cron review). Grouped by urgency, not by DEVELOPMENT_PLAN.md phase number, since what actually blocks launch cuts across phases.

## Blocks taking real customer signups

These are things that would embarrass or expose you if a stranger signed up tomorrow.

1. **Funding flow (Paystack) has never been tested end-to-end.** Every wallet balance used in QA so far came from a seed script or admin adjustment, not a real top-up. The actual checkout → webhook → credit path — the one that involves real customer money coming *in* — is still untested. This is now the one major open item.

### ✅ Resolved this session
- **Legal pages are live.** Terms of Service, Acceptable Use Policy, and Privacy Policy are finalized (dated September 15, 2026), contact email locked to `support@otpstack.com.ng`, and you explicitly decided to publish as-is without formal lawyer review (accepted risk — see note below). Pages are built and linked from the site footer: `/terms`, `/acceptable-use`, `/privacy`. `npx next build` confirms all three prerender cleanly.
  - Note: no lawyer has checked the liability/refund-denial or AUP language. You chose to skip that step for now — worth revisiting once there's real transaction volume.
  - Correction (2026-09-15 investigation): the claim that `/signup` "is still not built" is wrong. `app/(auth)/signup/page.tsx`, `signup-form.tsx`, and `app/api/auth/signup/route.ts` all exist and are fully wired, and have been live since account creation timestamps as early as 2026-09-11 — the flow has been reachable and in use throughout this week's testing, not gated behind anything.
- **Support email works.** Cloudflare Email Routing is active; `support@otpstack.com.ng` forwards to `otpstackteam@gmail.com`, verified with a live test email (landed in spam — ask whoever monitors that inbox to mark it not-spam once).
  - Correction (this session): the claim above that this was "confirmed as deliberate" doesn't hold up — the app's own `SUPPORT_EMAIL` constant (`lib/content/contact.ts`, shown in the site footer and every legal page) was actually still `support@otpstack.com` (wrong TLD, sitting under a literal `// TODO before launch` comment), not `supportotpstack@gmail.com` as stated here, and it was not something you'd confirmed. Fixed to `support@otpstack.com.ng` to match the legal docs and Email Routing.

## Should fix before any real marketing push

Not launch-blocking in the sense of "don't let anyone sign up," but real gaps that matter once you have actual users you can't personally babysit.

4. **Signup and top-up rate limits untested.** Only the purchase-endpoint limit was verified tonight (Part C). SECURITY.md calls for limits on all three.
5. **FAQ and support contact content** — Phase 7, not started.
6. **Domain Lock** ✅ already done tonight at WhoGoHost — keeping this here just as a record.

## Known small issues, not urgent

7. **Margin page label bug** — "Unknown (predates tracking)" is inaccurate for the legitimate case where 5sim closes an order before a cancel attempt is possible. Cosmetic, one-line copy fix.
8. **Stale code comment** in `app/api/orders/[id]/status/route.ts` still claims the cron "can't fire yet, no Vercel project connected" — no longer true, confirmed tonight. Doesn't affect behavior, just misleading to read.
9. **`promo-tracking-wip` branch** — parked since last night, migration never tested against staging. Fine to leave parked indefinitely; just don't merge it without testing the migration first.

## Already solid — no action needed

- Purchase → real SMS → dashboard display → wallet debit: proven end-to-end with a real order tonight (59 seconds, TikTok/US).
- Cancellation and TTL-timeout refund paths: verified working, including the exact scenario that caused this morning's bug.
- Stock-out and insufficient-balance failure modes: verified zero wallet/order footprint.
- Purchase rate limiting: verified enforced at the documented threshold.
- 7 different country/service combos tested for breadth, surfaced a real pricing-variance insight.
- Row Level Security: tested against a genuine non-admin account, holds correctly across reads and writes on wallets, transactions, orders, and admin-only tables.
- Production cron jobs: confirmed actually firing on schedule (not just registered).
- Domain: on Cloudflare, active, locked against transfer.
- The wallet-refund bug found this morning: fixed, tested, deployed, corrected, audited clean against all historical orders.

## Suggested order of attack

With Email Routing and the legal pages done, the highest-leverage next session is a real Paystack sandbox top-up test — the one major piece of the money story nothing has touched yet — followed by the "should fix before marketing push" items (rate limits on signup/top-up, FAQ content) and eventually building out the actual `/signup` flow.
