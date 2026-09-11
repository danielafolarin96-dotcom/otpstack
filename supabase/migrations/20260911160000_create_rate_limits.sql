-- Phase 6: rate limiting. See SECURITY.md "Rate limiting & abuse" —
-- per-user and per-IP limits on signup, top-up initiation, and number
-- purchase.
--
-- Fixed-window counter, one row per (action:scope:identity) key. A window
-- is "reset" lazily the next time it's checked after expiring, rather than
-- via a cron sweep — so the table's size is bounded by the number of
-- distinct identities seen, not by time, and needs no cleanup job.
create table public.rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 0
);

alter table public.rate_limits enable row level security;

-- No insert/select/update policy for authenticated or anon — same
-- lockdown pattern as admin_audit_log/pricing_rules. Every check goes
-- through check_rate_limit() below via the service-role client.

-- Atomic check-and-increment: returns true (and counts this call) if the
-- caller is still under p_max_count within the trailing p_window_seconds,
-- false if not (nothing is counted in that case). The `for update` lock on
-- the select, plus catching unique_violation on the first-ever insert for
-- a key, makes this safe under concurrent requests for the same key —
-- same claim-before-act discipline as create_order_and_debit_wallet.
create or replace function public.check_rate_limit(
  p_key text,
  p_window_seconds integer,
  p_max_count integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start timestamptz;
  v_count integer;
begin
  loop
    select window_start, count into v_window_start, v_count
    from public.rate_limits
    where key = p_key
    for update;

    exit when found;

    begin
      insert into public.rate_limits (key, window_start, count) values (p_key, now(), 0);
    exception when unique_violation then
      -- lost the race to insert this key to a concurrent call — loop
      -- around and lock the row it created instead.
      null;
    end;
  end loop;

  if v_window_start <= now() - make_interval(secs => p_window_seconds) then
    update public.rate_limits set window_start = now(), count = 1 where key = p_key;
    return true;
  end if;

  if v_count >= p_max_count then
    return false;
  end if;

  update public.rate_limits set count = count + 1 where key = p_key;
  return true;
end;
$$;

revoke all on function public.check_rate_limit from public;
grant execute on function public.check_rate_limit to service_role;
