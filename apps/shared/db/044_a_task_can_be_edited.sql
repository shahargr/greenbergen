-- 044 - a task can be edited from the task screen.
--
-- Shahar, on the task screen: "i need a way to update the task ... who is
-- it pending on, and stage. subject, comment, anything else you can add to
-- tasks?"
--
-- Until now the apps could POST to a task (a note, evidence, close it) but
-- never change the task itself - the subject, the outcome, the stage, who
-- holds the ball, the priority, the date, the assignee. Those edits were
-- portal-only. This is one function that takes a PATCH: only the keys
-- present change, so the form can send what it shows and nothing else.
--
-- The vocabulary is the database's (rulebook 15, read live): status and
-- priority are CHECK constraints and fn_actions_normalize_enums canonises
-- the spelling; pending_category is a CHECK; a Pending stage needs a
-- pending_reason (chk_actions_pending_reason). Two stages are NOT settable
-- here: Completed and Cancelled go through portal_close_task / close_action,
-- which record the why and hold the photo gate (rulebook 11). A closed task
-- is not edited here either - reopening is a portal action.
--
-- Who may: someone who can edit the project (owner, manager, collaborator,
-- with billing current) - the same gate portal_close_task uses. A viewer
-- reads; a member of a sibling project sees nothing.
create or replace function public.portal_task_edit(p_action_id uuid, p_patch jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  a public.actions; me uuid := public.current_app_user_id();
  v_status text; v_assignee uuid; v_date date;
  changed text[] := '{}';
begin
  perform public.assert_own_hands();
  if me is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.can_see_action(p_action_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'reason', 'That task is not yours to edit.');
  end if;
  select * into a from public.actions where id = p_action_id;
  if not public.can_edit_project(a.project_id) then
    return jsonb_build_object('ok', false, 'code', 'READ_ONLY', 'reason', 'You have read-only access on this project.');
  end if;
  if a.status in ('Completed','Cancelled','Force Cancelled') then
    return jsonb_build_object('ok', false, 'code', 'CLOSED', 'reason', 'This task is ' || lower(a.status) || '. Reopening is a portal action.');
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'BAD_PATCH', 'reason', 'Nothing to change.');
  end if;

  -- Subject.
  if p_patch ? 'action' then
    if nullif(btrim(p_patch->>'action'), '') is null then
      return jsonb_build_object('ok', false, 'code', 'NO_SUBJECT', 'reason', 'A task needs a subject.');
    end if;
    if btrim(p_patch->>'action') is distinct from a.action then
      a.action := btrim(p_patch->>'action'); changed := array_append(changed, 'subject');
    end if;
  end if;
  -- Desired outcome (rulebook 13: the end state, not the work).
  if p_patch ? 'desired_outcome' and nullif(btrim(p_patch->>'desired_outcome'), '') is distinct from a.desired_outcome then
    a.desired_outcome := nullif(btrim(p_patch->>'desired_outcome'), ''); changed := array_append(changed, 'outcome');
  end if;
  -- Priority: the trigger canonises spelling and refuses anything else.
  if p_patch ? 'priority' and nullif(btrim(p_patch->>'priority'), '') is distinct from a.priority then
    a.priority := coalesce(nullif(btrim(p_patch->>'priority'), ''), 'Missing'); changed := array_append(changed, 'priority');
  end if;
  -- Due date. An empty string clears it.
  if p_patch ? 'target_date' then
    begin
      v_date := nullif(btrim(p_patch->>'target_date'), '')::date;
    exception when others then
      return jsonb_build_object('ok', false, 'code', 'BAD_DATE', 'reason', 'That is not a date.');
    end;
    if v_date is distinct from a.target_date then a.target_date := v_date; changed := array_append(changed, 'date'); end if;
  end if;
  -- Stage. Open stages only; closing has its own door.
  if p_patch ? 'status' then
    v_status := btrim(p_patch->>'status');
    if lower(v_status) in ('completed','done','complete','closed','cancelled','canceled','force cancelled') then
      return jsonb_build_object('ok', false, 'code', 'USE_CLOSE', 'reason', 'Use Mark complete to close a task - it records the why and the photo.');
    end if;
    if v_status is distinct from a.status then a.status := v_status; changed := array_append(changed, 'stage'); end if;
  end if;
  -- Who holds the ball, and why. Pending on Others requires a reason.
  if p_patch ? 'pending_on' and nullif(btrim(p_patch->>'pending_on'), '') is distinct from a.pending_on then
    a.pending_on := nullif(btrim(p_patch->>'pending_on'), ''); changed := array_append(changed, 'pending on');
  end if;
  if p_patch ? 'pending_reason' and nullif(btrim(p_patch->>'pending_reason'), '') is distinct from a.pending_reason then
    a.pending_reason := nullif(btrim(p_patch->>'pending_reason'), ''); changed := array_append(changed, 'pending reason');
  end if;
  if p_patch ? 'pending_category' and nullif(btrim(p_patch->>'pending_category'), '') is distinct from a.pending_category then
    a.pending_category := nullif(btrim(p_patch->>'pending_category'), ''); changed := array_append(changed, 'pending category');
  end if;
  if a.status like '%Pending%' and nullif(btrim(coalesce(a.pending_reason, '')), '') is null then
    return jsonb_build_object('ok', false, 'code', 'NEEDS_REASON', 'reason', 'Pending on Others needs a reason - what are you waiting for, from whom.');
  end if;
  -- Assignee: a person on the project, or nobody. A persona assignee (an
  -- agent) is cleared when a person takes it - chk_assigned_to_one_owner.
  if p_patch ? 'assignee' then
    v_assignee := nullif(btrim(p_patch->>'assignee'), '')::uuid;
    if v_assignee is not null and not exists (
        select 1 from public.project_members pm
         where pm.project_id in (select project_id from public.project_ancestry(a.project_id))
           and pm.status = 'active'
           and coalesce(pm.contact_id, (select u.contact_id from public.app_users u where u.id = pm.app_user_id)) = v_assignee) then
      return jsonb_build_object('ok', false, 'code', 'NOT_ON_PROJECT', 'reason', 'That person is not on this project.');
    end if;
    if v_assignee is distinct from a.assigned_to_contact_id then
      a.assigned_to_contact_id := v_assignee;
      if v_assignee is not null then a.assigned_to_persona_id := null; a.assigned_to := null; end if;
      changed := array_append(changed, 'assignee');
    end if;
  end if;

  if cardinality(changed) = 0 then return jsonb_build_object('ok', true, 'changed', '[]'::jsonb); end if;

  update public.actions set
    action = a.action, desired_outcome = a.desired_outcome, priority = a.priority, target_date = a.target_date,
    status = a.status, pending_on = a.pending_on, pending_reason = a.pending_reason, pending_category = a.pending_category,
    assigned_to_contact_id = a.assigned_to_contact_id, assigned_to_persona_id = a.assigned_to_persona_id, assigned_to = a.assigned_to,
    last_updated = now(), last_modified_by = 'portal:task-edit'
  where id = a.id;

  return jsonb_build_object('ok', true, 'changed', to_jsonb(changed));
end $$;

comment on function public.portal_task_edit(uuid, jsonb) is
  'Edit an open task from an app: a PATCH of subject (action), desired_outcome, priority, target_date, status (open stages only - closing goes through portal_close_task), pending_on / pending_reason / pending_category, and assignee (a contact on the project, or null). Only keys present change. Gated by can_edit_project; the vocabulary is enforced by the CHECK constraints and fn_actions_normalize_enums.';

revoke all on function public.portal_task_edit(uuid, jsonb) from public, anon;
grant execute on function public.portal_task_edit(uuid, jsonb) to authenticated, service_role;

-- The detail carries the one field the form needs that it did not: the
-- pending category. Everything else it already had.
create or replace function public.portal_task_detail(p_task uuid)
returns jsonb
language sql stable security definer set search_path to 'public'
as $function$
  select case
    when a.id is null or not public.is_project_member(a.project_id) then null
    else jsonb_build_object(
      'id', a.id, 'action', a.action, 'status', a.status, 'priority', a.priority,
      'target_date', a.target_date, 'desired_outcome', a.desired_outcome, 'notes', a.notes,
      'pending_on', a.pending_on, 'pending_reason', a.pending_reason, 'pending_category', a.pending_category,
      'requires_photo_evidence', a.requires_photo_evidence,
      'created_at', a.created_at, 'created_by', a.created_by, 'last_updated', a.last_updated,
      'project_id', a.project_id,
      'project', (select p.project_name from projects p where p.id = a.project_id),
      'can_edit', public.can_edit_project(a.project_id),
      'assignee', (select jsonb_build_object('id', c.id, 'name', coalesce(c.person_name, c.name))
                   from contacts c where c.id = a.assigned_to_contact_id),
      'evidence', coalesce((
        select jsonb_agg(jsonb_build_object('id', f.id, 'file_name', f.file_name, 'kind', f.kind,
                                            'bucket', f.bucket, 'path', f.path, 'role', fl.role)
                         order by f.created_at desc)
        from file_links fl join files f on f.id = fl.file_id
        where fl.action_id = a.id), '[]'::jsonb),
      'comments', coalesce((
        select jsonb_agg(jsonb_build_object('author', c.author, 'body', left(c.body, 300),
                                            'created_at', c.created_at)
                         order by c.created_at desc)
        from (select ac.author, ac.body, ac.created_at
                from action_comments ac where ac.action_id = a.id
               order by ac.created_at desc limit 8) c), '[]'::jsonb),
      'open_children', (select count(*) from actions ch where ch.parent_action_id = a.id
                        and ch.status not in ('Completed','Cancelled','Force Cancelled','Superseded'))
    ) end
  from actions a where a.id = p_task;
$function$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
