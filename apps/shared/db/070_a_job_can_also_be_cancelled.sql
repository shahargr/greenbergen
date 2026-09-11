-- 070 - a job can also be cancelled.
--
-- Shahar (2026-09-11): "close this job as complete. need to have two ways to
-- close it, as complete, or as cancelled."
--
-- The table had two endings: 'Closed - Completed' and 'Closed - Incomplete'.
-- Neither is "cancelled". Incomplete means the work happened and was left
-- unfinished - it is superadmin-only for exactly that reason, because it is
-- an admission. Cancelled means the work never happened: the homeowner
-- changed their mind, the shade was replaced under warranty, the season
-- passed. Those are different facts about a job and a GC needs to be able to
-- record the second one without asking anybody.
--
-- So 'Closed - Cancelled' joins the statuses, and the three endings divide
-- cleanly:
--
--   Closed - Completed    the work is done          zero open tasks, rank 50+
--   Closed - Cancelled    the work will not happen  a reason, rank 50+
--   Closed - Incomplete   it was abandoned mid-way  superadmin
--
-- WHAT CANCELLING DOES TO THE OPEN WORK. Completing demands zero open tasks.
-- Cancelling cannot: you cancel a job precisely because things on it are
-- undone. Leaving them open would strand them under a closed parent where
-- nothing can be written. So cancelling CANCELS them, through close_action,
-- the one path that closes a task - each one carrying the reason the job was
-- cancelled, so a task read a year from now says why it stopped.
--
-- Money is reported, not refused. A cancelled job that already took a deposit
-- is exactly the case worth seeing, and hiding it behind a refusal would only
-- keep the job open and wrong.
alter table public.projects drop constraint if exists chk_projects_status;
alter table public.projects add constraint chk_projects_status
  check (status in ('In Progress', 'Closed - Completed', 'Closed - Cancelled', 'Closed - Incomplete'));

-- The gate learns the new ending, and - the real fix here - learns to catch a
-- REOPEN out of it. The old third branch listed the two closed statuses by
-- name, so a project closed as cancelled could have been quietly reopened by
-- anyone. 'Closed%' is the test that cannot go stale the next time an ending
-- is added.
CREATE OR REPLACE FUNCTION public.fn_projects_close_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_open int;
begin
  if old.status is distinct from new.status then
    if new.status = 'Closed - Completed' then
      select count(*) into v_open from actions a
      where a.project_id = new.id
        and a.status in ('Not Started','In Progress','Parked','Pending on Others','Completed Pending Approval','Completed Pending');
      if v_open > 0 then
        raise exception 'CLOSE_COMPLETED_BLOCKED: % has % open task(s). Closed - Completed requires ZERO open tasks (hard rule, no override). Close as ''Closed - Cancelled'' if the work will not happen, or resolve the tasks.', new.project_name, v_open
          using errcode = '23514';
      end if;
    elsif new.status = 'Closed - Incomplete' then
      if coalesce(current_setting('sgr.superadmin', true), 'off') <> 'on' then
        raise exception 'CLOSE_INCOMPLETE_REQUIRES_SUPERADMIN: closing % as incomplete is approved only for a super admin.', new.project_name
          using errcode = '23514';
      end if;
    -- 'Closed - Cancelled' has no gate of its own: the work never happened,
    -- so there is nothing to be complete about. portal_project_cancel is
    -- what enforces the rank and demands the reason.
    elsif old.status like 'Closed%' then
      if coalesce(current_setting('sgr.superadmin', true), 'off') <> 'on' then
        raise exception 'REOPEN_REQUIRES_SUPERADMIN: % is closed (%). Reopening is approved only for a super admin.', old.project_name, old.status
          using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
create or replace function public.portal_project_cancel(
  p_project uuid, p_reason text default null
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  me      uuid := public.current_app_user_id();
  p       public.projects;
  v_kids  int;
  v_kid   text;
  v_paid  numeric;
  v_actor text;
  v_why   text := nullif(btrim(coalesce(p_reason, '')), '');
  t       record;
  v_cancelled int := 0;
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'Sign in first.'); end if;
  select * into p from public.projects where id = p_project and trashed_at is null;
  if p.id is null then return jsonb_build_object('ok', false, 'reason', 'No such project.'); end if;
  if not (public.is_superadmin() or coalesce(public.my_authority_rank(p_project), 0) >= 50) then
    return jsonb_build_object('ok', false, 'reason', 'Cancelling this job is not yours to do.');
  end if;
  if p.status like 'Closed%' then
    return jsonb_build_object('ok', false, 'reason', format('%s is already closed (%s).', p.project_name, p.status));
  end if;
  -- A cancelled job with no reason is a mystery to whoever finds it later.
  if v_why is null or length(v_why) < 4 then
    return jsonb_build_object('ok', false, 'reason', 'Say why it is being cancelled - a few words. This is the record of what happened.');
  end if;

  select count(*), min(x.project_name) into v_kids, v_kid
    from public.projects x
   where x.parent_project_id = p_project and x.trashed_at is null
     and x.status not like 'Closed%';
  if v_kids > 0 then
    return jsonb_build_object('ok', false, 'open_children', v_kids,
      'reason', format('%s %s beneath this one %s still open%s. Close %s first - cancelling this one would strand %s.',
                       v_kids, case when v_kids = 1 then 'job' else 'jobs' end,
                       case when v_kids = 1 then 'is' else 'are' end,
                       case when v_kids = 1 then ' (' || v_kid || ')' else '' end,
                       case when v_kids = 1 then 'it' else 'them' end,
                       case when v_kids = 1 then 'it' else 'them' end));
  end if;

  select coalesce(u.full_name, u.email) into v_actor from public.app_users u where u.id = me;

  -- The open work goes with it, BEFORE the status moves: once the project is
  -- closed, fn_block_completed_project_writes refuses to touch its tasks.
  for t in
    with recursive fam as (
      select x.id from public.projects x where x.id = p_project
      union
      select x.id from public.projects x join fam on x.parent_project_id = fam.id
       where x.trashed_at is null
    )
    select a.id from public.actions a
     where a.project_id in (select id from fam)
       and a.status in ('Not Started','In Progress','Parked','Pending on Others',
                        'Completed Pending Approval','Completed Pending')
     order by a.created_at
  loop
    update public.actions
       set notes = coalesce(notes, '') || E'\n\n[' || to_char(current_date, 'YYYY-MM-DD')
                   || '] Cancelled with the job by ' || coalesce(v_actor, 'a member') || ': ' || v_why,
           last_modified_by = 'portal:project-cancel'
     where id = t.id;
    perform public.close_action(t.id, true, coalesce(v_actor, 'portal:project-cancel'), 'Cancelled', true);
    v_cancelled := v_cancelled + 1;
  end loop;

  -- What was already spent on a job that will not happen. Reported, never a
  -- blocker - it is the reason to look, not a reason to refuse.
  select coalesce(sum(t2.amount), 0) into v_paid
    from public.transactions t2
   where t2.project_id = p_project and t2.direction = 'out'
     and coalesce(t2.status,'') in ('paid','paid - pending confirmation','paid - receipt filed','settled');

  update public.projects
     set status = 'Closed - Cancelled',
         stage = 'close',
         notes = coalesce(notes || E'\n\n', '')
                 || 'CANCELLED ' || to_char(current_date, 'YYYY-MM-DD')
                 || ' by ' || coalesce(v_actor, 'portal') || ': ' || v_why,
         last_modified_at = now(), last_modified_by = 'portal:cancel'
   where id = p_project;

  return jsonb_build_object('ok', true, 'project_id', p_project, 'name', p.project_name,
    'tasks_cancelled', v_cancelled, 'already_paid', coalesce(v_paid, 0));
end $$;

revoke all on function public.portal_project_cancel(uuid, text) from public, anon;
grant execute on function public.portal_project_cancel(uuid, text) to authenticated, service_role;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
