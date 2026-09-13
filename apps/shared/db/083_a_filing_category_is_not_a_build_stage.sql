-- 083  A FILING CATEGORY IS NOT A BUILD STAGE
--
-- Found by running 082's setup against 55 Walnut's New build and reading what
-- it produced. The critical path computed correctly - 32 activities, finish
-- 2027-02-18 against a required 2027-06-01 - but the ORDER was wrong, and
-- wrong in a way that would have made the whole chart untrustworthy:
--
--     Others/Architecture      d=20  2027-01-22 -> 2027-02-18   float 0
--     Others/Project manager   d=5   2027-01-22 -> 2027-01-28
--     Suppliers/Supply: Lumber d=5   2027-01-14 -> 2027-01-20
--
-- Architecture was ON the critical path, scheduled last, and set the finish
-- date. On a build, architecture is one of the first things that happens. The
-- lumber was scheduled to arrive two months after framing used it.
--
-- The cause is that trade_stages is a way of FILING sixty trades into nine
-- drawers, and 082 read it as a sequence. Two of those drawers are not stages
-- of work at all:
--
--   Others     ALL, Project manager, General Contractor, Architecture,
--              Architectural Rendering, Powerwashing, Pest Control, Moving,
--              Handyman, Blinds & Shades, Bill Negotiator, Appliance Repair
--   Suppliers  Supply: Lumber, Windows, External Doors, Internal Doors &
--              Trim, Trim, Fixtures, Stone, Appliances, General
--
-- So three things, and none of them touches how a trade is FILED anywhere
-- else in the app - trades.stage keeps its meaning and every existing read
-- goes on working:
--
--   trade_stages.in_spine    is this a stage of the work, or a drawer
--   trades.schedule_stage    where this trade sits WHEN SCHEDULED
--   trades.schedulable       is this a thing you book onto a site at all

alter table public.trade_stages
  add column if not exists in_spine boolean not null default true;

comment on column public.trade_stages.in_spine is
  'Whether this is a stage of the WORK (goes in a project spine) or a drawer for filing trades. Suppliers and Others are drawers.';

update public.trade_stages set in_spine = false where stage in ('Suppliers', 'Others');

alter table public.trades
  add column if not exists schedule_stage text references public.trade_stages(stage) on update cascade,
  add column if not exists schedulable boolean not null default true;

comment on column public.trades.schedule_stage is
  'Where this trade sits when it is SCHEDULED, when that differs from where it is filed. Null means use trades.stage.';
comment on column public.trades.schedulable is
  'Whether this trade is ever booked onto a site as a bar on the schedule. A project manager runs the whole job; they are not a five-day activity.';

-- WHO IS NOT A BAR. A GC and a PM run the job from the first day to the last;
-- drawing them as an activity somewhere in the middle says something false
-- about both. ALL is a wildcard, not a trade. A bill negotiator never sets
-- foot on the site.
update public.trades set schedulable = false
 where trade in ('ALL', 'Project manager', 'General Contractor', 'Bill Negotiator');

-- WHERE THE REST REALLY BELONG.
--
-- Design and drawings come FIRST - that is the whole finding above. The
-- suppliers go with the trade that consumes them, because a supply activity
-- is a lead time and a lead time that lands after the work it feeds is not a
-- schedule, it is a note. The odds and ends at the end of a job go in
-- Finishing, where they actually happen.
update public.trades set schedule_stage = v.s
from (values
  -- Design and permits, up front.
  ('Architecture',                'Survey & environmental'),
  ('Architectural Rendering',     'Survey & environmental'),
  -- Long-lead supply, with the stage that consumes it.
  ('Supply: Lumber',              'Rough and mechanical'),
  ('Supply: Windows',             'Rough and mechanical'),
  ('Supply: External Doors',      'Rough and mechanical'),
  ('Supply: Internal Doors & Trim','Finishing'),
  ('Supply: Trim',                'Finishing'),
  ('Supply: Fixtures',            'Finishing'),
  ('Supply: Stone',               'Finishing'),
  ('Supply: Appliances',          'Finishing'),
  ('Supply: General',             'Finishing'),
  -- The tail of a job.
  ('Handyman',                    'Finishing'),
  ('Powerwashing',                'Finishing'),
  ('Blinds & Shades',             'Finishing'),
  ('Appliance Repair',            'Finishing'),
  ('Pest Control',                'Finishing'),
  ('Moving',                      'Finishing')
) as v(trade, s)
where public.trades.trade = v.trade and public.trades.schedule_stage is distinct from v.s;

-- A supply activity is a LEAD TIME, not a day's work: ordering windows is six
-- weeks of waiting. The defaults said five days, which would have hidden
-- every long lead on the job.
update public.trades set default_duration_days = v.d
from (values
  ('Supply: Lumber', 20), ('Supply: Windows', 40), ('Supply: External Doors', 40),
  ('Supply: Internal Doors & Trim', 30), ('Supply: Trim', 20), ('Supply: Fixtures', 25),
  ('Supply: Stone', 25), ('Supply: Appliances', 30), ('Supply: General', 15)
) as v(trade, d)
where public.trades.trade = v.trade and public.trades.default_duration_days is distinct from v.d;

-- ---------------------------------------------------------------------------
-- The setup reads the three new columns: only spine stages become stages,
-- only schedulable trades become bars, and a trade lands where it is
-- SCHEDULED rather than where it is filed.
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
  v_stages int := 0; v_acts int := 0;
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

  -- The spine: stages of the work, in order. Drawers are not stages.
  insert into public.project_stages (project_id, stage, sort_order, from_trade_stage)
  select p_project, ts.stage, ts.sort_order, ts.stage
    from public.trade_stages ts
   where ts.in_spine
     and not exists (select 1 from public.project_stages s
                      where s.project_id = p_project and s.stage = ts.stage);
  get diagnostics v_stages = row_count;

  insert into public.schedule_activities (project_stage_id, trade, title, duration_days)
  select s.id, null, 'General', 0
    from public.project_stages s
   where s.project_id = p_project
     and not exists (select 1 from public.schedule_activities a
                      where a.project_stage_id = s.id and a.trade is null);

  -- One bar per trade that is really on this job AND is a thing you book.
  insert into public.schedule_activities (project_stage_id, trade, duration_days)
  select s.id, t.trade, coalesce(t.default_duration_days, 5)
    from public.trades t
    join public.project_stages s
      on s.project_id = p_project
     and s.from_trade_stage is not distinct from coalesce(t.schedule_stage, t.stage)
   where (coalesce(t.is_construction, false) or coalesce(t.is_worker_trade, false))
     and t.schedulable
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

  insert into public.activity_links (before_activity_id, after_activity_id, lag_days)
  select g.id, a.id, 0
    from public.project_stages s
    join public.schedule_activities g on g.project_stage_id = s.id and g.trade is null
    join public.schedule_activities a on a.project_stage_id = s.id and a.trade is not null
   where s.project_id = p_project
     and not exists (select 1 from public.activity_links l
                      where l.before_activity_id = g.id and l.after_activity_id = a.id);

  prev_stage := null;
  for r in select s.id from public.project_stages s
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

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
