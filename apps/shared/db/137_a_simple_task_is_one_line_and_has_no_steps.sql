-- 137. A SIMPLE TASK IS ONE LINE, AND HAS NO STEPS.
--
-- Shahar (2026-09-15), standing in a trade with its tasks in front of him:
-- "you need to be able to either do like a subtask, which is simple, versus
-- the new task, which is a big one with all the different steps... Simple
-- task is task that you cannot have any child to, for example. It inherits
-- the trade and all that information, so it's kind of pre-populated. A
-- complex task is when you have it all."
--
-- Two different acts wearing one button. "Call the framer about the landing"
-- is a note to yourself; "Internal stairs" is a package of work with a scope,
-- a contract, a payee and four steps. Making the first one cost the second
-- one's three passes is how a thought that took four seconds to have stops
-- being written down at all.
--
-- SIMPLE IS A PROMISE, NOT A SHORTCUT. The thing that makes it safe to write
-- in one line is that it can never grow: no steps beneath it, ever. So it is
-- a column and a rule rather than a screen that merely asks for less - a
-- task's shape has to be true wherever you meet it, and there are three other
-- doors (the wizard's parent picker, portal_task_link, a blueprint) that
-- would otherwise hang children off a note.
alter table public.actions
  add column if not exists accepts_steps boolean not null default true;

comment on column public.actions.accepts_steps is
'Whether work may be filed BENEATH this task. False on a simple task - the one-line kind logged from a trade screen (migration 137) - and enforced by fn_actions_parent_accepts_steps, not merely by the screen that made it. A simple task is a note with a holder and a date; the moment something has steps it is a package of work and belongs in the three-pass wizard.';

-- THE RULE, WHEREVER A CHILD COMES FROM. The wizard's parent picker,
-- portal_task_link, a blueprint expansion, a hand-written insert - all of them
-- land here.
create or replace function public.fn_actions_parent_accepts_steps()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
declare v_parent text;
begin
  if new.parent_action_id is null then return new; end if;
  if tg_op = 'UPDATE' and old.parent_action_id is not distinct from new.parent_action_id then
    return new;
  end if;
  select a.action into v_parent
    from public.actions a
   where a.id = new.parent_action_id and a.accepts_steps = false;
  if found then
    raise exception '"%" is a simple task: it is one line and takes no steps beneath it.', v_parent
      using errcode = '23514';
  end if;
  return new;
end $function$;

comment on function public.fn_actions_parent_accepts_steps() is
'Refuses any task whose parent is a simple one. The promise a simple task makes - it will never grow steps - is what makes it safe to write in a single line, so it is kept here rather than in the screen that made it.';

drop trigger if exists trg_actions_parent_accepts_steps on public.actions;
create trigger trg_actions_parent_accepts_steps
  before insert or update of parent_action_id on public.actions
  for each row execute function public.fn_actions_parent_accepts_steps();

-- THE DOOR. One call, one line, everything else inherited from where you were
-- standing. It does not touch portal_task_create's signature - seventeen
-- parameters is enough for one function - it calls it and then keeps the
-- promise.
create or replace function public.portal_task_quick(
  p_project uuid, p_action text, p_trade text default null,
  p_target_date date default null, p_assignee uuid default null,
  p_priority text default null, p_parent uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare r jsonb; v_id uuid;
begin
  r := public.portal_task_create(
    p_project => p_project,
    p_action  => p_action,
    p_delivers => 'work',
    p_priority => p_priority,
    p_target_date => p_target_date,
    p_assignee => p_assignee,
    p_parent => p_parent,
    p_trade => p_trade);
  if not coalesce((r->>'ok')::boolean, false) then return r; end if;

  v_id := (r->>'id')::uuid;
  update public.actions set accepts_steps = false where id = v_id;

  return r || jsonb_build_object('simple', true);
end $function$;

comment on function public.portal_task_quick(uuid, text, text, date, uuid, text, uuid) is
'A simple task: one line, logged where you are standing, inheriting the trade (and the parent, when it is a step of something). Everything portal_task_create checks is still checked - it is that function underneath - and the row comes back with accepts_steps false, so nothing can ever be filed beneath it.';

-- The task screen has to know, or it will keep offering "Add a step under
-- this" on a task the database will refuse.
do $patch$
declare src text; out_ text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'portal_task_detail';

  out_ := replace(src,
    E'      \'requires_photo_evidence\', a.requires_photo_evidence,\n',
    E'      \'requires_photo_evidence\', a.requires_photo_evidence,\n'
    || E'      \'accepts_steps\', a.accepts_steps,\n');

  if out_ = src then
    raise exception 'portal_task_detail has drifted - the requires_photo_evidence key is not where it was.';
  end if;
  execute out_;
end $patch$;

-- And portal_task_link says it in words rather than letting the trigger's
-- exception reach a person.
do $patch$
declare src text; out_ text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'portal_task_link';

  out_ := replace(src,
    E'  if v_rel = \'parent\' then\n',
    E'  if v_rel = \'parent\' then\n'
    || E'    if o.accepts_steps = false then\n'
    || E'      return jsonb_build_object(\'ok\', false, \'code\', \'NO_STEPS\',\n'
    || E'        \'reason\', format(\'"%s" is a simple task: it is one line and takes no steps beneath it.\', o.action));\n'
    || E'    end if;\n');

  if out_ = src then
    raise exception 'portal_task_link has drifted - the parent arm is not where it was.';
  end if;
  execute out_;
end $patch$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
