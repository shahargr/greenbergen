-- 098 - A task says what kind of thing it is.
--
-- Shahar (2026-09-14): "i need to be able to log a new task. new task will
-- have: task name, work / product, desciption, attachments (camera, voice,
-- file), type: financial transaction (target cost, pay to), visual inspection,
-- backoffice, other."
--
-- Until now a task was a sentence and a stage. Two things it could never say:
--
--   WHAT IT DELIVERS - somebody doing something, or something arriving. The
--   difference decides who you chase and what "done" looks like: work is
--   finished when it is inspected, a product is finished when it is on site.
--
--   WHAT KIND IT IS - and one kind carries money. "Order the LVL, target
--   $4,200, pay Kuiken" is a task with a price on it before any payment
--   exists, which is the number a budget is built from. The other kinds are
--   there so that one is not a special case with nothing to stand beside.
--
-- The types are a TABLE, not a CHECK constraint. Shahar's list ends in
-- "other ..." and a vocabulary that will grow belongs somewhere a row can be
-- added to it (rulebook 15).

create table if not exists public.action_types (
  action_type text primary key,
  label       text not null,
  description text,
  -- Whether this kind asks for a price and a payee. Only one does today; the
  -- flag is what the screen reads, so adding a second kind that costs money
  -- is a row, not a deployment.
  needs_money boolean not null default false,
  sort_order  int     not null default 100,
  is_active   boolean not null default true
);

insert into public.action_types (action_type, label, description, needs_money, sort_order) values
  ('financial transaction', 'Financial transaction',
   'Money will change hands - a purchase, a deposit, an invoice to settle. Carries a target cost and who it is paid to, before any payment exists.', true, 1),
  ('visual inspection', 'Visual inspection',
   'Somebody has to look at it and say whether it passes - the town, the engineer, you.', false, 2),
  ('backoffice', 'Back office',
   'Paperwork that keeps the job legal and moving: permits, insurance, scheduling, chasing a document.', false, 3),
  ('other', 'Other', 'Anything that is not one of the above.', false, 99)
on conflict (action_type) do nothing;

alter table public.action_types enable row level security;
drop policy if exists action_types_read on public.action_types;
create policy action_types_read on public.action_types for select using (true);

alter table public.actions
  add column if not exists action_type       text references public.action_types(action_type),
  add column if not exists delivers          text,
  add column if not exists target_cost       numeric,
  add column if not exists pay_to_contact_id uuid references public.contacts(id);

do $$ begin
  alter table public.actions
    add constraint chk_actions_delivers check (delivers is null or delivers in ('work', 'product'));
exception when duplicate_object then null; end $$;

comment on column public.actions.delivers is
  'work = somebody does something; product = something arrives. Null on a task where the distinction does not apply.';
comment on column public.actions.target_cost is
  'What this is EXPECTED to cost, set when the task is written. Not what was paid - that is transactions, summed by portal_task_money.';
comment on column public.actions.pay_to_contact_id is
  'Who the money is expected to go to. The actual payee is on the transaction; this is the intention.';

create index if not exists ix_actions_type on public.actions (action_type) where action_type is not null;
create index if not exists ix_actions_pay_to on public.actions (pay_to_contact_id) where pay_to_contact_id is not null;

-- A price on a task that does not cost money is a number nobody will ever
-- reconcile. One place decides, so no caller has to remember.
create or replace function public.fn_actions_money_fits_type()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare v_money boolean;
begin
  if NEW.action_type is null then
    return NEW;
  end if;
  select needs_money into v_money from public.action_types where action_type = NEW.action_type;
  if not coalesce(v_money, false) then
    NEW.target_cost := null;
    NEW.pay_to_contact_id := null;
  end if;
  return NEW;
end $function$;

drop trigger if exists trg_actions_money_fits_type on public.actions;
create trigger trg_actions_money_fits_type
  before insert or update of action_type, target_cost, pay_to_contact_id
  on public.actions
  for each row execute function public.fn_actions_money_fits_type();

-- ------------------------------------------------------------ writing one --
-- There was no function for this at all: every task in the apps arrived
-- through a blueprint, a booking or a trigger. Shahar asked for the screen,
-- so here is the door it posts to - the same shape as task_payment_log, which
-- is the other thing that creates a row and hangs files off it.
create or replace function public.portal_task_create(
  p_project     uuid,
  p_action      text,
  p_type        text    default null,
  p_delivers    text    default null,
  p_description text    default null,
  p_target_cost numeric default null,
  p_pay_to      text    default null,
  p_priority    text    default null,
  p_target_date date    default null,
  p_assignee    uuid    default null,
  p_parent      uuid    default null,
  p_file_ids    uuid[]  default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  me      uuid := public.current_app_user_id();
  v_id    uuid;
  v_name  text := nullif(btrim(p_action), '');
  v_type  text := nullif(btrim(p_type), '');
  v_money boolean := false;
  v_payee uuid;
  v_dom   text;
  f       uuid;
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.'); end if;
  if p_project is null then return jsonb_build_object('ok', false, 'reason', 'A task belongs to a project.'); end if;
  if not public.can_edit_project(p_project) then
    return jsonb_build_object('ok', false, 'reason', 'Adding work to this project is not yours to do.');
  end if;
  if v_name is null then
    return jsonb_build_object('ok', false, 'reason', 'Give the task a name - what has to happen.');
  end if;

  if v_type is not null then
    select needs_money into v_money from public.action_types
     where action_type = v_type and is_active;
    if not found then
      return jsonb_build_object('ok', false, 'reason', format('"%s" is not a kind of task.', v_type));
    end if;
  end if;

  if p_delivers is not null and p_delivers not in ('work', 'product') then
    return jsonb_build_object('ok', false, 'reason', 'A task delivers work or a product.');
  end if;

  -- Only a money kind gets a payee, and the name is found or created the same
  -- way a payment's is, so the two never disagree about who a person is.
  if v_money then
    v_payee := public.contact_for_name(p_pay_to);
    if p_target_cost is not null and p_target_cost < 0 then
      return jsonb_build_object('ok', false, 'reason', 'A target cost is what you expect to spend - a positive number.');
    end if;
  end if;

  if p_parent is not null and not exists (
      select 1 from public.actions a where a.id = p_parent and a.project_id = p_project) then
    return jsonb_build_object('ok', false, 'reason', 'That parent task is not on this project.');
  end if;

  select coalesce(pr.domain, 'construction') into v_dom
    from public.projects pr where pr.id = p_project;

  insert into public.actions
    (action, desired_outcome, status, priority, domain, project_id, parent_action_id,
     target_date, assigned_to_contact_id, action_type, delivers, target_cost, pay_to_contact_id,
     source, created_by, last_modified_by)
  values
    (left(v_name, 300), nullif(btrim(p_description), ''), 'Not Started',
     coalesce(nullif(btrim(p_priority), ''), 'Missing'), v_dom, p_project, p_parent,
     p_target_date, p_assignee, v_type, p_delivers,
     case when v_money then p_target_cost end,
     case when v_money then v_payee end,
     'portal:new-task', 'portal:new-task', 'portal:new-task')
  returning id into v_id;

  -- The camera, the recording and the file. Same rule as everywhere: a file
  -- has to already belong to this project.
  if p_file_ids is not null then
    foreach f in array p_file_ids loop
      if not exists (select 1 from public.files x where x.id = f and x.project_id = p_project) then
        return jsonb_build_object('ok', false, 'reason', 'One of those files does not belong to this project.');
      end if;
      delete from public.file_links where file_id = f;
      insert into public.file_links (file_id, action_id, role, created_by_user_id)
      values (f, v_id,
              case when (select kind from public.files where id = f) = 'photo' then 'evidence' else 'invoice' end,
              me);
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'action', left(v_name, 300));
end $function$;

grant execute on function public.portal_task_create(uuid, text, text, text, text, numeric, text, text, date, uuid, uuid, uuid[]) to authenticated;

-- The screen has to be able to offer the list.
create or replace function public.portal_task_types()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
           'action_type', t.action_type, 'label', t.label,
           'description', t.description, 'needs_money', t.needs_money)
         order by t.sort_order, t.label), '[]'::jsonb)
    from public.action_types t where t.is_active;
$function$;

grant execute on function public.portal_task_types() to authenticated;

-- And the task screen has to be able to SHOW what was set.
do $patch$
declare src text; patched text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'portal_task_detail';
  if src is null then raise exception 'PATCH_NO_FUNCTION: portal_task_detail'; end if;

  patched := replace(src,
    $f$'status_note', a.status_note,$f$,
    $f$'status_note', a.status_note,
      'action_type', a.action_type, 'delivers', a.delivers, 'target_cost', a.target_cost,
      'pay_to', (select coalesce(c2.person_name, c2.name) from public.contacts c2 where c2.id = a.pay_to_contact_id),$f$);
  if patched = src then
    raise exception 'PATCH_NO_CHANGE: portal_task_detail status_note line did not match';
  end if;
  execute patched;
end $patch$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
