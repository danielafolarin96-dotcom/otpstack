-- Phase 1: users profile table + wallets table, with RLS.
-- See ARCHITECTURE.md "Data model" and SECURITY.md "Wallet integrity" / "Auth & access".

-- ── users ────────────────────────────────────────────────────────────────
-- Extends auth.users with the profile fields the app needs. id mirrors
-- auth.users.id 1:1 and cascades on account deletion.
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  username text not null unique,
  email text not null unique,
  is_admin boolean not null default false,
  is_frozen boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.users enable row level security;

create policy "users can read their own row"
  on public.users
  for select
  to authenticated
  using (id = auth.uid());

create policy "users can update their own row"
  on public.users
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Column-level grant restricts *which* columns that update policy actually
-- lets a user touch: is_admin, is_frozen, email and created_at stay
-- server/admin-only even though the row-level policy above would otherwise
-- permit the update. This is what stops a user from self-promoting to
-- is_admin=true via a direct client update.
revoke update on public.users from authenticated;
grant update (full_name, username) on public.users to authenticated;

-- No insert/delete policy for authenticated: rows are created only by the
-- handle_new_user trigger below (SECURITY DEFINER, runs as table owner) and
-- never deleted directly by client code.

-- ── wallets ──────────────────────────────────────────────────────────────
-- balance_kobo is derived/cached from wallet_transactions (Phase 2's
-- ledger) and must never be written directly by app code.
create table public.wallets (
  user_id uuid primary key references public.users (id) on delete cascade,
  balance_kobo bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.wallets enable row level security;

create policy "users can read their own wallet"
  on public.wallets
  for select
  to authenticated
  using (user_id = auth.uid());

-- Deliberately no insert/update/delete policy for authenticated or anon:
-- with RLS enabled and no permissive policy for those commands, every
-- client-side write attempt is denied outright. The wallet row is created
-- only by the handle_new_user trigger below; balance_kobo is only ever
-- written by the Phase 2 ledger functions running with elevated privileges.

-- ── auto-provisioning on signup ─────────────────────────────────────────
-- Supabase Auth inserts into auth.users on signup (email/password or OAuth).
-- This trigger provisions the matching public.users + public.wallets rows
-- so client code never has to (and never gets the chance to) insert either
-- table directly. full_name/username come from the signup form via
-- supabase.auth.signUp()'s options.data, which lands in raw_user_meta_data.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, full_name, username, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'username', new.id::text),
    new.email
  );

  insert into public.wallets (user_id, balance_kobo)
  values (new.id, 0);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
