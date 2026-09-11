-- Phase 5: admin_audit_log. See ARCHITECTURE.md "admin_audit_log" and
-- SECURITY.md "Admin actions" ("Every admin action ... is written to
-- admin_audit_log: who, what, when, why").
--
-- target_id is deliberately a plain uuid with no FK: target_type
-- discriminates what table it points into (pricing_rule, order, user, ...),
-- and a single column can't carry a FK to more than one table. metadata
-- isn't in ARCHITECTURE.md's column list but follows the same pattern as
-- wallet_transactions.metadata — without it an entry is just "who did X to
-- Y at time T" with no detail, which falls short of "readable trail".
create table public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.users (id),
  action text not null,
  target_type text not null,
  target_id uuid not null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index admin_audit_log_created_at_idx
  on public.admin_audit_log (created_at desc);

create index admin_audit_log_target_idx
  on public.admin_audit_log (target_type, target_id);

alter table public.admin_audit_log enable row level security;

-- No insert/select policy for authenticated or anon — same lockdown
-- pattern as orders/wallet_transactions/pricing_rules. Every write and
-- every admin-panel read goes through the service-role client
-- (lib/supabase/admin.ts), gated by requireAdmin() in app code, never by
-- RLS. This keeps "is this request from an admin" as a single enforcement
-- point instead of duplicating that logic into a policy expression.
