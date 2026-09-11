-- Phase 4 audit fix (priority 3+4): order creation and the wallet debit
-- were two separate sequential .insert() calls from lib/orders/purchase.ts
-- — a crash between them could leave a real 5sim number with no debit
-- recorded, and the compensating delete-on-failure that used to paper over
-- debit failures didn't check its own error either. Wrapping both writes
-- in one function makes them one Postgres transaction: if the wallet
-- debit fails for any reason (insufficient balance, per the negative-
-- balance guard, or anything else), the order insert rolls back
-- automatically too — there's nothing left to compensate-delete, which is
-- why lib/orders/purchase.ts no longer has a standalone delete step at all.
--
-- The 5sim purchase itself still has to happen *before* this is called
-- (it's a real HTTP call to an external API, not something Postgres can
-- include in its own transaction) — this function only atomically wraps
-- the two DB writes that follow it.
create or replace function public.create_order_and_debit_wallet(
  p_user_id uuid,
  p_service_id uuid,
  p_country_code text,
  p_fivesim_order_id text,
  p_phone_number text,
  p_price_kobo bigint,
  p_upstream_cost_kobo bigint,
  p_expires_at timestamptz,
  p_metadata jsonb default '{}'::jsonb
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
    status, price_kobo, upstream_cost_kobo, expires_at
  ) values (
    p_user_id, p_service_id, p_country_code, p_fivesim_order_id, p_phone_number,
    'pending', p_price_kobo, p_upstream_cost_kobo, p_expires_at
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

-- Only the service-role client (lib/orders/purchase.ts, via
-- lib/supabase/admin.ts) should ever call this — it writes an arbitrary
-- price_kobo/upstream_cost_kobo with no validation of its own, trusting
-- the caller to have already resolved those through the pricing engine.
-- Postgres grants EXECUTE to PUBLIC by default on function creation.
revoke all on function public.create_order_and_debit_wallet from public;
grant execute on function public.create_order_and_debit_wallet to service_role;
