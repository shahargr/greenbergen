-- 129. A SEQUENCE IS NOT A SET.
--
-- Shahar (2026-09-15): "let's review the list of items under Generator. how
-- are they being ordered?"
--
-- Alphabetically, as it turned out. The generator's Tasks panel groups by
-- trade; not one of its fifteen tasks has a trade, so they all land in one
-- section and sort by date, then priority, then NAME - and thirteen of the
-- fifteen have no date, so the alphabet is what actually decides. Twelve of
-- them are the "Hire contractor" blueprint, whose whole point is an order,
-- and the screen was showing "Close (sign)" fourth and "Review proposals"
-- ninth. Sign first, read the proposals later.
--
-- WHY IT COULD NOT BE FIXED IN THE APP. The order was not there to read.
-- fn_actions_expand_blueprint copies a step's name, notes and holder onto the
-- action and nothing else; the twelve rows were written by one INSERT so they
-- share created_at to the microsecond. The sequence survived only in
-- blueprint_activity_steps, joined to the action by nothing at all.
--
-- So actions gets the one column it was missing.
alter table public.actions add column if not exists step_order integer;

comment on column public.actions.step_order is
'Where this task sits in the SEQUENCE it came from - blueprint_activity_steps.step_order, copied at expansion (fn_actions_expand_blueprint). Null on a task nobody put in an order, which is most of them: it sorts after everything numbered, never before. It is a position among SIBLINGS under one parent, not a global rank - two unrelated blueprints both start at 10.';

-- The expansion now carries the order across. Everything else is as it was.
create or replace function public.fn_actions_expand_blueprint()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_child_depth integer;
BEGIN
  IF NEW.activity_blueprint_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.activity_blueprint_id IS NOT DISTINCT FROM NEW.activity_blueprint_id THEN
    RETURN NEW;
  END IF;
  v_child_depth := least(coalesce(NEW.depth_level, 2) + 1, 5);
  INSERT INTO public.actions (
    action, status, priority, domain, project_id, engagement_id,
    parent_action_id, assigned_to, assigned_by, depth_level,
    source, created_by, notes, step_order
  )
  SELECT s.step_name,
         'Not Started',
         coalesce(NEW.priority, 'Missing'),
         NEW.domain,
         NEW.project_id,
         NEW.engagement_id,
         NEW.id,
         s.default_assigned_to,
         NEW.assigned_to,
         v_child_depth,
         'system:blueprint',
         'system:blueprint',
         s.notes,
         s.step_order
  FROM public.blueprint_activity_steps s
  WHERE s.activity_blueprint_id = NEW.activity_blueprint_id
    AND NOT EXISTS (
      SELECT 1 FROM public.actions c
      WHERE c.parent_action_id = NEW.id
        AND c.action = s.step_name
    )
  ORDER BY s.step_order;
  RETURN NEW;
END;
$function$;

-- THE TWENTY-THREE ALREADY EXPANDED, matched back to their step by name -
-- the only handle there is, and good enough because a blueprint's step names
-- are unique within it. Twenty match.
update public.actions c
   set step_order = s.step_order
  from public.actions p
  join public.blueprint_activity_steps s on s.activity_blueprint_id = p.activity_blueprint_id
 where c.parent_action_id = p.id
   and p.activity_blueprint_id is not null
   and s.step_name = c.action
   and c.step_order is null;

-- The three that do not match are not failures of the match:
--   "Draft the addendum from the three pulls" IS step 4, renamed on the job
--   when migration 114 folded the three research steps into it. Named here
--   because it is a rename, not a guess.
update public.actions c
   set step_order = 4
  from public.actions p
 where c.parent_action_id = p.id
   and p.activity_blueprint_id = 'a8ee3398-6716-4782-aca6-a58455b8892a'
   and c.action like 'Draft the addendum%'
   and c.step_order is null;
--   The other two ("Complete Apollo.io FinOps practitioner list, pages 3-4"
--   and "Distributor outreach - Ingram Micro first, then ALSO Group" on
--   CloudHiro GTM) are work a person added under the parent by hand. They are
--   not steps of the blueprint and are left null on purpose: they sort after
--   the steps, by name, which is the truth about them.

-- And the board can read it. portal_tasks already hands over parent_id,
-- parent_title and open_children - the nesting was always possible and only
-- the order was missing.
do $patch$
declare src text; out_ text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'portal_tasks';

  out_ := replace(src,
    '         a.parent_action_id, a.scope_item_id, a.completed_on, a.trade as own_trade,',
    '         a.parent_action_id, a.scope_item_id, a.completed_on, a.trade as own_trade, a.step_order,');

  out_ := replace(out_,
    E'  \'parent_id\', t.parent_action_id,\n',
    E'  \'parent_id\', t.parent_action_id,\n  \'step_order\', t.step_order,\n');

  if out_ = src then
    raise exception 'portal_tasks has drifted - neither the base select nor the parent_id key is where it was.';
  end if;
  execute out_;
end $patch$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
