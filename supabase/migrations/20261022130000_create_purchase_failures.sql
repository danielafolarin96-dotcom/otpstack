-- One row per failed purchase attempt on POST /api/orders, written
-- best-effort by lib/orders/purchase-failures.ts via the service-role
-- client. Diagnostics only: nothing reads this on the purchase path, and a
-- failed insert never changes the customer's response.
--
-- service_id deliberately has no foreign key: it comes from the request
-- body of a *failed* attempt, which may name a service that doesn't exist
-- (the app only stores it when it's UUID-shaped). country_code is the
-- 5sim country code, resolved from the request's countryId when possible.
--
-- message is capped at 300 chars and redacted for anything
-- credential-shaped in the app before insert; the check here is the
-- backstop for the length.
--
-- Reversal: drop table if exists public.purchase_failures;

create table if not exists public.purchase_failures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  service_id uuid,
  country_code text,
  operator text,
  reason text not null check (
    reason in (
      'insufficient_balance',
      'operator_unavailable',
      'upstream_no_numbers',
      'provider_balance',
      'rate_limited',
      'concurrent_order',
      'other'
    )
  ),
  http_status integer not null,
  message text check (char_length(message) <= 300),
  created_at timestamptz not null default now()
);

create index if not exists purchase_failures_created_at_idx
  on public.purchase_failures (created_at desc);
create index if not exists purchase_failures_user_id_created_at_idx
  on public.purchase_failures (user_id, created_at desc);

alter table public.purchase_failures enable row level security;

-- No policies for authenticated or anon — same lockdown pattern as
-- rate_limits/admin_audit_log. Only the service-role client reads or
-- writes this table.
