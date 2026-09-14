-- 115. AN OWNER CAN END A JOB, AND PUT IT AWAY.
--
-- Shahar (2026-09-14): "as the owner of a project, I need to be able to
-- cancel and archive it. enable this functionality to the project owner."
--
-- CANCELLING already exists and works - portal_project_cancel, migration 070.
-- What happened is that on 2026-09-13 he said "there is an option to cancel
-- the job - this is too risky; for now, gray this out as an option", and the
-- screen greyed the row out for EVERYBODY. That was the right call for a
-- button sitting in a settings panel on a job with 136 open tasks, and the
-- wrong one for the person who owns the thing. So the screen turns it back on
-- at rank 70 - the asset owner - and keeps it greyed below that. The database
-- rule (rank 50, a site PM and up) is untouched: this is the screen being
-- more careful than the database, which is the correct direction.
--
-- ARCHIVING is new, and it is not any of the three endings we already have:
--
--   Closed - Completed  the work happened. Record frozen, surveys out.
--   Closed - Cancelled  it will not happen. Open work goes with it, frozen.
--   Trash               a mistake. Recycle bin, purged after the retention
--                       window, and it refuses outright if the project has
--                       any contract or any ledger row - which is most of
--                       them, and rightly so.
--
-- None of those is "this is over and I do not want to look at it any more".
-- A closed job stays on the board forever, so six months of finished work
-- sits between the owner and the three jobs that are live. Archiving is that
-- and only that: it comes off the list, nothing is deleted, nothing is
-- frozen that was not already frozen by the close, and it comes back the
-- moment he asks for it.
--
-- WHICH IS WHY IT ONLY APPLIES TO A JOB THAT HAS ENDED. Archiving something
-- still running would be a way to lose work - it would vanish from the board
-- with its tasks still open and its money still owed. Finish it or cancel it
-- first; both are one panel away, and both say what happened. That is a
-- deliberate restriction, not an oversight.

alter table public.projects
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by text;

comment on column public.projects.archived_at is
  'Set when the owner put a finished or cancelled job away. It leaves the board and nothing else changes - not deleted, not trashed, reversible. Never set on a job that is still open.';

create index if not exists idx_projects_archived
  on public.projects (archived_at) where archived_at is not null;

create or replace function public.portal_project_archive(
  p_project uuid,
  p_archive boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  me uuid := public.current_app_user_id();
  p public.projects; v_actor text; v_kids int;
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'Sign in first.'); end if;

  select * into p from public.projects where id = p_project and trashed_at is null;
  if p.id is null then return jsonb_build_object('ok', false, 'reason', 'No such project.'); end if;

  -- The owner's, not the site manager's. Cancelling is a rank-50 decision in
  -- this database; deciding what he has to look at every morning is not.
  if not (public.is_superadmin() or coalesce(public.my_authority_rank(p_project), 0) >= 70) then
    return jsonb_build_object('ok', false, 'reason', 'Putting this job away is the owner''s to do.');
  end if;

  if p_archive then
    if p.archived_at is not null then
      return jsonb_build_object('ok', true, 'archived', true, 'already', true, 'name', p.project_name);
    end if;
    if p.status not like 'Closed%' then
      return jsonb_build_object('ok', false, 'code', 'STILL_OPEN', 'name', p.project_name, 'reason',
        format('%s has not ended yet. Finish it as complete, or cancel it, and then it can be put away - '
            || 'archiving something still running would take its open work off the board with it.', p.project_name));
    end if;
    -- A closed parent should not have live work under it, but the board is
    -- built from this column and an accident here hides a running job.
    select count(*) into v_kids
      from public.projects x
     where x.parent_project_id = p_project
       and x.trashed_at is null and x.archived_at is null
       and x.status not like 'Closed%';
    if v_kids > 0 then
      return jsonb_build_object('ok', false, 'reason',
        format('%s %s beneath this one %s still open. Put those away first.',
               v_kids, case when v_kids = 1 then 'job' else 'jobs' end,
               case when v_kids = 1 then 'is' else 'are' end));
    end if;

    select coalesce(u.full_name, u.email) into v_actor from public.app_users u where u.id = me;
    update public.projects
       set archived_at = now(), archived_by = coalesce(v_actor, 'owner'),
           last_modified_at = now(), last_modified_by = 'portal:archive'
     where id = p_project;
    return jsonb_build_object('ok', true, 'archived', true, 'name', p.project_name);
  end if;

  if p.archived_at is null then
    return jsonb_build_object('ok', true, 'archived', false, 'already', true, 'name', p.project_name);
  end if;
  update public.projects
     set archived_at = null, archived_by = null,
         last_modified_at = now(), last_modified_by = 'portal:unarchive'
   where id = p_project;
  return jsonb_build_object('ok', true, 'archived', false, 'name', p.project_name);
end $fn$;

comment on function public.portal_project_archive(uuid, boolean) is
  'Puts a finished or cancelled job away, or brings it back. Owner only (rank 70). Refuses a job that is still open - archiving is not an ending, it is what you do after one. Nothing is deleted.';

grant execute on function public.portal_project_archive(uuid, boolean) to authenticated;

-- THE BOARD STILL CARRIES IT, AND SAYS SO.
--
-- The obvious move is to drop archived projects out of portal_my_work the way
-- disabled and trashed ones are dropped. That would be a trap: the project
-- screen finds its seat in this same read, so an archived job would 404 and
-- there would be no way left to bring it back. So the row stays and gains a
-- flag, and the screens that list work decide.
do $patch$
declare src text; out_ text;
begin
  src := pg_get_functiondef('public.portal_my_work()'::regprocedure);
  out_ := replace(src,
    E'    ''package_code'', p.package_code,\n',
    E'    ''package_code'', p.package_code,\n    ''archived'', p.archived_at is not null,\n');
  if out_ = src then
    raise exception 'portal_my_work has drifted - the package_code line was not found';
  end if;
  execute out_;
end $patch$;

-- The portal's project overview is a list, not a doorway, so there it simply
-- goes - the same treatment disabled and trashed already get.
do $patch$
declare src text; out_ text;
begin
  src := pg_get_functiondef('public.portal_projects_overview()'::regprocedure);
  out_ := replace(src,
    E'    and p.disabled_at is null',
    E'    and p.disabled_at is null\n    and p.archived_at is null');
  if out_ = src then
    raise exception 'portal_projects_overview has drifted - the disabled_at guard was not found';
  end if;
  execute out_;
end $patch$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
