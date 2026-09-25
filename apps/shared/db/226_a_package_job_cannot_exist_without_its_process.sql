-- A PACKAGE JOB CANNOT EXIST WITHOUT ITS PROCESS.
--
-- Shahar, 2026-09-21: "how can a project from a generator type not have a
-- blue print attached to it. moving forward, we cannot have DIY generator
-- project without all the steps required which are coming from a blue print.
-- changes are possible, but the core must be there."
--
-- HOW IT HAPPENED, because the answer is not what it looks like. Nothing is
-- missing or broken:
--
--   * projects.package_code says 'generator' on Ran's job. It is set.
--   * blueprint_packages.generator points at "Add an emergency generator",
--     which has fifteen steps and is the best-written thing in the database.
--   * fn_actions_expand_blueprint already turns a blueprint into tasks the
--     moment an action carries activity_blueprint_id.
--
-- Every piece was there. NOTHING EVER CONNECTED THEM. The only code that
-- starts a package's process is homeowner_diy_checklist, called from exactly
-- one button, on the DIY booking path in the homeowner app. A job created any
-- other way - Ran's was - passes that button and nothing happens.
-- portal_project_process() exists purely to report "there is a process here
-- and it has not started", and no screen in this repo calls it.
--
-- THE COUNT SAYS IT PLAINLY: four live generator jobs, four with the process
-- never started, and Ran's running the GENERIC "Hire contractor" blueprint
-- instead - fifteen steps about bidding a job out, on a job he said he wants
-- to run himself.
--
-- So starting the process stops being something a screen remembers to offer.
-- A job that names a package gets that package's steps when it is created,
-- and gets them if its package is set later, and there is no path that skips
-- it. The steps stay editable - re-date them, add to them, close them out of
-- order - but they are there.
--
-- AND THE EXPANDER LEARNS THE TRADE, without which all of this lands in the
-- wrong place: blueprint_activity_steps carries a trade (Plumbing on the gas
-- diagram, Electrical on the jacket) and the expander dropped it, which is
-- why Ran's board shows one panel reading "Not filed under a trade - 14
-- open" next to the trade panels where the work belongs. Carrying it also
-- opens those panels by itself, because trg_actions_trade_joins_project puts
-- a trade on the job the moment a task carries one.

-- ---------------------------------------------------------------- 1. trade
do $mig$
declare
  src text; out_sql text; n int;
  a1 constant text := $q$    cadence, action_type, is_gate,
    asks, decides, answers, only_if, step_photo_url
  )$q$;
  b1 constant text := $q$    cadence, action_type, is_gate, trade,
    asks, decides, answers, only_if, step_photo_url
  )$q$;
  a2 constant text := $q$         s.action_type, coalesce(s.is_gate, false),
         s.asks, s.decides, s.answers, s.only_if, s.photo_url$q$;
  b2 constant text := $q$         s.action_type, coalesce(s.is_gate, false), s.trade,
         s.asks, s.decides, s.answers, s.only_if, s.photo_url$q$;
begin
  src := pg_get_functiondef('public.fn_actions_expand_blueprint()'::regprocedure);
  n := (length(src) - length(replace(src, a1, ''))) / length(a1);
  if n <> 1 then raise exception 'The column list matched % times, expected 1.', n; end if;
  n := (length(src) - length(replace(src, a2, ''))) / length(a2);
  if n <> 1 then raise exception 'The select list matched % times, expected 1.', n; end if;
  out_sql := replace(replace(src, a1, b1), a2, b2);
  execute out_sql;
end $mig$;

-- ------------------------------------------------------- 2. one way to start
--
-- INTERNAL ON PURPOSE. It is granted to nobody: the trigger below runs it as
-- owner, and homeowner_diy_checklist calls it after doing its own membership
-- check. A SECURITY DEFINER function that writes tasks onto any project id it
-- is handed is not something to leave reachable from a browser (rulebook 71).
create or replace function public.project_process_start(p_project uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  p public.projects;
  v_bp uuid; v_name text; v_parent uuid; v_made int := 0;
begin
  select * into p from public.projects where id = p_project;
  if p.id is null then
    return jsonb_build_object('ok', false, 'reason', 'No such project.');
  end if;
  -- A finished or binned job is history; fn_block_completed_project_writes
  -- would refuse the insert anyway, and refusing it here keeps that refusal
  -- from taking a perfectly good UPDATE on the project down with it.
  if p.trashed_at is not null or coalesce(p.status, '') like 'Closed%' then
    return jsonb_build_object('ok', true, 'skipped', 'the job is closed');
  end if;

  select bp.activity_blueprint_id, b.name into v_bp, v_name
    from public.blueprint_packages bp
    left join public.blueprint_activity b on b.id = bp.activity_blueprint_id
   where bp.code = p.package_code and bp.is_active;
  if v_bp is null then
    return jsonb_build_object('ok', true, 'skipped', 'this package has no process');
  end if;

  -- IDEMPOTENT, and this is the whole test: a parent on this job already
  -- carrying this blueprint. Re-running must never resurrect a step somebody
  -- has closed, which is also why the expander matches on step name.
  select a.id into v_parent from public.actions a
   where a.project_id = p_project and a.activity_blueprint_id = v_bp
   order by a.created_at limit 1;
  if v_parent is not null then
    return jsonb_build_object('ok', true, 'already', true, 'parent_action_id', v_parent,
      'steps', (select count(*) from public.actions c where c.parent_action_id = v_parent));
  end if;

  -- Setting activity_blueprint_id IS the expansion - trg_actions_expand_blueprint
  -- writes the steps. Nothing here inserts a step itself, so there is one
  -- expander in the database rather than two that can drift (rulebook 30).
  insert into public.actions (action, status, priority, domain, project_id, created_by, source,
                              depth_level, activity_blueprint_id, desired_outcome, notes)
  values (coalesce(v_name, p.project_name), 'Not Started', 'Medium', 'construction',
          p_project, 'system:process', 'system:process', 2, v_bp,
          'Every step this package needs is on the board, and the gates in it have been kept.',
          'These came from the package''s process. Re-date them, add to them, close them as you go - but they are the core of this job, not a suggestion.')
  returning id into v_parent;

  select count(*) into v_made from public.actions c where c.parent_action_id = v_parent;
  return jsonb_build_object('ok', true, 'parent_action_id', v_parent, 'steps', v_made, 'name', v_name);
end $fn$;

revoke all on function public.project_process_start(uuid) from public, anon, authenticated;

-- --------------------------------------------------- 3. so it cannot be missed
create or replace function public.fn_projects_process_starts()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if new.package_code is null then return new; end if;
  if tg_op = 'UPDATE' and old.package_code is not distinct from new.package_code then
    return new;
  end if;
  perform public.project_process_start(new.id);
  return new;
end $fn$;

drop trigger if exists trg_projects_process_starts on public.projects;
create trigger trg_projects_process_starts
after insert or update of package_code on public.projects
for each row execute function public.fn_projects_process_starts();

-- ------------------------------------------- 4. the homeowner button agrees
--
-- Same name, same shape, same promise to the app - but it no longer keeps a
-- second copy of the expansion, and a job whose process the trigger already
-- started is reported as already done rather than built a second time. The
-- scope-item fallback for a package with NO process is untouched.
create or replace function public.homeowner_diy_checklist(p_project uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  me uuid := public.current_app_user_id();
  p public.projects;
  pkg public.blueprint_packages;
  v_contact uuid; v_parent uuid; v_made int := 0;
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.'); end if;
  select * into p from public.projects where id = p_project;
  if p.id is null then return jsonb_build_object('ok', false, 'reason', 'No such project.'); end if;
  if not public.is_project_member(p_project) then
    return jsonb_build_object('ok', false, 'reason', 'That job is not yours.');
  end if;

  select * into pkg from public.blueprint_packages where code = p.package_code and is_active;

  -- THE PROCESS IS THE PROCESS, whichever button was pressed.
  if pkg.activity_blueprint_id is not null then
    return public.project_process_start(p_project) || jsonb_build_object('source', 'activity blueprint');
  end if;

  -- No process on this package: the scope-item list, exactly as it was.
  select id into v_parent from public.actions
   where project_id = p_project and source = 'homeowner:diy-checklist' and parent_action_id is null
   limit 1;
  if v_parent is not null then
    return jsonb_build_object('ok', true, 'already', true, 'parent_action_id', v_parent);
  end if;

  select contact_id into v_contact from public.app_users where id = me;

  insert into public.actions (action, status, priority, domain, project_id, created_by, source,
                              depth_level, assigned_to_contact_id, desired_outcome, notes)
  values ('Do it yourself: ' || coalesce(pkg.name, p.project_name), 'Not Started', 'Medium', 'construction',
          p_project, 'homeowner-app', 'homeowner:diy-checklist', 2, v_contact,
          'The job is finished to the same standard a contractor would be held to, by you.',
          'Every step below came from the package. Close them as you go; nothing here is sent to anybody.')
  returning id into v_parent;

  insert into public.actions (action, status, priority, domain, project_id, parent_action_id, created_by,
                              source, depth_level, assigned_to_contact_id, notes)
  select si.item, 'Not Started', 'Medium', 'construction', p_project, v_parent, 'homeowner-app',
         'homeowner:diy-checklist', 3, v_contact, si.owner_summary
    from public.project_scope_items si
   where si.project_id = p_project and coalesce(si.add_to_checklist, true)
   order by si.id;
  get diagnostics v_made = row_count;

  return jsonb_build_object('ok', true, 'parent_action_id', v_parent, 'steps', v_made,
                            'source', 'package scope');
end $fn$;

revoke all on function public.homeowner_diy_checklist(uuid) from public, anon;
grant execute on function public.homeowner_diy_checklist(uuid) to authenticated, service_role;
