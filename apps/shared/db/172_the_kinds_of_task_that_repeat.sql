-- 172: THE KINDS OF TASK THAT REPEAT.
--
-- Shahar (2026-09-17): "i am seeing myself creating similar tasks and go
-- through the entire process every time. let's define few types of tasks
-- that normally repeats. for example, make sure the contractor did ___. or,
-- flag item as delivered and on site, when we are starting to gather assets
-- and ship them on-site. another type of task, is document stages. for
-- example, video after rough is completed and before walls are closed. and
-- gather warranties for all mechanical and appliances, log a payment,
-- purchase an item for the house." Then: "The 6 types are good start."
--
-- The columns for all of it already existed - action_type, delivers,
-- requires_photo_evidence, documentation_stage, target_cost,
-- pay_to_contact_id, is_gate, follows_action_id - and every screen asked for
-- them one at a time. A KIND is the recipe that fills them: what the sheet
-- asks (two or three things), what the task is called, what closes it, and
-- what follows it. task_kinds is a lookup that grows by insert (rulebook
-- 15); actions.kind records which recipe wrote the row, so the follow-on
-- (Buy, paid -> Deliver) and the screens can read it.
--
-- The six:
--   check     "Make sure {who} did {what}"     - photo closes it
--   deliver   "{item} delivered and on site"   - photo on site closes it
--   document  "Record {stage} of {trade}"      - media closes it; may be a gate
--   gather    "Collect {what} for {trades}"    - one child per contract, files close them
--   buy       "Buy {item} for the house"       - a financial transaction; paid, it spawns a Deliver
--   pay       Log a payment                     - already exists; the sheet links to it

-- ---------------------------------------------------------------------------
-- Two kinds of work the type list did not name.
insert into public.action_types (action_type, label, description, needs_money, sort_order, is_active)
values ('delivery', 'Delivery', 'Something arrives on site - ordered, delivered, on site. Closes with a photo of it there.', false, 4, true),
       ('documentation', 'Documentation', 'A record of a stage before it is covered - photos or video, from a vantage point you can stand in again.', false, 5, true)
on conflict (action_type) do nothing;

-- ---------------------------------------------------------------------------
create table if not exists public.task_kinds (
  kind            text primary key,
  label           text not null,
  sentence        text not null,          -- how the sheet says it: "Make sure {who} did {what}"
  hint            text,                   -- under the box
  asks            text[] not null,        -- the fields the sheet shows: what, trade, when, who, cost, supplier, stage, gate, trades
  action_type     text references public.action_types(action_type),
  delivers        text check (delivers is null or delivers in ('work','product')),
  requires_photo  boolean not null default false,
  closes_with     text,                   -- photo | file | yesno | payment - what "done" is made of, in words
  follow_kind     text references public.task_kinds(kind),
  default_priority text not null default 'Medium',
  sort_order      integer not null default 100,
  is_active       boolean not null default true
);
comment on table public.task_kinds is
  'The recipes for tasks that repeat (migration 172). A kind names what the sheet asks, what the task is called, what closes it and what follows it. Grows by insert.';

insert into public.task_kinds (kind, label, sentence, hint, asks, action_type, delivers, requires_photo, closes_with, follow_kind, default_priority, sort_order) values
  ('check',    'Check',    'Make sure they did it',
     'What should be true on site. Closes with a photo of it, and a yes or a no.',
     array['what','trade','when','who'], 'visual inspection', 'work', true, 'photo', null, 'Medium', 10),
  ('deliver',  'Deliver',  'Delivered and on site',
     'The thing that is coming. Ordered, delivered, on site - closes with a photo of it there.',
     array['what','supplier','when','trade','who'], 'delivery', 'product', true, 'photo', null, 'Medium', 20),
  ('document', 'Document', 'Record a stage before it is covered',
     'Video after rough, before the walls close. Closes when the media is attached.',
     array['what','trade','stage','gate','when','who'], 'documentation', 'work', true, 'file', null, 'High', 30),
  ('gather',   'Gather',   'Collect one thing from every contract',
     'Warranties, insurance certificates, lien waivers, manuals. One step per contract in the trades you pick.',
     array['what','trades','when','who'], 'backoffice', 'work', false, 'file', null, 'Medium', 40),
  ('buy',      'Buy',      'Buy something for the house',
     'What, roughly what it costs, and from whom. Paid, it turns into a Deliver task by itself.',
     array['what','cost','supplier','when','trade','who'], 'financial transaction', 'product', false, 'payment', null, 'Medium', 50),
  ('pay',      'Pay',      'Log a payment', 'Opens the payment screen.', array[]::text[], 'financial transaction', null, false, 'payment', null, 'Medium', 60)
on conflict (kind) do nothing;
update public.task_kinds set follow_kind = 'deliver' where kind = 'buy' and follow_kind is null;

alter table public.actions add column if not exists kind text references public.task_kinds(kind);
comment on column public.actions.kind is
  'The recipe that wrote this task (task_kinds, migration 172). Null on a task written any other way.';

-- ---------------------------------------------------------------------------
-- What the sheet needs to draw the kinds: the recipes and the stage list.
create or replace function public.portal_task_kinds()
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'kinds', coalesce((select jsonb_agg(jsonb_build_object(
               'kind', k.kind, 'label', k.label, 'sentence', k.sentence, 'hint', k.hint,
               'asks', to_jsonb(k.asks), 'closes_with', k.closes_with, 'follow', k.follow_kind)
             order by k.sort_order) from public.task_kinds k where k.is_active), '[]'::jsonb),
    'stages', coalesce((select jsonb_agg(jsonb_build_object('stage', s.stage, 'description', s.description)
             order by s.sort_order) from public.documentation_stages s), '[]'::jsonb));
$$;
revoke all on function public.portal_task_kinds() from public, anon;
grant execute on function public.portal_task_kinds() to authenticated;

-- ---------------------------------------------------------------------------
-- ONE KIND, A FEW FIELDS, ONE TASK (or a parent and its children, for Gather).
--
-- p_fields: what, trade, contract, who (contact), when (date), cost,
-- supplier (text), stage, gate (bool), trades (text[]), file_ids (uuid[]).
create or replace function public.portal_task_from_kind(p_project uuid, p_kind text, p_fields jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  k         public.task_kinds%rowtype;
  v_what    text := nullif(btrim(coalesce(p_fields->>'what', '')), '');
  v_trade   text := nullif(btrim(coalesce(p_fields->>'trade', '')), '');
  v_who     uuid := nullif(p_fields->>'who', '')::uuid;
  v_when    date := nullif(p_fields->>'when', '')::date;
  v_cost    numeric := nullif(p_fields->>'cost', '')::numeric;
  v_supplier text := nullif(btrim(coalesce(p_fields->>'supplier', '')), '');
  v_stage   text := nullif(btrim(coalesce(p_fields->>'stage', '')), '');
  v_gate    boolean := coalesce((p_fields->>'gate')::boolean, false);
  v_contract uuid := nullif(p_fields->>'contract', '')::uuid;
  v_files   uuid[];
  v_trades  text[];
  v_party   text;
  v_title   text;
  v_note    text;
  v_id      uuid;
  v_n       integer := 0;
  r         jsonb;
  c         record;
begin
  select * into k from public.task_kinds where kind = lower(coalesce(p_kind, '')) and is_active;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NO_KIND', 'reason', format('"%s" is not a kind of task we have.', p_kind));
  end if;
  if k.kind = 'pay' then
    return jsonb_build_object('ok', false, 'code', 'USE_PAYMENT_SCREEN', 'reason', 'A payment is logged on the payment screen, against the task it belongs to.');
  end if;
  if v_what is null then
    return jsonb_build_object('ok', false, 'reason', 'Say what it is - one line.');
  end if;
  if v_who is null then v_who := public.my_contact_id(); end if;
  if p_fields ? 'file_ids' and jsonb_typeof(p_fields->'file_ids') = 'array' then
    select array_agg(x::uuid) into v_files from jsonb_array_elements_text(p_fields->'file_ids') x;
  end if;
  if p_fields ? 'trades' and jsonb_typeof(p_fields->'trades') = 'array' then
    select array_agg(x) into v_trades from jsonb_array_elements_text(p_fields->'trades') x;
  end if;

  -- The contract behind the trade, when one is awarded, and who is on it.
  if v_contract is null and v_trade is not null then
    select ct.id into v_contract
      from public.contracts ct
     where ct.project_id in (select f.id from public.project_ancestry_down(p_project) f)
       and lower(ct.trade) = lower(v_trade)
       and lower(coalesce(ct.status, '')) in ('signed', 'awarded', 'active', 'complete')
       and public.can_see_contract(ct.id)
     order by ct.created_at desc limit 1;
  end if;
  if v_contract is not null then
    select coalesce(co.person_name, co.name) into v_party
      from public.contracts ct
      join public.contacts co on co.id = coalesce(ct.contractor_id, ct.counterparty_contact_id)
     where ct.id = v_contract;
  end if;

  -- What it is called, and the first word on where it stands.
  case k.kind
    when 'check' then
      v_title := 'Check: ' || v_what;
      v_note  := 'Not checked yet' || case when v_party is not null then ' — ' || v_party || '''s work' else '' end;
    when 'deliver' then
      v_title := 'Deliver: ' || v_what;
      v_note  := 'Ordered' || case when v_supplier is not null then ' from ' || v_supplier else '' end
              || case when v_when is not null then ', expected ' || to_char(v_when, 'Mon DD') else '' end;
    when 'document' then
      if v_stage is null or not exists (select 1 from public.documentation_stages s where s.stage = v_stage) then
        return jsonb_build_object('ok', false, 'reason', 'Which stage - before, during, after?');
      end if;
      v_title := 'Record ' || lower(v_stage) || ': ' || v_what;
      v_note  := 'Not recorded yet';
    when 'gather' then
      v_title := 'Gather ' || v_what;
      v_note  := 'Nothing collected yet';
    when 'buy' then
      v_title := 'Buy: ' || v_what;
      v_note  := 'To buy' || case when v_supplier is not null then ' from ' || v_supplier else '' end
              || case when v_cost is not null then ', about $' || to_char(v_cost, 'FM999,999,990') else '' end;
    else
      v_title := v_what; v_note := null;
  end case;

  r := public.portal_task_create(
    p_project => p_project,
    p_action  => v_title,
    p_type    => k.action_type,
    p_delivers => k.delivers,
    p_description => case k.kind
      when 'check'    then 'Confirmed on site, with an after photo, that ' || coalesce(v_party, 'the contractor') || ' did it.'
      when 'deliver'  then 'It is on site, photographed where it was put down.'
      when 'document' then 'The ' || lower(v_stage) || ' record exists, attached here, from a vantage point you can stand in again.'
      when 'gather'   then 'One copy per contract, attached to its step below.'
      when 'buy'      then 'Bought and paid for; the payment is logged against this task. Paid, a Deliver task follows by itself.'
      else null end,
    p_target_cost => case when k.kind = 'buy' then v_cost end,
    p_priority => k.default_priority,
    p_target_date => v_when,
    p_assignee => v_who,
    p_file_ids => v_files,
    p_trade => v_trade,
    p_contract => v_contract,
    p_requires_photo => k.requires_photo,
    p_is_gate => case when k.kind = 'document' then v_gate else false end);
  if not coalesce((r->>'ok')::boolean, false) then return r; end if;
  v_id := (r->>'id')::uuid;

  update public.actions
     set kind = k.kind,
         status_note = v_note,
         documentation_stage = case when k.kind = 'document' then v_stage end,
         accepts_steps = (k.kind = 'gather'),
         notes = case when v_supplier is not null then 'From ' || v_supplier else notes end
   where id = v_id;

  -- GATHER: one step per contract in the trades chosen. A trade with no
  -- contract still gets a step, named for the trade, so nothing is skipped
  -- quietly.
  if k.kind = 'gather' and v_trades is not null then
    for c in
      select t.trade,
             ct.id as contract_id,
             (select coalesce(co.person_name, co.name) from public.contacts co
               where co.id = coalesce(ct.contractor_id, ct.counterparty_contact_id)) as party
        from unnest(v_trades) t(trade)
        left join public.contracts ct
          on lower(ct.trade) = lower(t.trade)
         and ct.project_id in (select f.id from public.project_ancestry_down(p_project) f)
         and lower(coalesce(ct.status, '')) not in ('cancelled', 'void', 'placeholder')
         and public.can_see_contract(ct.id)
       order by t.trade, ct.created_at
    loop
      r := public.portal_task_create(
        p_project => p_project,
        p_action  => v_what || ' — ' || coalesce(c.party, 'nobody appointed yet') || ' (' || c.trade || ')',
        p_type    => 'backoffice',
        p_delivers => 'work',
        p_priority => k.default_priority,
        p_target_date => v_when,
        p_assignee => v_who,
        p_parent => v_id,
        p_trade => c.trade,
        p_contract => c.contract_id);
      if coalesce((r->>'ok')::boolean, false) then
        update public.actions set kind = 'gather', accepts_steps = false, status_note = 'Not collected yet'
         where id = (r->>'id')::uuid;
        v_n := v_n + 1;
      end if;
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'action', v_title, 'kind', k.kind,
                            'children', v_n, 'follow', k.follow_kind, 'party', v_party);
end $$;
revoke all on function public.portal_task_from_kind(uuid, text, jsonb) from public, anon;
grant execute on function public.portal_task_from_kind(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- WHAT FOLLOWS. A Buy that is paid becomes a Deliver by itself: same item,
-- same job, same holder, linked back by follows_action_id. Once.
create or replace function public.fn_actions_kind_follows()
returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare v_follow text; v_item text;
begin
  if new.kind is null or new.status <> 'Completed' or coalesce(old.status, '') = 'Completed' then return new; end if;
  select follow_kind into v_follow from public.task_kinds where kind = new.kind;
  if v_follow is distinct from 'deliver' then return new; end if;
  if exists (select 1 from public.actions f where f.follows_action_id = new.id) then return new; end if;
  v_item := regexp_replace(new.action, '^Buy:\s*', '');
  insert into public.actions
    (action, status, priority, domain, project_id, trade, contract_id,
     assigned_to_contact_id, action_type, delivers, requires_photo_evidence,
     kind, follows_action_id, status_note, desired_outcome, accepts_steps,
     source, created_by, last_modified_by)
  values
    ('Deliver: ' || v_item, 'Not Started', coalesce(new.priority, 'Medium'), new.domain, new.project_id,
     new.trade, new.contract_id, new.assigned_to_contact_id, 'delivery', 'product', true,
     'deliver', new.id, 'Paid — waiting for it to arrive',
     'It is on site, photographed where it was put down.', false,
     'system:kind:buy', 'system:kind:buy', 'system:kind:buy');
  return new;
end $$;

drop trigger if exists trg_actions_kind_follows on public.actions;
create trigger trg_actions_kind_follows
  after update of status on public.actions
  for each row execute function public.fn_actions_kind_follows();

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
