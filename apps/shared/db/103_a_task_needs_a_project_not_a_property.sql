-- 103. A TASK NEEDS A PROJECT, NOT A PROPERTY.
--
-- Shahar hit this trying to add a task while standing on "55 Walnut Drive":
--
--   Tasks live on a project, not on the property itself. Open or start a
--   project under "55 Walnut Drive" and add the task there.
--
-- That is fn_actions_not_on_property talking, and it is right: 55 Walnut Drive
-- is the HOUSE - the folder that holds New build, Standby generator, Mortgage,
-- Property taxes. Work hangs off one of those, not off the address.
--
-- The rule was only ever stated at the moment of refusal, though, which is the
-- worst place for it: you type the task, you press the button, and the screen
-- tells you where you should have been. These two functions say the same thing
-- BEFORE the typing, and hand the screen the list of places the task could go.
--
-- The rule itself is not restated here - portal_task_takes_tasks reads the
-- same three facts the trigger reads, so a project the trigger would accept is
-- exactly a project this offers.

-- Would fn_actions_not_on_property let a task live here?
--   no address at all      - an office project, a program: yes
--   a blueprint code       - Mortgage, Insurance, Property taxes: yes
--   an address, under an addressed parent - New build under 55 Walnut: yes
--   an address, at the top of its tree     - the property itself: NO
--
-- Invoker rights on purpose: a project you cannot see answers "no", which is
-- the safe answer, rather than confirming it exists.
create or replace function public.portal_task_takes_tasks(p_project uuid)
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select coalesce((
    select case
      when p.address is null then true
      when p.home_blueprint_code is not null then true
      when (select q.address from public.projects q where q.id = p.parent_project_id) is not null then true
      else false
    end
    from public.projects p
    where p.id = p_project
  ), false);
$$;

comment on function public.portal_task_takes_tasks(uuid) is
  'True when public.actions may carry this project_id - the same three facts fn_actions_not_on_property checks, asked before the insert instead of after.';

-- What the New task screen needs to know: whether it may add work here, and
-- if not, which projects under this roof it could add it to. The standing
-- blueprint projects (Mortgage, Insurance, taxes) sort after the real work,
-- because somebody standing on site means the build, not the escrow.
create or replace function public.portal_task_targets(p_project uuid)
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  select jsonb_build_object(
    'project_id', p_project,
    'project_name', (select project_name from public.projects where id = p_project),
    'takes_tasks', public.portal_task_takes_tasks(p_project),
    'options', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.standing, x.open_tasks desc, x.name)
      from (
        select c.id,
               c.project_name as name,
               (c.home_blueprint_code is not null) as standing,
               (select count(*) from public.actions a
                 where a.project_id = c.id and a.completed_on is null) as open_tasks
        from public.projects c
        where c.parent_project_id = p_project
          and coalesce(c.status, '') not ilike 'Closed%'
          and public.portal_task_takes_tasks(c.id)
      ) x
    ), '[]'::jsonb)
  );
$$;

comment on function public.portal_task_targets(uuid) is
  'For the New task screen: may a task be added to this project, and if not, which projects beneath it are open to one.';

grant execute on function public.portal_task_takes_tasks(uuid) to authenticated;
grant execute on function public.portal_task_targets(uuid) to authenticated;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
