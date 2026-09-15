-- 128. A CO-OWNER IS NOT THE OWNER.
--
-- Shahar (2026-09-15), looking at his own board: "Why Shahar shows as owner
-- on Ran project? If he was assigned as co owner, say co owner."
--
-- Ran invited him to co-manage the generator on 2026-09-14 and he accepted at
-- 21:45. The seat that was written is project_role 'asset owner', role
-- 'owner' - the same seat Ran himself holds. There is no other seat to write:
-- across 33 rows in project_members there is exactly one owner-class
-- project_role, and a co-owner really does have the owner's authority (rank
-- 70) - they can hire, cancel, close and reopen. The AUTHORITY is right. It
-- is the WORD that is wrong, and it is wrong in the one place it matters,
-- because "owner" next to somebody else's house is a claim, not a label.
--
-- The database already knows the difference and has never been asked:
-- projects.owner_user_id is Ran on that job and Shahar on 55 Walnut. Owner of
-- record is one person; an owner-class SEAT can be held by several. So this
-- adds no seat, no rank and no rule - just the fact, on every row of the
-- board, so the app can say which of the two it is looking at.
--
--   owner_other = somebody else is the owner of record.
--
-- Written that way round on purpose: a project with no owner_user_id at all
-- (the old imported builds) comes back false and keeps the word it has
-- always had, rather than accusing the person reading it of being a guest in
-- their own job.
do $patch$
declare src text; out_ text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'portal_my_work';

  out_ := replace(src,
    E'    \'archived\', p.archived_at is not null,\n',
    E'    \'archived\', p.archived_at is not null,\n'
    || E'    -- Owner of record is one person; an owner-class seat is not.\n'
    || E'    \'owner_other\', (p.owner_user_id is not null\n'
    || E'                    and p.owner_user_id is distinct from (select m2.app_user_id from me m2)),\n');

  if out_ = src then
    raise exception 'portal_my_work has drifted - the archived key is not where it was.';
  end if;
  execute out_;
end $patch$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
