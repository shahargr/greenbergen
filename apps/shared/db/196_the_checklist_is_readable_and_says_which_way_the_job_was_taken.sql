-- 196: read the DIY checklist, and say which way the job was taken.
--
-- A SEPARATE FUNCTION RATHER THAN A BIGGER homeowner_booking. That one is
-- 8.4k of SQL and the screen's whole read; growing it to carry a list that
-- only the DIY branch renders would put the risk of a rewrite on every other
-- state of the screen for no gain. The page already fetches its reads
-- together, so this costs a key in the same round, not a round.
--
-- SECURITY INVOKER on purpose (rulebook 71): it reads actions and projects,
-- both of which have policies, so a job that is not yours returns nothing
-- without this function having to test anything. A hole punched here would
-- be a hole to maintain.
--
-- It also carries projects.delivery, because the screen needs to say DIY or
-- hired and that is the same question asked of the same row.

create or replace function public.homeowner_checklist(p_project uuid)
returns jsonb
language sql
stable
set search_path to 'public'
as $fn$
  select jsonb_build_object(
    'project_id', p.id,
    'delivery', p.delivery,
    'parent_action_id', (select a.id from public.actions a
                          where a.project_id = p.id
                            and a.source = 'homeowner:diy-checklist'
                            and a.parent_action_id is null limit 1),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id,
               'action', c.action,
               'status', c.status,
               'notes', c.notes,
               'asks', c.asks,
               'is_gate', coalesce(c.is_gate, false),
               'done', c.status in ('Completed','Cancelled','Force Cancelled')
             ) order by c.step_order nulls last, c.created_at)
        from public.actions c
        join public.actions par on par.id = c.parent_action_id
       where par.project_id = p.id
         and par.source = 'homeowner:diy-checklist'
         and par.parent_action_id is null
    ), '[]'::jsonb)
  )
  from public.projects p
  where p.id = p_project;
$fn$;

comment on function public.homeowner_checklist(uuid) is
  'The DIY checklist for one job, plus projects.delivery so the screen can say DIY or hired. SECURITY INVOKER: RLS on projects and actions decides what comes back, so a job that is not yours returns nothing without this function testing anything.';

revoke all on function public.homeowner_checklist(uuid) from public;
grant execute on function public.homeowner_checklist(uuid) to authenticated, service_role;

update public.config set schema_version = 465, schema_updated_at = current_date;
