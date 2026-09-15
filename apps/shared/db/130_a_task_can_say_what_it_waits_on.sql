-- 130. A TASK CAN SAY WHAT IT WAITS ON, AND WHAT IT IS PART OF.
--
-- Shahar (2026-09-15): "allow to create dependencies between tasks : after ...
-- or before ... / allow a task to point to a parent task."
--
-- Both columns have been on actions since the beginning and neither has ever
-- had a door: follows_action_id carries 2 rows in the whole database and
-- parent_action_id carries 143, every one of them written by a blueprint
-- expansion or by hand in SQL. Nothing in any app could set either.
--
-- AFTER AND BEFORE ARE ONE EDGE, SEEN FROM TWO ENDS. "A comes after B" and
-- "B comes before A" are the same fact, so there is one column and no second
-- table: 'after' writes this task's follows_action_id, 'before' writes the
-- OTHER task's. Saying it both ways is a courtesy to the person holding the
-- phone, not two kinds of link - and it is why 'before' needs edit rights on
-- the other task, because that is the row it changes.
--
-- follows_action_id is single-valued: a task waits on ONE thing. That is a
-- real limit and it is deliberate for now - the alternative is an edge table,
-- and nothing in the product asks for two predecessors yet. Where it would
-- overwrite somebody else's answer the function refuses and says which task
-- is already there, rather than quietly replacing it.

-- Two walks, written once. `union` rather than `union all` so a cycle that
-- already exists in the data terminates instead of hanging.
create or replace function public.action_kin(p_action uuid)
returns table (id uuid)
language sql stable
set search_path to 'public'
as $$
  with recursive kin as (
    select a.id from public.actions a where a.id = p_action
    union
    select c.id from public.actions c join kin on c.parent_action_id = kin.id
  )
  select kin.id from kin;
$$;
comment on function public.action_kin(uuid) is
'A task and everything beneath it, by parent_action_id. Used to stop a task being made a child of its own descendant, and to keep such a task out of the list you pick a parent from.';

create or replace function public.action_chain(p_action uuid)
returns table (id uuid)
language sql stable
set search_path to 'public'
as $$
  with recursive ch as (
    select a.id, a.follows_action_id from public.actions a where a.id = p_action
    union
    select x.id, x.follows_action_id from public.actions x join ch on x.id = ch.follows_action_id
  )
  select ch.id from ch;
$$;
comment on function public.action_chain(uuid) is
'A task and everything it waits on, up the follows_action_id chain. Used to stop "after" closing a loop where each task waits on the next.';

create or replace function public.portal_task_link(p_action uuid, p_rel text, p_other uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  me uuid := public.current_app_user_id();
  a public.actions; o public.actions;
  v_rel text := lower(btrim(coalesce(p_rel, '')));
  v_target uuid;   -- the row this call actually writes
  v_closed constant text[] := array['Completed','Cancelled','Force Cancelled','Superseded'];
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'Sign in first.'); end if;
  if v_rel not in ('after','before','unbefore','parent') then
    return jsonb_build_object('ok', false, 'reason', 'Unknown kind of link.');
  end if;
  if not public.can_see_action(p_action) then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'reason', 'That task is not yours to change.');
  end if;
  select * into a from public.actions where id = p_action;

  -- CLEARING. Only the two links this task owns can be cleared from here;
  -- "this no longer blocks that" is 'unbefore', which names the other task.
  if p_other is null then
    if v_rel = 'after' then
      if not public.can_edit_project(a.project_id) then
        return jsonb_build_object('ok', false, 'code', 'READ_ONLY', 'reason', 'You have read-only access on this project.');
      end if;
      update public.actions set follows_action_id = null, last_updated = now(), last_modified_by = 'portal:task-link'
       where id = a.id;
      return jsonb_build_object('ok', true, 'cleared', 'after');
    elsif v_rel = 'parent' then
      if not public.can_edit_project(a.project_id) then
        return jsonb_build_object('ok', false, 'code', 'READ_ONLY', 'reason', 'You have read-only access on this project.');
      end if;
      update public.actions set parent_action_id = null, depth_level = 2,
             last_updated = now(), last_modified_by = 'portal:task-link'
       where id = a.id;
      return jsonb_build_object('ok', true, 'cleared', 'parent');
    end if;
    return jsonb_build_object('ok', false, 'reason', 'Say which task.');
  end if;

  if p_other = p_action then
    return jsonb_build_object('ok', false, 'reason', 'A task cannot depend on itself.');
  end if;
  if not public.can_see_action(p_other) then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'reason', 'That other task is not one you can see.');
  end if;
  select * into o from public.actions where id = p_other;

  -- WHOSE ROW CHANGES decides whose project has to let you write.
  v_target := case when v_rel in ('before','unbefore') then o.id else a.id end;
  if not public.can_edit_project((select x.project_id from public.actions x where x.id = v_target)) then
    return jsonb_build_object('ok', false, 'code', 'READ_ONLY',
      'reason', case when v_target = o.id
                     then 'That task is on a project you can only read.'
                     else 'You have read-only access on this project.' end);
  end if;
  if (select x.status from public.actions x where x.id = v_target) = any (v_closed) then
    return jsonb_build_object('ok', false, 'code', 'CLOSED',
      'reason', 'That task has ended - its links are part of the record now.');
  end if;

  -- SAME FAMILY. A task may wait on something on the job above it or below
  -- it; it may not wait on an unrelated job's work, which would be a
  -- dependency nobody on either job can see whole.
  if not (o.project_id = a.project_id
          or o.project_id in (select project_id from public.project_ancestry(a.project_id))
          or a.project_id in (select project_id from public.project_ancestry(o.project_id))) then
    return jsonb_build_object('ok', false, 'reason', 'Those two tasks are on unrelated jobs.');
  end if;

  if v_rel = 'parent' then
    if o.project_id <> a.project_id then
      return jsonb_build_object('ok', false, 'reason', 'A step has to sit on the same job as the task it is part of.');
    end if;
    if exists (select 1 from public.action_kin(a.id) k where k.id = o.id) then
      return jsonb_build_object('ok', false,
        'reason', format('"%s" already sits beneath this task. It cannot also be above it.', o.action));
    end if;
    update public.actions
       set parent_action_id = o.id,
           depth_level = least(coalesce(o.depth_level, 2) + 1, 5),
           last_updated = now(), last_modified_by = 'portal:task-link'
     where id = a.id;
    return jsonb_build_object('ok', true, 'rel', 'parent', 'other', o.action);

  elsif v_rel = 'after' then
    if exists (select 1 from public.action_chain(o.id) c where c.id = a.id) then
      return jsonb_build_object('ok', false,
        'reason', format('"%s" already waits on this task, directly or down the chain. That would be a loop.', o.action));
    end if;
    if a.follows_action_id is not null and a.follows_action_id <> o.id then
      return jsonb_build_object('ok', false, 'code', 'ALREADY',
        'reason', format('This already comes after "%s". Clear that first - a task waits on one thing.',
                         (select x.action from public.actions x where x.id = a.follows_action_id)));
    end if;
    update public.actions set follows_action_id = o.id, last_updated = now(), last_modified_by = 'portal:task-link'
     where id = a.id;
    return jsonb_build_object('ok', true, 'rel', 'after', 'other', o.action);

  elsif v_rel = 'before' then
    if exists (select 1 from public.action_chain(a.id) c where c.id = o.id) then
      return jsonb_build_object('ok', false,
        'reason', format('This task already waits on "%s", directly or down the chain. That would be a loop.', o.action));
    end if;
    if o.follows_action_id is not null and o.follows_action_id <> a.id then
      return jsonb_build_object('ok', false, 'code', 'ALREADY',
        'reason', format('"%s" already comes after "%s". A task waits on one thing.', o.action,
                         (select x.action from public.actions x where x.id = o.follows_action_id)));
    end if;
    update public.actions set follows_action_id = a.id, last_updated = now(), last_modified_by = 'portal:task-link'
     where id = o.id;
    return jsonb_build_object('ok', true, 'rel', 'before', 'other', o.action);

  else -- unbefore
    update public.actions set follows_action_id = null, last_updated = now(), last_modified_by = 'portal:task-link'
     where id = o.id and follows_action_id = a.id;
    return jsonb_build_object('ok', true, 'cleared', 'before', 'other', o.action);
  end if;
end $function$;

comment on function public.portal_task_link(uuid, text, uuid) is
'The one door to a task''s two links. p_rel: after (this waits on p_other), before (p_other waits on this), unbefore (it no longer does), parent (this is a step of p_other). p_other null clears after or parent. Refuses loops, cross-job links outside the project family, a second predecessor, and any write to a task that has ended.';

-- The task screen can read them back, and knows what it may offer to link to.
do $patch$
declare src text; out_ text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'portal_task_detail';

  out_ := replace(src,
    E'      \'open_children\', (select count(*) from actions ch where ch.parent_action_id = a.id\n',
    E'      \'parent\', (select jsonb_build_object(\'id\', pa.id, \'action\', pa.action, \'status\', pa.status)\n'
    || E'                  from actions pa where pa.id = a.parent_action_id),\n'
    || E'      \'follows\', (select jsonb_build_object(\'id\', fa.id, \'action\', fa.action, \'status\', fa.status,\n'
    || E'                           \'done\', fa.status in (\'Completed\',\'Cancelled\',\'Force Cancelled\',\'Superseded\'))\n'
    || E'                   from actions fa where fa.id = a.follows_action_id),\n'
    || E'      \'blocks\', coalesce((select jsonb_agg(jsonb_build_object(\'id\', b.id, \'action\', b.action, \'status\', b.status)\n'
    || E'                                   order by b.action)\n'
    || E'                           from actions b where b.follows_action_id = a.id), \'[]\'::jsonb),\n'
    || E'      \'link_options\', coalesce((select jsonb_agg(jsonb_build_object(\'id\', x.id, \'action\', x.action, \'open\', x.is_open))\n'
    || E'        from (select x2.id, x2.action, x2.step_order,\n'
    || E'                     (x2.status not in (\'Completed\',\'Cancelled\',\'Force Cancelled\',\'Superseded\')) as is_open\n'
    || E'                from actions x2\n'
    || E'               where x2.project_id = a.project_id and x2.id <> a.id\n'
    || E'                 and not exists (select 1 from public.action_kin(a.id) k where k.id = x2.id)\n'
    || E'               order by 4 desc, x2.step_order nulls last, x2.action\n'
    || E'               limit 100) x), \'[]\'::jsonb),\n'
    || E'      \'open_children\', (select count(*) from actions ch where ch.parent_action_id = a.id\n');

  if out_ = src then
    raise exception 'portal_task_detail has drifted - the open_children key is not where it was.';
  end if;
  execute out_;
end $patch$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
