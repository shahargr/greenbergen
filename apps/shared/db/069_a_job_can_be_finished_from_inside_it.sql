-- 069 - a job can be finished from inside it.
--
-- Shahar (2026-09-11), on "Fix the motorized shade" at 52 Ryerson, a job with
-- nothing open left on it: "The scope was complete / no place to close it as
-- complete from inside?"
--
-- There was not. Closing a project has always been possible - the rules for
-- it are old and good - but the only door was the portal's Setup tab, at
-- owner rank, through a status dropdown. The Professionals app, which is
-- where the person who actually finished the work is standing, had none.
--
-- THE RULES ALREADY EXIST and none of them move here:
--   * 'Closed - Completed' requires ZERO open tasks on the project.
--     fn_projects_close_gate calls that a hard rule with no override, and it
--     is right: a job with work still on it is not complete, it is abandoned.
--   * 'Closed - Incomplete' and REOPENING are superadmin only.
--   * A closed project is FROZEN - fn_block_completed_project_writes refuses
--     writes to its tasks, contracts and transactions afterwards.
--   * Closing raises the project's surveys (fn_projects_raise_surveys_on_close).
--
-- What this adds is the door, and two things the raw status update never
-- checked because a trigger on one row cannot see a family:
--
--   1. OPEN WORK BENEATH IT. The gate counts tasks on the project itself. A
--      property closed while three jobs under it are live would pass that
--      gate and leave the work orphaned above a closed parent. So the whole
--      family is counted, and a live child project refuses the close on its
--      own.
--   2. The stage moves to 'close' with the status, so the two do not
--      disagree - which they do today on every project closed by hand.
--
-- Money is NOT a blocker. An unpaid balance on a finished job is a real and
-- common state - the work is done, the last invoice is not paid yet - and
-- refusing to close it would only teach people to lie about the work. The
-- function reports what is outstanding so the screen can say so out loud.
create or replace function public.portal_project_close(
  p_project uuid, p_note text default null
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  me        uuid := public.current_app_user_id();
  p         public.projects;
  v_open    int;
  v_kids    int;
  v_kid     text;
  v_owed    numeric;
  v_actor   text;
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'Sign in first.'); end if;
  select * into p from public.projects where id = p_project and trashed_at is null;
  if p.id is null then return jsonb_build_object('ok', false, 'reason', 'No such project.'); end if;
  if not (public.is_superadmin() or coalesce(public.my_authority_rank(p_project), 0) >= 50) then
    return jsonb_build_object('ok', false, 'reason', 'Finishing this job is not yours to do.');
  end if;
  if p.status like 'Closed%' then
    return jsonb_build_object('ok', false, 'reason', format('%s is already closed (%s).', p.project_name, p.status));
  end if;

  -- Everything at or beneath it.
  with recursive fam as (
    select x.id from public.projects x where x.id = p_project
    union
    select x.id from public.projects x join fam on x.parent_project_id = fam.id
     where x.trashed_at is null
  )
  select count(*) into v_open
    from public.actions a
   where a.project_id in (select id from fam)
     and a.status in ('Not Started','In Progress','Parked','Pending on Others',
                      'Completed Pending Approval','Completed Pending');

  if v_open > 0 then
    return jsonb_build_object('ok', false, 'open_tasks', v_open,
      'reason', format('%s %s still open on this job. Complete or cancel %s, then close it - a job with work left on it is not finished.',
                       v_open, case when v_open = 1 then 'task is' else 'tasks are' end,
                       case when v_open = 1 then 'it' else 'them' end));
  end if;

  select count(*), min(x.project_name) into v_kids, v_kid
    from public.projects x
   where x.parent_project_id = p_project and x.trashed_at is null
     and x.status not like 'Closed%';
  if v_kids > 0 then
    return jsonb_build_object('ok', false, 'open_children', v_kids,
      'reason', format('%s %s beneath this one still open%s. Close %s first.',
                       v_kids, case when v_kids = 1 then 'job is' else 'jobs are' end,
                       case when v_kids = 1 then ' (' || v_kid || ')' else '' end,
                       case when v_kids = 1 then 'it' else 'them' end));
  end if;

  -- Reported, never refused: a finished job with an unpaid balance is a
  -- normal Tuesday.
  select coalesce(sum(c.amount), 0)
       - coalesce(sum((select coalesce(sum(t.amount), 0) from public.transactions t
                        where t.contract_id = c.id and t.direction = 'out'
                          and coalesce(t.status,'') in ('paid','paid - pending confirmation','paid - receipt filed','settled'))), 0)
    into v_owed
    from public.contracts c
   where c.project_id = p_project and c.status not in ('placeholder','Cancelled','cancelled');

  select coalesce(u.full_name, u.email) into v_actor from public.app_users u where u.id = me;

  update public.projects
     set status = 'Closed - Completed',
         stage = 'close',
         notes = case when nullif(btrim(coalesce(p_note, '')), '') is null then notes
                      else coalesce(notes || E'\n\n', '')
                           || 'CLOSED ' || to_char(current_date, 'YYYY-MM-DD')
                           || ' by ' || coalesce(v_actor, 'portal') || ': ' || btrim(p_note) end,
         last_modified_at = now(), last_modified_by = 'portal:close'
   where id = p_project;

  return jsonb_build_object('ok', true, 'project_id', p_project, 'name', p.project_name,
    'outstanding', greatest(coalesce(v_owed, 0), 0));
end $$;

-- ---------------------------------------------------------------------------
-- REOPEN. Superadmin only, because the close froze the record and something
-- may have been written against that freeze.
--
-- fn_projects_close_gate asks for the superadmin SETTING by name, so this has
-- to turn it on - and that setting is not a note to one trigger. is_superadmin()
-- returns true for anything that reads it, so 'sgr.superadmin = on' grants
-- superadmin to EVERYTHING for the rest of the transaction. A probe of this
-- function caught exactly that: the next call in the same transaction, made by
-- a person with no seat on the project, sailed through.
--
-- PostgREST gives each RPC its own transaction, so the blast radius in
-- production is one statement - but "it happens to be contained" is not a
-- rule, it is a coincidence. So the setting is raised immediately before the
-- one UPDATE that needs it and put back immediately after, including on the
-- way out of an error, and what it is put back TO is whatever it was, not
-- 'off' - a caller who legitimately had it on keeps it.
create or replace function public.portal_project_reopen(p_project uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare p public.projects; v_actor text; v_prev text;
begin
  perform public.assert_own_hands();
  if not public.is_superadmin() then
    return jsonb_build_object('ok', false, 'reason', 'Reopening a closed job is a superadmin decision.');
  end if;
  select * into p from public.projects where id = p_project;
  if p.id is null then return jsonb_build_object('ok', false, 'reason', 'No such project.'); end if;
  if p.status not like 'Closed%' then
    return jsonb_build_object('ok', false, 'reason', format('%s is not closed.', p.project_name));
  end if;

  select coalesce(u.full_name, u.email) into v_actor
    from public.app_users u where u.id = public.current_app_user_id();

  v_prev := coalesce(current_setting('sgr.superadmin', true), '');
  perform set_config('sgr.superadmin', 'on', true);
  begin
    update public.projects
       set status = 'In Progress',
           stage = case when stage = 'close' then 'active' else stage end,
           notes = coalesce(notes || E'\n\n', '')
                   || 'REOPENED ' || to_char(current_date, 'YYYY-MM-DD')
                   || ' by ' || coalesce(v_actor, 'portal')
                   || coalesce(': ' || nullif(btrim(p_reason), ''), '') || '.',
           last_modified_at = now(), last_modified_by = 'portal:reopen'
     where id = p_project;
  exception when others then
    perform set_config('sgr.superadmin', v_prev, true);
    raise;
  end;
  perform set_config('sgr.superadmin', v_prev, true);

  return jsonb_build_object('ok', true, 'project_id', p_project, 'name', p.project_name);
end $$;

revoke all on function public.portal_project_close(uuid, text) from public, anon;
revoke all on function public.portal_project_reopen(uuid, text) from public, anon;
grant execute on function public.portal_project_close(uuid, text) to authenticated, service_role;
grant execute on function public.portal_project_reopen(uuid, text) to authenticated, service_role;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
