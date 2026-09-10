# OtpStack — Design System (DESIGN.md)

## Direction
Warm, calm, professional — not a loud "crypto/tech demo" look. Cream ground, single orange accent used sparingly (primary actions, emphasis, active states only). Neutral, monochrome iconography — no rainbow per-brand icon colors.

## Color tokens

### Light
- `--paper`: #FBF6EC — page background
- `--paper-raised`: #FFFFFF — cards, panels
- `--ink`: #1A1712 — near-black text/surfaces (buttons, wallet card)
- `--signal` (accent): #FF5A1F — primary actions, links, emphasis
- `--signal-bright`: #FF7A45 — accent hover / alternate state
- `--amber` (semantic/pending): #C97B12
- `--slate` / `--slate-dim`: #6B6357 / #948C7C — secondary text
- `--line`: #EAE1D2 — borders/dividers
- `--text` / `--text-dim`: #201C16 / #6B6357
- `--danger`: #C4432B — failed / negative states
- `--good`: #1F9D6B — success / delivered / refunded — kept distinct from the orange accent; semantic color is never the brand accent

### Dark (mirrors the same roles — not a naive invert)
- `--paper`: #17130D, `--paper-raised`: #211C14, `--ink`: #FBF6EC
- `--signal`: #FF7A45, `--signal-bright`: #FF9868
- `--line`: #3A3225, `--text`: #F3ECDD, `--text-dim`: #B8AC97
- `--good`: #35C98A, `--danger`: #E9715A

## Typography
- Display/headings: **Sora** (600–800) — h1/h2/h3, nav brand
- Body: **Manrope** (400–700) — running text, buttons, labels
- Numerals/technical: **Space Mono** — OTP codes, phone numbers, prices, countdown timers, ledger figures (tabular-nums). Deliberate choice: OTP codes and phone numbers are literally monospaced data, so the type system reflects that.

## Layout rules
- Max content width 1080px; minimum 20px side gutter at every width.
- Cards: 14px radius, 1px `--line` border; heavy shadow reserved for genuinely floating panels, not every card.
- Buttons: 10px radius (not a full pill) for primary actions — pill/999px reserved for filter chips and small status badges only.
- Icon tiles (service logos, etc.): neutral `--paper` fill, `--line` border, ink-colored initial — no per-brand rainbow colors.

## Core screens
1. **Landing page** — nav (logo, Log in, Create account) → hero ("Your code. Your number. Your stack.", subcopy, CTA, proof strip) → service catalog grid with category filter chips → 3-step process → country coverage grid → pricing/trust strip → footer.
2. **Dashboard** — sidebar (Overview, Get a number, Order history, Wallet & top-up, Settings) → wallet balance card → active number panel (live countdown, incoming code) → quick-buy list → transaction ledger table with status pills (Success / Pending / Delivered / Refunded).
3. **Admin panel** (detailed design during Phase 5, see DEVELOPMENT_PLAN.md) — same token system; adds data-dense tables, org-wide stats, and a manual refund/freeze action set.

## Reference
The "OtpStack Concept" artifact (landing + dashboard toggle) is the source of truth for spacing and hierarchy until superseded by real, built screens.
