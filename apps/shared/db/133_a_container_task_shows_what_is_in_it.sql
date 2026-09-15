-- 133. A CONTAINER TASK SHOWS WHAT IS IN IT.
--
-- Shahar (2026-09-15), looking at "Property sign for 55 Walnut - design,
-- permit, order": "when showing tasks as containers, the top part of the task
-- should list all its kids tasks."
--
-- The screen said "1 step still open beneath this" and stopped there. A count
-- is the one fact about a container that cannot be acted on: it tells you
-- something is in the way without telling you what, so the next move is
-- always to go and find the list somewhere else. On a task whose NAME is a
-- sequence - design, permit, order - that is absurd.
--
-- portal_task_detail has counted the children since it was written and never
-- named them. Now it hands the list over, in the blueprint's own order
-- (step_order, migration 129), done ones in place rather than sorted to the
-- bottom - a checklist is read down the sequence, and a step that is finished
-- is most useful where it happened.
--
-- is_gate comes with each one, because the sentence under the old count was
-- about gates: "the database blocks a parent while a gate child is open."
-- Which child? It never said. Now it can.
do $patch$
declare src text; out_ text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'portal_task_detail';

  out_ := replace(src,
    E'      \'open_children\', (select count(*) from actions ch where ch.parent_action_id = a.id\n',
    E'      \'children\', coalesce((select jsonb_agg(jsonb_build_object(\n'
    || E'          \'id\', k.id, \'action\', k.action, \'status\', k.status,\n'
    || E'          \'target_date\', k.target_date, \'completed_on\', k.completed_on,\n'
    || E'          \'step_order\', k.step_order, \'is_gate\', coalesce(k.is_gate, false),\n'
    || E'          \'open\', k.status not in (\'Completed\',\'Cancelled\',\'Force Cancelled\',\'Superseded\'),\n'
    || E'          \'holder\', coalesce(\n'
    || E'            (select coalesce(kc.person_name, kc.name) from contacts kc where kc.id = k.assigned_to_contact_id),\n'
    || E'            (select kp.name from personas kp where kp.id = k.assigned_to_persona_id),\n'
    || E'            k.assigned_to),\n'
    || E'          \'open_children\', (select count(*) from actions g where g.parent_action_id = k.id\n'
    || E'                             and g.status not in (\'Completed\',\'Cancelled\',\'Force Cancelled\',\'Superseded\')))\n'
    || E'        order by k.step_order nulls last, k.target_date nulls last, k.action)\n'
    || E'        from actions k where k.parent_action_id = a.id), \'[]\'::jsonb),\n'
    || E'      \'open_children\', (select count(*) from actions ch where ch.parent_action_id = a.id\n');

  if out_ = src then
    raise exception 'portal_task_detail has drifted - the open_children key is not where it was.';
  end if;
  execute out_;
end $patch$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
