-- 105. A PROPERTY HAS ONE OBVIOUS PROJECT.
--
-- Shahar (2026-09-14), looking at the chooser migration 103 put in front of
-- him: "i'm in 55 walnut drive; clicking on add task should have been for 55
-- walnut by default (new build) and not showing me others."
--
-- He is right. 103 fixed the refusal and stopped there - it turned "no" into
-- a list of thirteen doors, six of which are the same two generators entered
-- twice and seven of which are mortgage and insurance. Standing on site with
-- a phone, there is one project a task belongs to: the build.
--
-- So portal_task_targets now also names the DEFAULT - the busiest piece of
-- real work under this roof - and the screen goes straight there. The list is
-- still one tap away behind Change, because "busiest" is a good guess and a
-- guess should never be a locked door.
--
-- Why busiest and not newest: open tasks are what a live job has and a
-- finished or never-started one does not. On 55 Walnut that is New build with
-- 131, against 3 for an EV charger and 0 for a generator nobody has started.
create or replace function public.portal_task_targets(p_project uuid)
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  with opts as (
    select c.id,
           c.project_name as name,
           (c.home_blueprint_code is not null) as standing,
           (select count(*) from public.actions a
             where a.project_id = c.id and a.completed_on is null) as open_tasks
      from public.projects c
     where c.parent_project_id = p_project
       and coalesce(c.status, '') not ilike 'Closed%'
       and public.portal_task_takes_tasks(c.id)
  )
  select jsonb_build_object(
    'project_id', p_project,
    'project_name', (select project_name from public.projects where id = p_project),
    'takes_tasks', public.portal_task_takes_tasks(p_project),
    -- Where a task goes if nobody says otherwise: real work before the
    -- standing blueprints, the one carrying the most open work first. Null
    -- when there is no real work under this roof at all, and then the screen
    -- asks rather than guessing.
    'default_id', (select id from opts where not standing
                    order by open_tasks desc, name limit 1),
    'options', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.standing, x.open_tasks desc, x.name)
        from opts x), '[]'::jsonb)
  );
$$;

comment on function public.portal_task_targets(uuid) is
  'For the New task screen: may a task be added to this project, which project beneath it is the obvious home for one, and what the rest of them are.';

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
