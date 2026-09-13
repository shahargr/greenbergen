-- 082  THE SCHEDULE COMPUTES ITSELF
--
-- The arithmetic half of 081. Nothing on a schedule_activity's dates is ever
-- typed: the GC gives a duration and says what follows what, and this works
-- out when everything lands, how much slack each thing has, and which chain
-- of work is the one that decides the finish date.
--
-- WHY RELAXATION AND NOT A RECURSIVE CTE. A recursive CTE over a dependency
-- graph loops forever on a cycle, and a GC will absolutely draw one - "the
-- inspection follows the rough, the rough follows the inspection" is one
-- mis-tap away. Bellman-Ford style relaxation converges in at most N passes
-- over N activities; if pass N+1 still changes something there IS a cycle,
-- and the function says so and changes nothing rather than hanging.
--
-- FLOAT IS MEASURED AGAINST THE COMPUTED FINISH, not the required one. If a
-- job is three weeks late, every activity would show negative float against
-- the required date and the critical path would drown in red. The plan's own
-- finish is the honest baseline for slack; being late is a separate number,
-- reported once at the top (days_over), which is where a person can act on it.

-- ---------------------------------------------------------------------------
-- SET A PROJECT UP WITH A SPINE. Idempotent: run it again after adding a
-- trade to the scope and it fills in what is missing without touching what
-- somebody has already tuned.
--
-- The default sequencing it lays down is the simplest true thing: stages run
-- in order, trades inside a stage run in parallel. Each stage gets a General
-- activity of zero days that marks the stage opening (and is also where work
-- with no trade sits); every trade in the stage hangs off it; the next
-- stage's General hangs off everything in the stage before. The GC then
-- overlaps what really overlaps - which is a far smaller job than drawing a
-- schedule from nothing.
create or replace function public.sched_setup(
  p_project uuid,
  p_start date default null,
  p_finish date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_stages int := 0; v_acts int := 0; v_links int := 0;
  r record; prev_stage uuid; gen uuid;
begin
  perform public.assert_own_hands();
  if not public.sched_may_edit(p_project) then
    return jsonb_build_object('ok', false, 'code', 'READ_ONLY',
      'reason', 'Only whoever runs this site can set its schedule up.');
  end if;
  if not exists (select 1 from public.projects where id = p_project and trashed_at is null) then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'reason', 'No such project.');
  end if;

  update public.projects
     set planned_start = coalesce(p_start, planned_start),
         required_finish = coalesce(p_finish, required_finish)
   where id = p_project;

  -- 1. THE SPINE, from the standard stages, in their order.
  insert into public.project_stages (project_id, stage, sort_order, from_trade_stage)
  select p_project, ts.stage, ts.sort_order, ts.stage
    from public.trade_stages ts
   where not exists (select 1 from public.project_stages s
                      where s.project_id = p_project and s.stage = ts.stage);
  get diagnostics v_stages = row_count;

  -- 2. A GENERAL activity per stage: zero days, the moment the stage opens,
  --    and the home for work that belongs to the stage but to no trade.
  insert into public.schedule_activities (project_stage_id, trade, title, duration_days)
  select s.id, null, 'General', 0
    from public.project_stages s
   where s.project_id = p_project
     and not exists (select 1 from public.schedule_activities a
                      where a.project_stage_id = s.id and a.trade is null);

  -- 3. ONE ACTIVITY PER TRADE THAT IS ACTUALLY ON THIS JOB - it has scope
  --    lines, a contract, or open work. A spine carrying all 60 trades in the
  --    catalogue would be a schedule nobody reads.
  insert into public.schedule_activities (project_stage_id, trade, duration_days)
  select s.id, t.trade, coalesce(t.default_duration_days, 5)
    from public.trades t
    join public.project_stages s
      on s.project_id = p_project
     and s.from_trade_stage is not distinct from t.stage
   where (coalesce(t.is_construction, false) or coalesce(t.is_worker_trade, false))
     and t.trade <> 'ALL'
     and (
       exists (select 1 from public.project_scope_items si
                where si.project_id = p_project and si.trade = t.trade)
       or exists (select 1 from public.contracts c
                   where c.project_id = p_project and lower(coalesce(c.trade,'')) = lower(t.trade))
       or exists (select 1 from public.contact_trade_roles ctr
                    join public.actions a on a.assigned_to_contact_id = ctr.contact_id
                   where a.project_id = p_project and ctr.trade = t.trade
                     and a.status not in ('Completed','Cancelled','Force Cancelled','Superseded'))
     )
     and not exists (select 1 from public.schedule_activities a
                      where a.project_stage_id = s.id and a.trade = t.trade);
  get diagnostics v_acts = row_count;

  -- 4. THE DEFAULT SEQUENCING. Trades hang off their stage opening; each
  --    stage opens when the one before it has finished everything.
  insert into public.activity_links (before_activity_id, after_activity_id, lag_days)
  select g.id, a.id, 0
    from public.project_stages s
    join public.schedule_activities g on g.project_stage_id = s.id and g.trade is null
    join public.schedule_activities a on a.project_stage_id = s.id and a.trade is not null
   where s.project_id = p_project
     and not exists (select 1 from public.activity_links l
                      where l.before_activity_id = g.id and l.after_activity_id = a.id);
  get diagnostics v_links = row_count;

  prev_stage := null;
  for r in select s.id, s.sort_order from public.project_stages s
            where s.project_id = p_project order by s.sort_order, s.stage
  loop
    select a.id into gen from public.schedule_activities a
     where a.project_stage_id = r.id and a.trade is null;
    if prev_stage is not null and gen is not null then
      insert into public.activity_links (before_activity_id, after_activity_id, lag_days)
      select a.id, gen, 0
        from public.schedule_activities a
       where a.project_stage_id = prev_stage
         and not exists (select 1 from public.activity_links l
                          where l.before_activity_id = a.id and l.after_activity_id = gen);
    end if;
    prev_stage := r.id;
  end loop;

  return public.sched_recompute(p_project)
      || jsonb_build_object('stages_added', v_stages, 'activities_added', v_acts);
end $function$;

comment on function public.sched_setup(uuid, date, date) is
  'Give a project a spine, an activity per trade that is really on it, and default sequencing. Idempotent - fills gaps, never overwrites tuning.';

-- ---------------------------------------------------------------------------
-- THE CRITICAL PATH METHOD, in two passes and a cycle guard.
create or replace function public.sched_recompute(p_project uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  wk int; v_start date; v_req date; v_n int; i int := 0; v_changed int;
  v_finish date; v_critical int; v_over int;
begin
  if not public.is_project_member(p_project) and not public.is_superadmin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'reason', 'That project is not yours.');
  end if;

  select case when coalesce(p.schedule_saturdays, false) then 6 else 5 end,
         coalesce(p.planned_start, (now() at time zone 'America/New_York')::date),
         p.required_finish
    into wk, v_start, v_req
    from public.projects p where p.id = p_project;
  if wk is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'reason', 'No such project.');
  end if;

  select count(*) into v_n
    from public.schedule_activities a
    join public.project_stages s on s.id = a.project_stage_id
   where s.project_id = p_project;
  if v_n = 0 then
    return jsonb_build_object('ok', true, 'activities', 0, 'reason', 'Nothing scheduled on this project yet.');
  end if;

  -- FORWARD PASS. Everything starts at the project start; then each activity
  -- is pushed out behind its predecessors until nothing moves.
  update public.schedule_activities a
     set planned_start = public.sched_workday(v_start, wk),
         planned_finish = case when a.duration_days <= 0 then public.sched_workday(v_start, wk)
                               else public.sched_add_days(v_start, a.duration_days - 1, wk) end
    from public.project_stages s
   where s.id = a.project_stage_id and s.project_id = p_project;

  loop
    i := i + 1;
    with need as (
      select a.id,
             max(public.sched_add_days(b.planned_finish, l.lag_days + 1, wk)) as es
        from public.schedule_activities a
        join public.project_stages s on s.id = a.project_stage_id and s.project_id = p_project
        join public.activity_links l on l.after_activity_id = a.id
        join public.schedule_activities b on b.id = l.before_activity_id
       group by a.id
    )
    update public.schedule_activities a
       set planned_start = n.es,
           planned_finish = case when a.duration_days <= 0 then n.es
                                 else public.sched_add_days(n.es, a.duration_days - 1, wk) end
      from need n
     where n.id = a.id and a.planned_start is distinct from n.es;
    get diagnostics v_changed = row_count;
    exit when v_changed = 0;
    if i > v_n + 1 then
      -- Only a cycle survives N+1 relaxations. Say which way round rather
      -- than leaving somebody to find it, and change nothing.
      return jsonb_build_object('ok', false, 'code', 'CYCLE',
        'reason', 'Two activities wait on each other, so no start date exists. Remove one of the links between them.');
    end if;
  end loop;

  select max(planned_finish) into v_finish
    from public.schedule_activities a
    join public.project_stages s on s.id = a.project_stage_id where s.project_id = p_project;

  -- BACKWARD PASS. The latest each activity could run without moving the
  -- computed finish. Same relaxation, pulled the other way.
  update public.schedule_activities a
     set late_finish = v_finish,
         late_start = case when a.duration_days <= 0 then v_finish
                           else public.sched_sub_days(v_finish, a.duration_days - 1, wk) end
    from public.project_stages s
   where s.id = a.project_stage_id and s.project_id = p_project;

  i := 0;
  loop
    i := i + 1;
    with need as (
      select b.id,
             min(public.sched_sub_days(a.late_start, l.lag_days + 1, wk)) as lf
        from public.schedule_activities b
        join public.project_stages s on s.id = b.project_stage_id and s.project_id = p_project
        join public.activity_links l on l.before_activity_id = b.id
        join public.schedule_activities a on a.id = l.after_activity_id
       group by b.id
    )
    update public.schedule_activities b
       set late_finish = n.lf,
           late_start = case when b.duration_days <= 0 then n.lf
                             else public.sched_sub_days(n.lf, b.duration_days - 1, wk) end
      from need n
     where n.id = b.id and b.late_finish is distinct from n.lf;
    get diagnostics v_changed = row_count;
    exit when v_changed = 0;
    exit when i > v_n + 1;   -- the forward pass already proved there is no cycle
  end loop;

  -- SLACK. Zero means this activity has nowhere to move: it is on the chain
  -- that decides the finish date.
  update public.schedule_activities a
     set float_days = public.sched_days_between(a.planned_start, a.late_start, wk)
    from public.project_stages s
   where s.id = a.project_stage_id and s.project_id = p_project;

  select count(*) into v_critical
    from public.schedule_activities a
    join public.project_stages s on s.id = a.project_stage_id
   where s.project_id = p_project and coalesce(a.float_days, 0) <= 0 and a.duration_days > 0;

  update public.projects set schedule_computed_at = now() where id = p_project;

  v_over := case when v_req is null then null
                 else public.sched_days_between(v_req, v_finish, wk) end;

  return jsonb_build_object(
    'ok', true,
    'activities', v_n,
    'starts', public.sched_workday(v_start, wk),
    'finishes', v_finish,
    'required_finish', v_req,
    -- Positive means the plan lands AFTER the date it has to hit. This is the
    -- number a GC is actually asking for and no chart should bury it.
    'days_over', v_over,
    'critical', v_critical,
    'week', wk);
end $function$;

comment on function public.sched_recompute(uuid) is
  'Forward and backward pass over a project schedule: planned dates, late dates, float, critical count, and days over the required finish. Refuses a cycle instead of hanging.';

-- ---------------------------------------------------------------------------
-- FREEZE THE PLAN. Everything after this is measured against it.
create or replace function public.sched_baseline(p_project uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_n int;
begin
  perform public.assert_own_hands();
  if not public.sched_may_edit(p_project) then
    return jsonb_build_object('ok', false, 'code', 'READ_ONLY',
      'reason', 'Only whoever runs this site can freeze its plan.');
  end if;
  update public.schedule_activities a
     set baseline_start = a.planned_start, baseline_finish = a.planned_finish
    from public.project_stages s
   where s.id = a.project_stage_id and s.project_id = p_project;
  get diagnostics v_n = row_count;
  update public.projects set schedule_baselined_at = now() where id = p_project;
  return jsonb_build_object('ok', true, 'activities', v_n);
end $function$;

comment on function public.sched_baseline(uuid) is
  'Snapshot the current plan as the baseline. Without one, "three weeks behind" has nothing to be behind of.';

revoke all on function public.sched_setup(uuid, date, date) from public, anon;
revoke all on function public.sched_recompute(uuid) from public, anon;
revoke all on function public.sched_baseline(uuid) from public, anon;
grant execute on function public.sched_setup(uuid, date, date) to authenticated;
grant execute on function public.sched_recompute(uuid) to authenticated;
grant execute on function public.sched_baseline(uuid) to authenticated;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
