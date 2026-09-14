-- Reliability-floor investigation (see lib/5sim/client.ts's
-- MIN_ACCEPTABLE_DELIVERY_RATE and that change's commit message): the
-- current 50 floor is justified by exactly one diagnostic data point.
-- Answering "what floor is actually right?" with real order outcomes needs
-- to know which operator (and its 5sim-reported delivery rate) was
-- actually selected at purchase time -- neither was captured before this,
-- so this is a forward-looking data capture, not a backfill (no way to
-- know which operator an already-placed order used without this column).
alter table public.orders
  add column if not exists fivesim_operator text,
  add column if not exists fivesim_operator_rate real;

comment on column public.orders.fivesim_operator is
  'The 5sim operator selectBestOperator (lib/5sim/client.ts) picked for this order at purchase time, e.g. "virtual34". Null for orders placed before this column existed.';
comment on column public.orders.fivesim_operator_rate is
  'That operator''s 5sim-reported delivery rate (0-100) at purchase time, per /guest/prices. Null if 5sim omitted the rate for that operator (treated as unproven, not unreliable -- see selectBestOperator) or for orders placed before this column existed.';

-- Postgres identifies a function by its full argument list, so appending
-- params -- even with defaults -- makes `create or replace` register a
-- second, distinct overload instead of actually replacing the original;
-- confirmed live (this migration failed on that basis before this drop was
-- added: "function name ... is not unique" on the revoke/grant below,
-- since two overloads then matched). Drop the original 9-arg signature
-- first so exactly one version of this function exists again.
drop function if exists public.create_order_and_debit_wallet(
  uuid, uuid, text, text, text, bigint, bigint, timestamptz, jsonb
);

create or replace function public.create_order_and_debit_wallet(
  p_user_id uuid,
  p_service_id uuid,
  p_country_code text,
  p_fivesim_order_id text,
  p_phone_number text,
  p_price_kobo bigint,
  p_upstream_cost_kobo bigint,
  p_expires_at timestamptz,
  p_metadata jsonb default '{}'::jsonb,
  p_fivesim_operator text default null,
  p_fivesim_operator_rate real default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  insert into public.orders (
    user_id, service_id, country_code, fivesim_order_id, phone_number,
    status, price_kobo, upstream_cost_kobo, expires_at,
    fivesim_operator, fivesim_operator_rate
  ) values (
    p_user_id, p_service_id, p_country_code, p_fivesim_order_id, p_phone_number,
    'pending', p_price_kobo, p_upstream_cost_kobo, p_expires_at,
    p_fivesim_operator, p_fivesim_operator_rate
  )
  returning * into v_order;

  -- Fires the sync_wallet_balance trigger, which raises (rolling back this
  -- entire function, order insert included) if the debit would take the
  -- wallet negative.
  insert into public.wallet_transactions (
    user_id, type, amount_kobo, reference, order_id, metadata
  ) values (
    p_user_id, 'purchase', -p_price_kobo, 'purchase_' || v_order.id, v_order.id, p_metadata
  );

  return v_order;
end;
$$;

revoke all on function public.create_order_and_debit_wallet from public;
grant execute on function public.create_order_and_debit_wallet to service_role;
