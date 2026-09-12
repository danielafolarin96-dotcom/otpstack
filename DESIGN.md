# OtpStack — Design System (DESIGN.md)

## Direction
Warm, calm, professional — not a loud "crypto/tech demo" look. Cream ground, single orange accent used sparingly (primary actions, emphasis, active states only). Neutral, monochrome iconography everywhere except service/platform logos (see "Icon tiles" below) — no rainbow colors used decoratively.

## Copy voice
Plain, like a person describing the product to another person — not marketing copy. No "unlock," "elevate," "seamless," "in today's world," or similar filler; no rule-of-three lists for their own sake; no sentence that just restates the heading above it. If a heading makes a claim ("Popular services"), it has to stay true as the underlying data changes — prefer a plain, durable label ("Browse services") over one that can go stale.

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
- Icon tiles: service/platform logos (catalog grid, "Get a number" page) render each brand's real logo in its own brand color, on a fixed white `--icon-surface` fill (not the theme-following `--paper` — brand hex colors are designed against a light backdrop, and some go invisible on dark-mode `--paper`), flipping to a fixed dark `--icon-surface-inverse` instead for the rare near-white brand color (e.g. Supercell) that would otherwise go invisible on the white fix — both with a `--line` border. This is a deliberate exception to the no-rainbow rule, chosen for recognizability, sourced via the `simple-icons` npm package (resolved server-side, see `lib/icons/lookup.ts`) keyed off `services.icon_key`, with an ink-colored initial on ordinary `--paper` as fallback when a service has no Simple Icons match. Every other icon in the product (status glyphs, nav icons, etc.) stays neutral/monochrome as before.

## Core screens
1. **Landing page** — nav (logo, Log in, Create account) → hero ("Your code. Your number. Your stack.", subcopy, CTA, proof strip) → service catalog grid with category filter chips → 3-step process → country coverage grid → pricing/trust strip → footer.
2. **Dashboard** — sidebar (Overview, Get a number, Order history, Wallet & top-up, Settings) → wallet balance card → active number panel (live countdown, incoming code) → quick-buy list → transaction ledger table with status pills (Success / Pending / Delivered / Refunded).
3. **Admin panel** (detailed design during Phase 5, see DEVELOPMENT_PLAN.md) — same token system; adds data-dense tables, org-wide stats, and a manual refund/freeze action set.

## Reference
The "OtpStack Concept" artifact (landing + dashboard toggle) is the source of truth for spacing and hierarchy until superseded by real, built screens.
