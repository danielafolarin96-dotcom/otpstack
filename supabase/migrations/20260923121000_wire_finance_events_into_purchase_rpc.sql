-- Wires finance_events into the purchase path: create_order_and_debit_wallet
-- already does the order insert + wallet debit as one Postgres transaction
-- (see the 20260914130000 migration) -- extending it to also insert the
-- revenue_recognized finance_event keeps all three writes atomic, same "one
-- server-side function, never ad hoc writes" rule AGENT.md/SKILL.md set for
-- every money-touching write.
--
-- Postgres resolves functions by full argument list, so appending params
-- even with defaults registers a second overload instead of replacing the
-- original unless the old signature is dropped first -- same fix already
-- applied by the 20260914130000 migration when it added the operator
-- columns; confirmed there that skipping this drop fails live.
drop function if exists public.create_order_and_debit_wallet(
  uuid, uuid, text, text, text, bigint, bigint, timestamptz, jsonb, text, real
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
  p_fivesim_operator_rate real default null,
  -- Resolved by lib/finance/fee-schedule.ts and passed in already-computed
  -- (not recomputed here) so the fee formula lives in exactly one place
  -- (lib/finance/fee-schedule.ts's computeFeeKobo, unit-tested) instead of
  -- being duplicated in SQL. p_provider defaults '5sim' since that's the
  -- only provider that exists today (see the services.provider column added
  -- in the previous migration) -- the caller passes the purchased service's
  -- actual provider value regardless.
  p_payment_fee_kobo bigint default 0,
  p_fee_schedule_id uuid default null,
  p_provider text default '5sim'
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

  insert into public.finance_events (
    order_id, user_id, event_type, service_id, country_code, provider,
    revenue_kobo, provider_cost_kobo, payment_fee_kobo, fee_schedule_id
  ) values (
    v_order.id, p_user_id, 'revenue_recognized', p_service_id, p_country_code, p_provider,
    p_price_kobo, p_upstream_cost_kobo, p_payment_fee_kobo, p_fee_schedule_id
  );

  return v_order;
end;
$$;

revoke all on function public.create_order_and_debit_wallet from public;
grant execute on function public.create_order_and_debit_wallet to service_role;
