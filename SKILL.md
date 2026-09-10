# OtpStack — Build Conventions (SKILL.md)

## Stack
- Frontend/Backend: Next.js 14+ (App Router), TypeScript strict mode
- Database/Auth: Supabase (Postgres, Auth, Row Level Security)
- Payments (funding): Paystack (card + bank transfer)
- Number provider: 5sim.net API (reseller)
- Hosting: Vercel (frontend + API routes / serverless functions)
- Styling: Tailwind CSS, tokens sourced from DESIGN.md

## Conventions
- All money values stored as integer **kobo** (₦1 = 100 kobo) — never floats, to avoid rounding errors.
- 5sim upstream prices are stored as received alongside a computed NGN price from the pricing engine — never hardcode a fixed USD/NGN conversion; always read from `fx_rates` + `pricing_rules` (see ARCHITECTURE.md).
- Server-only secrets (`5SIM_API_KEY`, `PAYSTACK_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) are only ever referenced in server components, API routes (`app/api/**/route.ts`), or server actions — never in client components, never shipped to the browser.
- Folder structure:
  - `app/(marketing)/` — public landing page
  - `app/(dashboard)/` — authenticated user dashboard
  - `app/(admin)/` — admin panel, protected by role check
  - `app/api/` — route handlers (Paystack webhook, 5sim proxy endpoints, cron endpoints)
  - `lib/5sim/` — typed 5sim API client
  - `lib/paystack/` — typed Paystack API client
  - `lib/pricing/` — pricing engine (markup calculation)
  - `lib/wallet/` — ledger read/write helpers (append-only)
  - `lib/supabase/` — server + client Supabase clients
  - `types/` — shared TypeScript types generated from the DB schema
- Every DB write that touches money (wallet, orders) goes through a single server-side module or Postgres function — never ad hoc `.update()` calls scattered across routes.
- Use Supabase-generated types (`supabase gen types typescript`) — never hand-type table shapes; regenerate after every migration.
- Formatting: Prettier + ESLint (Next.js default config), enforced pre-commit.
- Commits: Conventional Commits style (`feat:`, `fix:`, `chore:`, `refactor:`) — one logical change per commit.
- Every new API route that mutates state needs at least one happy-path and one failure-path test before it's considered done.

## Local setup
1. `npm install`
2. Copy `.env.example` → `.env.local`, fill in Supabase, Paystack test keys, 5sim API key
3. `npx supabase link` then `npx supabase db push` to apply migrations
4. `npm run dev`

## When adding a new page
- Marketing pages: Server Components by default; client components only where there's real interactivity (search, filters).
- Dashboard pages: fetch user-scoped data server-side using the authenticated Supabase server client; never fetch another user's data client-side.
