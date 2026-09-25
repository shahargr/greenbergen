-- ONE STEP AT A TIME, AND WHICH ONE IS NOW.
--
-- Shahar, 2026-09-22, walking Ran's DIY generator end to end: permit data,
-- papers and diagrams, submit, approve, purchase, schedule, phase one,
-- inspection, phase two, inspection, close the permit. "For all this we need
-- step by step ui."
--
-- THE ENGINE IS ALREADY BUILT AND THIS IS THE LAST PIECE OF IT. All fifteen
-- steps are live on his job as real tasks carrying everything a runner needs:
-- asks, answer, decides, answers, only_if, is_gate, trade, action_type.
-- portal_step_answer records an answer, CANCELS whatever that answer rules
-- out, and closes the step. close_action keeps the gates. Nothing is missing
-- from the machine - what is missing is a screen that says "this one, now".
--
-- WHICH ONE IS NOW is the only genuinely new idea here, and it is the whole
-- value of the screen. It is not "the first one that is open": step 30 (get
-- the utility to upsize the meter) is a gate, and a job that answered
-- meter_ok = yes has had it cancelled, while a job that answered no cannot
-- touch anything below it until the utility is done. So NOW is the first
-- open step with no open gate above it, and everything below an open gate is
-- reported as waiting on that gate BY NAME - because "you cannot do this
-- yet" is useless and "you cannot do this until the town approves the
-- permits" is a fact somebody can act on.
create or replace function public.portal_project_steps(p_project uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $fn$
  with gate as (select public.is_project_member(p_project) or public.is_superadmin() as ok),
  parent as (
    select a.id, a.action, a.activity_blueprint_id,
           (select b.name from public.blueprint_activity b where b.id = a.activity_blueprint_id) as process
      from public.actions a
     where a.project_id = p_project and a.activity_blueprint_id is not null
     order by a.created_at limit 1),
  step as (
    select c.id, c.step_order, c.action, c.notes, c.asks, c.answer, c.decides, c.answers,
           c.only_if, coalesce(c.is_gate, false) as is_gate, c.trade, c.action_type,
           c.status, c.target_date, c.assigned_to,
           c.status in ('Completed') as done,
           c.status in ('Cancelled', 'Force Cancelled', 'Superseded') as off,
           (select count(*) from public.file_links fl where fl.action_id = c.id) as files
      from public.actions c
     where c.parent_action_id = (select id from parent)),
  -- An OPEN GATE stops everything below it. The lowest one that is still
  -- open is the only thing that matters to any step after it.
  blocker as (
    select min(s.step_order) as at,
           (select s2.action from step s2
             where s2.is_gate and not s2.done and not s2.off
             order by s2.step_order limit 1) as name
      from step s where s.is_gate and not s.done and not s.off),
  ranked as (
    select s.*,
           (not s.done and not s.off
            and (select at from blocker) is not null
            and s.step_order > (select at from blocker)) as blocked
      from step s)
  select case when not (select ok from gate) then null else jsonb_build_object(
    'process',  (select process from parent),
    'parent_id',(select id from parent),
    'total',    (select count(*) from ranked where not off),
    'done',     (select count(*) from ranked where done),
    'off',      (select count(*) from ranked where off),
    'blocked_by', (select name from blocker),
    -- NOW: the first thing that can actually be picked up.
    'now', (select r.id from ranked r
             where not r.done and not r.off and not r.blocked
             order by r.step_order limit 1),
    'steps', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'n', r.step_order, 'action', r.action, 'notes', r.notes,
        'asks', r.asks, 'answer', r.answer, 'decides', r.decides, 'answers', r.answers,
        'only_if', r.only_if, 'is_gate', r.is_gate, 'trade', r.trade,
        'kind', r.action_type, 'status', r.status, 'due', r.target_date,
        'who', r.assigned_to, 'files', r.files,
        'done', r.done, 'off', r.off, 'blocked', r.blocked)
        order by r.step_order)
      from ranked r), '[]'::jsonb))
  end;
$fn$;

comment on function public.portal_project_steps(uuid) is
  'The package process for a job, in order, with which step can be picked up NOW - the first open one with no open gate above it - and what every blocked step is waiting on, by name.';

revoke all on function public.portal_project_steps(uuid) from public, anon;
grant execute on function public.portal_project_steps(uuid) to authenticated, service_role;
