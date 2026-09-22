-- THE RUNNER FOLLOWS THE PACKAGE'S PROCESS, NOT THE OLDEST ONE.
--
-- 233 picked the process to walk with "the first action on this job carrying
-- an activity_blueprint_id, oldest first". On Ran's job that is the WRONG
-- ONE, and the test said so immediately:
--
--   process: "Hire contractor", total 3, off 12, now null
--
-- Ran's job carries two: the generic Hire-contractor tree somebody drafted
-- and 227 cancelled, and the generator process 227 started. The cancelled one
-- is older, so the runner opened on a finished tree with nothing to do and
-- reported that the job had three steps.
--
-- A JOB'S PROCESS IS THE ONE ITS PACKAGE NAMES. That is the whole rule, and
-- it was sitting one join away: projects.package_code ->
-- blueprint_packages.activity_blueprint_id. Oldest-first is the tie-break
-- for a job with no package, not the rule. A cancelled parent loses to a
-- live one either way.
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
      left join public.projects p on p.id = a.project_id
      left join public.blueprint_packages bp on bp.code = p.package_code
     where a.project_id = p_project and a.activity_blueprint_id is not null
     order by
       -- THE PACKAGE'S OWN PROCESS WINS. false sorts first, so a parent whose
       -- blueprint is the package's comes before every other.
       (a.activity_blueprint_id is distinct from bp.activity_blueprint_id),
       -- Then a live tree over one somebody cancelled.
       (a.status in ('Cancelled', 'Force Cancelled', 'Superseded')),
       a.created_at
     limit 1),
  step as (
    select c.id, c.step_order, c.action, c.notes, c.asks, c.answer, c.decides, c.answers,
           c.only_if, coalesce(c.is_gate, false) as is_gate, c.trade, c.action_type,
           c.status, c.target_date, c.assigned_to,
           c.status in ('Completed') as done,
           c.status in ('Cancelled', 'Force Cancelled', 'Superseded') as off,
           (select count(*) from public.file_links fl where fl.action_id = c.id) as files
      from public.actions c
     where c.parent_action_id = (select id from parent)),
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

revoke all on function public.portal_project_steps(uuid) from public, anon;
grant execute on function public.portal_project_steps(uuid) to authenticated, service_role;
