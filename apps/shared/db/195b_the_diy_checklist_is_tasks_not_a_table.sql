-- 195b: the DIY checklist, as TASKS (rulebook 42).
--
-- NOT THROUGH trg_actions_expand_blueprint, and the reason matters. That
-- trigger does exactly this shape of work - set activity_blueprint_id on a
-- parent and it writes one child per blueprint_activity_step - but it does
-- not read hidden_from_owner, because every caller it has today is a builder
-- or a trade, for whom "ours only" steps are the point. Pointed at a
-- homeowner it would put our internal steps on their list. So this function
-- selects the steps itself and never sets activity_blueprint_id on the
-- parent, which would fire the trigger and add the hidden ones back.
--
-- TWO SOURCES, IN ORDER OF HOW MUCH THEY KNOW. blueprint_activity_steps is
-- the real procedure - ordered, with the questions each step asks and the
-- gates - and exactly one package carries it today (generator). Everything
-- else falls back to the scope lines homeowner_book already copied, which is
-- a thinner list but a true one. A package with neither gets a parent and no
-- children rather than a lie.
--
-- GENERATING FOR GATES ALREADY PASSED IS THE THING SECTION 42 WARNS ABOUT,
-- and it does not apply here: this runs at take-on, on a project created
-- seconds earlier, so every gate is still ahead.

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
  v_contact uuid;
  v_parent uuid;
  v_made int := 0;
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.'); end if;
  select * into p from public.projects where id = p_project;
  if p.id is null then return jsonb_build_object('ok', false, 'reason', 'No such project.'); end if;
  if not public.is_project_member(p_project) then
    return jsonb_build_object('ok', false, 'reason', 'That job is not yours.');
  end if;

  -- Idempotent: the checklist is generated once. Re-running after somebody
  -- has ticked half of it must not resurrect what they closed.
  select id into v_parent from public.actions
   where project_id = p_project and source = 'homeowner:diy-checklist' and parent_action_id is null
   limit 1;
  if v_parent is not null then
    return jsonb_build_object('ok', true, 'already', true, 'parent_action_id', v_parent);
  end if;

  select contact_id into v_contact from public.app_users where id = me;
  select * into pkg from public.blueprint_packages where code = p.package_code and is_active;

  insert into public.actions (action, status, priority, domain, project_id, created_by, source,
                              depth_level, assigned_to_contact_id, desired_outcome, notes)
  values ('Do it yourself: ' || coalesce(pkg.name, p.project_name), 'Not Started', 'Medium', 'construction',
          p_project, 'homeowner-app', 'homeowner:diy-checklist', 2, v_contact,
          'The job is finished to the same standard a contractor would be held to, by you.',
          'Every step below came from the package. Close them as you go; nothing here is sent to anybody.')
  returning id into v_parent;

  if pkg.activity_blueprint_id is not null then
    insert into public.actions (action, status, priority, domain, project_id, parent_action_id, created_by,
                                source, depth_level, step_order, assigned_to_contact_id, notes,
                                asks, decides, answers, only_if, is_gate, step_photo_url)
    select s.step_name, 'Not Started', 'Medium', 'construction', p_project, v_parent, 'homeowner-app',
           'homeowner:diy-checklist', 3, s.step_order, v_contact, s.notes,
           s.asks, s.decides, s.answers, s.only_if, coalesce(s.is_gate, false), s.photo_url
      from public.blueprint_activity_steps s
     where s.activity_blueprint_id = pkg.activity_blueprint_id
       and coalesce(s.hidden_from_owner, false) = false
     order by s.step_order;
    get diagnostics v_made = row_count;
  end if;

  if v_made = 0 then
    insert into public.actions (action, status, priority, domain, project_id, parent_action_id, created_by,
                                source, depth_level, assigned_to_contact_id, notes)
    select si.item, 'Not Started', 'Medium', 'construction', p_project, v_parent, 'homeowner-app',
           'homeowner:diy-checklist', 3, v_contact, si.owner_summary
      from public.project_scope_items si
     where si.project_id = p_project and coalesce(si.add_to_checklist, true)
     order by si.id;
    get diagnostics v_made = row_count;
  end if;

  return jsonb_build_object('ok', true, 'parent_action_id', v_parent, 'steps', v_made,
                            'source', case when pkg.activity_blueprint_id is not null and v_made > 0
                                           then 'activity blueprint' else 'package scope' end);
end $fn$;

comment on function public.homeowner_diy_checklist(uuid) is
  'Generate the DIY checklist for a job as ACTIONS (rulebook 42: a scope line with no task is invisible). One parent plus one child per step, from blueprint_activity_steps where the package has them - skipping hidden_from_owner - else from the project scope lines. Idempotent: it refuses to run twice, so re-running never resurrects steps the owner has closed.';

revoke all on function public.homeowner_diy_checklist(uuid) from public;
grant execute on function public.homeowner_diy_checklist(uuid) to authenticated, service_role;

update public.config set schema_version = 464, schema_updated_at = current_date;
