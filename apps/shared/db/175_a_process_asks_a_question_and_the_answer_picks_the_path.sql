-- 175: A PROCESS ASKS A QUESTION, AND THE ANSWER PICKS THE PATH.
--      THE EMERGENCY GENERATOR, IN THE ORDER IT ACTUALLY HAPPENS.
--
-- Shahar (2026-09-17): "my goal is to have as many projects as we can with
-- an easy to follow step by step process on each. starting with Emergency
-- generator, the process must include: 1. calculation of current max BTU
-- consumption 2. validation if current GAS meter can accommodate additional
-- generator 3. if yes, easy to proceed with plumber prep work of a gas
-- diagram and sign the mechanical permit. if not, need to engage the utility
-- company asking to expand the meter 4. With gas cleared out, electric can
-- complete the jacket and electrical permit for the job 5. once approved,
-- can proceed to schedule the work and purchase generator, transfer switch,
-- generator pad and generator battery."
--
-- The blueprint machinery could already write a list of steps in order. What
-- it could not do is ASK - and his step 3 is a question whose answer changes
-- the path. So three things a step can now carry, all optional, all
-- copied down when a process is expanded onto a job:
--
--   asks    - the one thing to record when this step closes ("Total
--             connected load, in BTU per hour"). It is a prompt, not a
--             validator: the answer is text, because a real answer is often
--             "about 420,000, the pool heater is off in winter".
--   decides - this step's answer is a NAMED FACT the rest of the process
--             reads ('meter_ok'), and `answers` are the words it may take.
--   only_if - this step applies only when a named fact came out a certain
--             way ({"meter_ok": "no"}). Until the question is answered the
--             step is there and visible: a path nobody has ruled out yet is
--             still a path. Answering prunes it, with the reason on it.
--
-- portal_step_answer(step, answer, note) records the answer, closes the
-- step, and calls off the siblings the answer has just ruled out - never
-- silently: each one is Cancelled with "Ruled out: the meter takes it".
--
-- WHY NOT A BOOLEAN AND AN IF. Because the answer is a fact about the
-- house, and it is worth keeping: six months later "does the meter take it"
-- is answered on the task, in words, with the BTU number on the step above
-- it. A branch that leaves no record is a branch nobody can audit.

-- ---------------------------------------------------------------------------
alter table public.blueprint_activity_steps
  add column if not exists asks    text,
  add column if not exists decides text,
  add column if not exists answers text[],
  add column if not exists only_if jsonb;

comment on column public.blueprint_activity_steps.asks is
  'The one thing to record when this step closes, as a prompt. Migration 175.';
comment on column public.blueprint_activity_steps.decides is
  'The named fact this step''s answer establishes, which later steps read through only_if. Migration 175.';
comment on column public.blueprint_activity_steps.answers is
  'The words the answer may take, when it is a choice rather than a measurement.';
comment on column public.blueprint_activity_steps.only_if is
  'This step applies only when the named facts came out this way, e.g. {"meter_ok": "no"}. Visible until the question is answered - a path nobody has ruled out is still a path.';

alter table public.actions
  add column if not exists asks    text,
  add column if not exists decides text,
  add column if not exists answers text[],
  add column if not exists only_if jsonb,
  add column if not exists answer  text;

comment on column public.actions.answer is
  'What was recorded when this step closed - the measurement, or which way the decision went (migration 175). Null on every task that asks nothing.';

-- ---------------------------------------------------------------------------
-- Expansion and backfill carry the question down.
create or replace function public.fn_actions_expand_blueprint()
returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare v_child_depth integer;
begin
  if new.activity_blueprint_id is null then return new; end if;
  if tg_op = 'UPDATE' and old.activity_blueprint_id is not distinct from new.activity_blueprint_id then
    return new;
  end if;
  v_child_depth := least(coalesce(new.depth_level, 2) + 1, 5);
  insert into public.actions (
    action, status, priority, domain, project_id, engagement_id,
    parent_action_id, assigned_to, assigned_by, depth_level,
    source, created_by, notes, step_order, hidden_from_trades,
    cadence, action_type, is_gate,
    asks, decides, answers, only_if
  )
  select s.step_name, 'Not Started', coalesce(new.priority, 'Missing'), new.domain,
         new.project_id, new.engagement_id, new.id, s.default_assigned_to, new.assigned_to,
         v_child_depth, 'system:blueprint', 'system:blueprint', s.notes, s.step_order,
         coalesce(s.hidden_from_trades, false), coalesce(s.cadence, 'one-time'),
         s.action_type, coalesce(s.is_gate, false),
         s.asks, s.decides, s.answers, s.only_if
    from public.blueprint_activity_steps s
   where s.activity_blueprint_id = new.activity_blueprint_id
     and not exists (select 1 from public.actions c
                      where c.parent_action_id = new.id and c.action = s.step_name)
   order by s.step_order;
  return new;
end $$;

do $patch$
declare src text; out_ text;
begin
  src := pg_get_functiondef('public.fn_blueprint_step_backfill()'::regprocedure);
  out_ := replace(src,
    E'    step_order, action_type, hidden_from_trades, is_gate, cadence, trade, contract_id\n  )',
    E'    step_order, action_type, hidden_from_trades, is_gate, cadence, trade, contract_id,\n'
 || E'    asks, decides, answers, only_if\n  )');
  out_ := replace(out_,
    E'         p.trade,\n         p.contract_id\n    from public.actions p',
    E'         p.trade,\n         p.contract_id,\n'
 || E'         new.asks, new.decides, new.answers, new.only_if\n    from public.actions p');
  if out_ = src or position('new.only_if' in out_) = 0 then
    raise exception 'fn_blueprint_step_backfill has drifted - a block to patch was not found';
  end if;
  execute out_;
end $patch$;

-- ---------------------------------------------------------------------------
-- ANSWER A STEP. Records what was found, closes the step, and calls off the
-- siblings the answer rules out.
create or replace function public.portal_step_answer(p_action uuid, p_answer text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a        public.actions;
  v_answer text := nullif(btrim(coalesce(p_answer, '')), '');
  v_ruled  jsonb := '[]'::jsonb;
  v_kept   integer := 0;
  r        record;
begin
  perform public.assert_own_hands();
  if public.current_app_user_id() is null then
    return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.');
  end if;
  if not public.can_see_action(p_action) then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'reason', 'That step is not yours to answer.');
  end if;
  select * into a from public.actions where id = p_action;
  if not public.can_edit_project(a.project_id) then
    return jsonb_build_object('ok', false, 'code', 'READ_ONLY', 'reason', 'You have read-only access on this project.');
  end if;
  if a.asks is null and a.decides is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_A_QUESTION', 'reason', 'This step asks nothing - close it the usual way.');
  end if;
  if v_answer is null then
    return jsonb_build_object('ok', false, 'reason', coalesce(a.asks, 'Say which way it went') || ' - it cannot be left blank.');
  end if;
  if a.answers is not null and array_length(a.answers, 1) is not null and not (v_answer = any (a.answers)) then
    return jsonb_build_object('ok', false, 'code', 'NOT_AN_ANSWER',
      'reason', format('"%s" is not one of the answers: %s.', v_answer, array_to_string(a.answers, ', ')));
  end if;

  update public.actions
     set answer = v_answer,
         status_note = coalesce(nullif(btrim(p_note), ''), coalesce(a.asks || ': ', '') || v_answer),
         last_updated = now(), last_modified_by = 'portal:step-answer'
   where id = p_action;

  -- WHAT THE ANSWER RULES OUT. Only siblings under the same parent, only
  -- those naming this fact, only when they named it the other way. Each is
  -- called off with its reason on it, never deleted: the path existed, it
  -- was considered, and the record says why it is not being taken.
  if a.decides is not null and a.parent_action_id is not null then
    for r in
      select c.id, c.action
        from public.actions c
       where c.parent_action_id = a.parent_action_id
         and c.id <> a.id
         and c.only_if ? a.decides
         and c.only_if ->> a.decides is distinct from v_answer
         and c.status not in ('Completed', 'Cancelled', 'Force Cancelled')
    loop
      perform public.close_action(r.id, true, 'portal:step-answer', 'Cancelled');
      update public.actions
         set status_note = format('Ruled out - %s came back "%s".', a.action, v_answer),
             last_modified_by = 'portal:step-answer'
       where id = r.id;
      v_ruled := v_ruled || jsonb_build_object('id', r.id, 'action', r.action);
    end loop;
    select count(*) into v_kept
      from public.actions c
     where c.parent_action_id = a.parent_action_id
       and c.only_if ? a.decides
       and c.only_if ->> a.decides = v_answer
       and c.status not in ('Completed', 'Cancelled', 'Force Cancelled');
  end if;

  -- The step itself closes. A step with children of its own keeps them, so
  -- the close is refused rather than forced - that is work, not a branch.
  begin
    perform public.close_action(p_action, false, 'portal:step-answer', 'Completed');
  exception when others then
    return jsonb_build_object('ok', true, 'answer', v_answer, 'closed', false,
      'ruled_out', v_ruled, 'kept', v_kept,
      'reason', 'The answer is recorded. The step itself stays open: ' || sqlerrm);
  end;

  return jsonb_build_object('ok', true, 'answer', v_answer, 'closed', true,
                            'decides', a.decides, 'ruled_out', v_ruled, 'kept', v_kept);
end $$;
revoke all on function public.portal_step_answer(uuid, text, text) from public, anon;
grant execute on function public.portal_step_answer(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- A PACKAGE KNOWS ITS PROCESS, and a job can start it in one call.
alter table public.blueprint_packages
  add column if not exists activity_blueprint_id uuid references public.blueprint_activity(id);
comment on column public.blueprint_packages.activity_blueprint_id is
  'The step-by-step process a job of this kind follows (migration 175). portal_process_start writes it onto the job.';

create or replace function public.portal_process_start(p_project uuid, p_blueprint uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_bp    uuid := p_blueprint;
  v_name  text;
  v_desc  text;
  v_have  uuid;
  v_id    uuid;
  r       jsonb;
begin
  perform public.assert_own_hands();
  if not public.can_edit_project(p_project) then
    return jsonb_build_object('ok', false, 'reason', 'Starting the process on this job is not yours to do.');
  end if;
  if not public.portal_task_takes_tasks(p_project) then
    return jsonb_build_object('ok', false, 'code', 'IS_PROPERTY',
      'reason', 'This is the property, not a job. Start the process on the job under it.');
  end if;

  if v_bp is null then
    select bp.activity_blueprint_id into v_bp
      from public.projects p
      join public.blueprint_packages bp on bp.code = p.package_code
     where p.id = p_project;
  end if;
  if v_bp is null then
    return jsonb_build_object('ok', false, 'code', 'NO_PROCESS',
      'reason', 'There is no step-by-step process for this kind of job yet.');
  end if;
  select b.name, b.description into v_name, v_desc from public.blueprint_activity b where b.id = v_bp;
  if v_name is null then
    return jsonb_build_object('ok', false, 'code', 'NO_PROCESS', 'reason', 'That process is not on file.');
  end if;

  select a.id into v_have
    from public.actions a
   where a.project_id = p_project and a.activity_blueprint_id = v_bp
     and a.status not in ('Completed', 'Cancelled', 'Force Cancelled', 'Superseded')
   order by a.created_at limit 1;
  if v_have is not null then
    return jsonb_build_object('ok', true, 'id', v_have, 'existed', true, 'action', v_name,
      'steps', (select count(*) from public.actions c where c.parent_action_id = v_have));
  end if;

  r := public.portal_task_create(
    p_project => p_project,
    p_action  => v_name,
    p_delivers => 'work',
    p_priority => 'High',
    p_description => v_desc);
  if not coalesce((r->>'ok')::boolean, false) then return r; end if;
  v_id := (r->>'id')::uuid;

  -- The tag is what expands it: fn_actions_expand_blueprint writes one task
  -- per step, in order, with the questions on them.
  update public.actions set activity_blueprint_id = v_bp where id = v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'existed', false, 'action', v_name,
    'steps', (select count(*) from public.actions c where c.parent_action_id = v_id));
end $$;
revoke all on function public.portal_process_start(uuid, uuid) from public, anon;
grant execute on function public.portal_process_start(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- The task screen carries the question.
do $patch$
declare src text; out_ text;
begin
  src := pg_get_functiondef('public.portal_task_detail(uuid)'::regprocedure);
  out_ := replace(src,
    E'      ''accepts_steps'', a.accepts_steps,\n',
    E'      ''accepts_steps'', a.accepts_steps,\n'
 || E'      ''asks'', a.asks, ''decides'', a.decides, ''answers'', to_jsonb(a.answers),\n'
 || E'      ''only_if'', a.only_if, ''answer'', a.answer,\n');
  if out_ = src then raise exception 'portal_task_detail has drifted - accepts_steps key not found'; end if;
  execute out_;
end $patch$;

-- ---------------------------------------------------------------------------
-- THE EMERGENCY GENERATOR, IN SHAHAR'S ORDER.
--
-- The old eight steps began at the permit, which is the middle of the job.
-- Everything before it - what the house already burns, and whether the meter
-- can carry a generator on top - decides whether the permit is a week or a
-- season, and it was nowhere. Nothing has expanded this blueprint yet, so
-- the steps are replaced outright rather than added to.
delete from public.blueprint_activity_steps
 where activity_blueprint_id = 'bf689e09-7d94-4787-9903-2fde41aa6323';

update public.blueprint_activity
   set description =
     'A whole-house standby generator, end to end, in the order it actually happens. IT STARTS AT THE GAS, '
  || 'not at the permit: add up what the house already burns, ask whether the meter can carry a generator on '
  || 'top, and only then does anybody draw anything. That one question decides whether this job takes a month '
  || 'or a season, because a meter upsize is the utility''s clock, not yours. Then the plumber''s diagram and '
  || 'the mechanical permit, then the electrician''s jacket and the electrical permit, and only once both are '
  || 'approved do you buy a generator - a permit can move the pad or change the size, and a delivered '
  || 'generator cannot. The install ends the way it always did: two rough-ins that are NOT connected, one '
  || 'inspection, then the connections and the load test.',
       recurrence_note = 'Once per property. Two long poles: the meter, if it needs upsizing, and the unit''s lead time.',
       auto_close_condition = 'Permit closed and the system load-tested'
 where id = 'bf689e09-7d94-4787-9903-2fde41aa6323';

insert into public.blueprint_activity_steps
  (activity_blueprint_id, step_order, step_name, default_assigned_to, necessity, action_type, is_gate, asks, decides, answers, only_if, notes)
values
('bf689e09-7d94-4787-9903-2fde41aa6323', 10,
 'Add up what the house already burns', 'PM / Owner', 'required', 'backoffice', false,
 'Total connected load today, in BTU per hour', null, null, null,
 'EVERY GAS APPLIANCE, off its nameplate - not off a spec sheet for a similar model, off the plate on the '
 || 'machine. The usual list: furnace or boiler, water heater, range, dryer, fireplace, pool heater, and the '
 || 'grill if it is plumbed in. Use the INPUT rating, which is what the meter has to deliver, never the output. '
 || 'Photograph each plate onto this step - the numbers get argued about later and a photograph ends it. '
 || 'Write the total as the answer, and say in the note which appliances never run together: a load calculation '
 || 'may allow for that, but the utility usually sizes on the total, so the honest number goes here.'),

('bf689e09-7d94-4787-9903-2fde41aa6323', 20,
 'Does the meter take the generator as well?', 'PM / Owner', 'required', 'backoffice', false,
 'Does the meter carry the house plus the generator?', 'meter_ok', array['yes','no'], null,
 'THE QUESTION THE WHOLE JOB TURNS ON. Add the generator''s own draw at full load to the total from the step '
 || 'above - a 22 kW Generac on natural gas is roughly 300,000 BTU/hr, and it is a different number on propane, '
 || 'so read the spec sheet for the model rather than trusting a rule of thumb. Then read the METER''S CLASS off '
 || 'its badge: a standard residential meter delivers on the order of 250,000 BTU/hr at 7 inches water column, '
 || 'which a house plus a generator will usually exceed. Do not guess it - if the badge is unreadable or the sum '
 || 'is anywhere near the limit, ask the utility for the meter''s capacity in writing. Answer YES and the '
 || 'plumber can draw; answer NO and the utility has to upsize first, which is the step below and is measured '
 || 'in weeks.'),

('bf689e09-7d94-4787-9903-2fde41aa6323', 30,
 'Get the utility to upsize the meter or the service', 'PM / Owner', 'required', 'backoffice', true,
 'What the utility committed to, and when', null, null, '{"meter_ok": "no"}'::jsonb,
 'ONLY IF THE METER WILL NOT CARRY IT - this step calls itself off when the answer above is yes. Open the '
 || 'request with the utility (PSE&G here) with the load numbers from the two steps above attached; they will '
 || 'want the total in BTU per hour and usually the appliance list behind it. This is THEIR clock and it is the '
 || 'longest thing on this job - weeks at best, a season at worst, and it can require a new service line rather '
 || 'than just a meter head. Get the commitment in writing with a date on it, put that date on this step, and '
 || 'chase it weekly. IT BLOCKS EVERYTHING: this step is a gate, so nothing below it moves until the new meter '
 || 'is set and the utility has signed it off.'),

('bf689e09-7d94-4787-9903-2fde41aa6323', 40,
 'Gas diagram, and sign the mechanical permit', 'Plumber', 'required', 'backoffice', false,
 'Permit number and the date it was filed', null, null, null,
 'WITH THE GAS SETTLED, the plumber draws the gas piping diagram: pipe sized for the TOTAL load and for the '
 || 'length of the run - both, because a pipe sized on load alone starves at distance - the point of connection '
 || 'at the meter, the sediment trap and the shutoff. The plumber signs the mechanical permit; a homeowner '
 || 'cannot. WHERE THE PAD SITS IS DECIDED HERE and it has two masters that are not the same numbers: zoning, '
 || 'because a generator is a structure standing outdoors and has setbacks from the line, and the '
 || 'MANUFACTURER''S clearances from windows, doors and vents. Settle both before the diagram is drawn - moving '
 || 'a pad after the permit means both permits again. The catalogue package covers the gas line up to 25 feet '
 || 'from the meter; past that it is a change and is priced before anybody digs.'),

('bf689e09-7d94-4787-9903-2fde41aa6323', 50,
 'Electrical jacket, and the electrical permit', 'Electrician', 'required', 'backoffice', false,
 'Permit number and the date it was filed', null, null, null,
 'GAS FIRST, THEN ELECTRIC - deliberately, because the pad location comes out of the gas diagram and the '
 || 'electrician files against it. The jacket: the transfer switch and where it is mounted, the load calculation '
 || 'for what the generator will actually carry (whole house or selected circuits, and that is a decision to '
 || 'make out loud with the owner), and the wire sizing for the run from the pad to the switch. THE 200 A '
 || 'AUTOMATIC TRANSFER SWITCH COMES IN THE BOX with the Generac 7043, so it is specified here and NOT bought '
 || 'twice at the next step. File it and put the permit number on this step.'),

('bf689e09-7d94-4787-9903-2fde41aa6323', 60,
 'Both permits approved - order the kit and book the crew', 'PM / Owner', 'required', 'financial transaction', false,
 'What was ordered, the price, and the lead time you were quoted', null, null, null,
 'ONLY ONCE BOTH PERMITS ARE APPROVED. A permit can move the pad or change the size and a delivered generator '
 || 'cannot, which is the single most expensive way to get this job wrong. FOUR THINGS, and the last two are the '
 || 'ones people forget: the generator (Generac Guardian 22 kW, model 7043, per the catalogue package); the '
 || 'transfer switch - CHECK THE BOX FIRST, it ships with this model; the pad (QwikPad composite, which needs no '
 || 'concrete pour); and the battery, which does NOT ship with the unit and is its own line every time. Confirm '
 || 'the lead time the day you order, put the delivery date on this step, and book the plumber and the '
 || 'electrician against that date - everything below waits on the delivery.'),

('bf689e09-7d94-4787-9903-2fde41aa6323', 70,
 'Set the pad, run the wire and the pipe - do not connect', 'Electrician', 'required', 'build', false,
 null, null, null, null,
 'Pad down and LEVEL. Conduit run, transfer switch mounted, wire pulled and left unterminated; gas pipe run to '
 || 'the pad and left unconnected. NOT CONNECTED IS THE INSTRUCTION, not a delay - the inspector has to see this '
 || 'work open, and connecting now means undoing it. Photograph the trench and the runs before anything is '
 || 'covered: this is the one day those photographs can be taken.'),

('bf689e09-7d94-4787-9903-2fde41aa6323', 80,
 'Call the inspection', 'PM / Owner', 'required', 'visual inspection', true,
 'Which inspections, when, and what was written up', null, null, null,
 'Both rough-ins in one visit if the town will take them together, two if it will not - ASK, because assuming '
 || 'one and getting two costs a week. Book a working day ahead. IT CAN FAIL, and when it does this step comes '
 || 'round again: fix what was written up, rebook, and do not close the permit in the meantime. Nothing below '
 || 'this line happens until it passes, which is why it is a gate.'),

('bf689e09-7d94-4787-9903-2fde41aa6323', 90,
 'Connect the gas, connect the power, load-test it', 'Electrician', 'required', 'build', false,
 'The test result, and the exercise schedule you set', null, null, null,
 'After the inspection passes, not before. The plumber connects and PRESSURE-TESTS the gas run - the test is '
 || 'the record that it was done, so it lives on this step. The electrician terminates and energises. Then '
 || 'actually TEST it, which is not the same as watching it start: cut the utility feed and confirm the transfer '
 || 'switch picks the house up under load and hands it back when power returns. Set the weekly exercise schedule '
 || 'while you are standing there, and show the owner how to silence an alarm at two in the morning.'),

('bf689e09-7d94-4787-9903-2fde41aa6323', 100,
 'Close the permit, hand over the paperwork', 'PM / Owner', 'required', 'backoffice', false,
 'The date the town signed it off', null, null, null,
 'The final inspection and the town''s sign-off. The catalogue package sells this as part of the job - '
 || '"inspections, town approval, permits closed" - so it is not optional and it is not somebody else''s. Hand '
 || 'over the manual, the warranty registration and the exercise schedule with it. AN OPEN PERMIT SURFACES YEARS '
 || 'LATER AT A SALE, when it is somebody else''s emergency and nobody remembers the job.');

update public.blueprint_packages
   set activity_blueprint_id = 'bf689e09-7d94-4787-9903-2fde41aa6323'
 where code = 'generator';

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
