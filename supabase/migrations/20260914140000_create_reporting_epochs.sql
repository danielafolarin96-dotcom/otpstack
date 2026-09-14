-- Reporting-epoch feature (see lib/pricing/margin-report.ts and the admin
-- Margin page): both the expiry-sweep money-losing bug and the operator-
-- reliability floor were fixed and deployed earlier this session. The
-- Margin page's headline numbers should now default to reflecting
-- performance under the FIXED system, not diluted by the already-
-- understood pre-fix losses -- without deleting, truncating, or hiding any
-- historical orders/wallet_transactions data, which stays exactly as-is
-- permanently for audit/accounting purposes. This is a pure reporting
-- filter: a marker recording when the "current era" starts, read by
-- lib/pricing/margin-report.ts to optionally exclude orders created before
-- it. An "All-time" toggle on the Margin page still reaches every order,
-- unfiltered -- this table changes what's displayed by default, nothing
-- about what's stored.
--
-- Append-only, same pattern as fx_rates: reading "the current epoch" means
-- the most recent row by set_at (see lib/pricing/reporting-epoch.ts).
-- Gives a free history of past resets for free and makes a future "reset
-- the epoch again" trivial later (just insert another row) without needing
-- UPDATE logic or a singleton-row pattern.
create table public.reporting_epochs (
  id uuid primary key default gen_random_uuid(),
  set_at timestamptz not null default now(),
  fivesim_balance_usd numeric not null
);

comment on table public.reporting_epochs is
  'Marks when the Margin page''s default (non-"All-time") view starts counting orders from. Does not affect orders/wallet_transactions data at all -- purely a display cutoff. Latest row by set_at wins.';
comment on column public.reporting_epochs.fivesim_balance_usd is
  'The live 5sim account balance (getProfile(), lib/5sim/client.ts) at the moment this epoch was set -- a reference point shown for context, not used in any calculation.';

alter table public.reporting_epochs enable row level security;
-- No policies: service-role only, same lockdown as pricing_rules/orders --
-- every read/write goes through the admin client (app/(admin)/admin/margin).

-- Seed the epoch at the moment both fixes shipped. Balance confirmed live
-- via GET /user/profile (Sept 14 2026, same call getProfile() makes) --
-- not hardcoded/guessed, this is the account's real balance at seed time.
insert into public.reporting_epochs (fivesim_balance_usd) values (0.89);
