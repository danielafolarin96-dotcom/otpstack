-- admin_audit_log.admin_id was `not null references public.users (id)` with
-- no ON DELETE clause (implicit RESTRICT). That blocks deleting any user
-- who has ever taken a logged admin action — surfaced by
-- scripts/reset-test-data.mjs failing on the pre-launch data wipe, since
-- every existing admin_audit_log row references one of the two accounts
-- that ever held admin (both being deleted in that reset).
--
-- SECURITY.md's audit-log requirement is "who, what, when, why" for
-- accountability while the admin account still exists — it was never
-- meant to force-keep a since-deleted admin account alive. Once the actor
-- is gone, the action/target/reason/timestamp are what still matter;
-- admin_id going to null on those older rows is an acceptable loss, and
-- preferable to a table that can never lose an admin without breaking.
alter table public.admin_audit_log
  alter column admin_id drop not null;

alter table public.admin_audit_log
  drop constraint admin_audit_log_admin_id_fkey;

alter table public.admin_audit_log
  add constraint admin_audit_log_admin_id_fkey
  foreign key (admin_id) references public.users (id) on delete set null;
