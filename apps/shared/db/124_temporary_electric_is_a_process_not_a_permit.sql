-- 124. TEMPORARY ELECTRIC IS A PROCESS, NOT A PERMIT.
--
-- Shahar (2026-09-14): "Build a blue print process for temp electric
-- connection" - and then six steps with an actor on each.
--
-- The permits blueprint already carries two temp-electric rows: step 180, the
-- TOWN permit, and step 182, the application to the serving utility. Those are
-- filings. What he is describing is the whole chain from asking for power to
-- having it, which runs through both of them and past them: a pole to build,
-- an inspection to pass, a card the town sends the utility, and money before
-- anybody throws a switch. A filing is not a process, so this is its own
-- blueprint and the two permit steps now point at it.
--
-- HOW THIS GETS USED. fn_actions_expand_blueprint: put activity_blueprint_id
-- on an action and it fans out one child task per step, in step_order, with
-- step_name as the task, notes as the notes and default_assigned_to as the
-- holder. So "Owner", "Electrician" and "Town" are written in the column the
-- holder actually lands in - the same column the AI-run blueprints put
-- Contracto and Bob in. It is "who does this", and for a build that is a role.
--
-- WHAT THE NOTES CARRY. Everything this database already learned about this
-- exact chain at 55 Walnut, because a blueprint whose steps are bare titles
-- teaches nobody anything the second time:
--   - the town permit was 202 dollars and is picked up in person
--   - the serving utility is PSE&G in Tenafly, Rockland Electric in several
--     northern boroughs, and it must be verified per property
--   - temporary power stops being optional the moment a load has to run
--     before permanent service exists; at 55 Walnut a sump pump runs 24x7
--   - site wifi and cameras go up the day it is live
--   - and the inspection can fail: it did, on 2026-09-14, which is what
--     prompted all of this
insert into public.blueprint_activity (name, domain, description, recurrence_note, auto_close_condition, created_by)
values (
  'Temporary electric connection',
  'construction',
  'Getting temporary power onto a site, end to end: the request to the serving utility, the town permit, the pole, '
  || 'the inspection, the card the town sends the utility, and the fees. Runs once per site and blocks more than it '
  || 'looks like it does - no temporary power means no sump pump, no site wifi, no cameras and no power tools. '
  || 'TWO SIDES, ALWAYS: the TOWN and the SERVING UTILITY are separate filings with separate clocks, and the utility '
  || 'side is the long pole - start it the day the building permit is approved. The permits blueprint holds the two '
  || 'filings as steps 180 (town) and 182 (utility); this is the whole chain they sit inside.',
  'Once per site. Start the utility application as soon as the building permit is approved - the utility side can run several weeks.',
  'Temporary power is live on site',
  'Shahar (2026-09-14)'
)
on conflict (name) do nothing;

insert into public.blueprint_activity_steps
  (activity_blueprint_id, step_order, step_name, default_assigned_to, necessity, cadence, notes)
select b.id, s.step_order, s.step_name, s.who, s.necessity, s.cadence, s.notes
from public.blueprint_activity b,
lateral (values
  (10, 'Send the temporary electric request to the utility company', 'Owner', 'required', 'one-time',
   'THE LONG POLE - file it first even though the town permit is what people think of first. Confirm who actually '
   || 'serves the property before applying: PSE&G at 55 Walnut and much of Bergen, Rockland Electric in several '
   || 'northern boroughs. Approval can run several weeks, which is why this is step one and not step three. '
   || 'Same filing as step 182 of the Permits - New Build blueprint; do it once, in whichever list you are working.'),

  (20, 'Open the temporary electric permit with the town', 'Owner', 'required', 'one-time',
   'THE TOWN SIDE, and a different filing from step 10 - separate office, separate clock, separate fee. Filed '
   || 'alongside the building permit and picked up IN PERSON from the Borough. 55 Walnut: 202 dollars. Same filing '
   || 'as step 180 of the Permits - New Build blueprint.'),

  (30, 'Prepare the pole', 'Electrician', 'required', 'one-time',
   'The licensed electrician builds the temporary service pole - the post, the meter socket, the panel, the breaker '
   || 'and the ground rod - to the serving utility''s spec, not to a general idea of one. Get the utility''s current '
   || 'temporary-service drawing BEFORE it is built: a pole at the wrong height, or set where the drop cannot reach, '
   || 'fails the inspection and is rebuilt at your cost. 55 Walnut: Franklin.'),

  (40, 'Schedule the inspection with the town', 'Owner', 'required', 'per-inspection',
   'The town''s electrical inspector signs off the pole. Book it a working day ahead - same-week booking leaves no '
   || 'slack. IT CAN FAIL, and it did on 2026-09-14 at 55 Walnut: when it does, this step comes back round - fix what '
   || 'was written up, rebook, and do not mark the permit complete in the meantime. Nothing downstream moves until '
   || 'this passes, because the card at step 50 is what the inspector sends.'),

  (50, 'Town sends the cutting card to the utility company', 'Town', 'required', 'one-time',
   'Also called the cut-in card. The town''s own step, not yours - but it is yours to CHASE, because nothing tells '
   || 'you it has happened and the utility will not schedule the connection without it. Ask the inspector when it '
   || 'went and confirm with the utility that it arrived. This is the most common place the chain goes quiet.'),

  (60, 'Pay the fees and ask the utility to connect the power', 'Owner', 'required', 'one-time',
   'The last gate is money: the utility''s connection charge, and any town fee still outstanding. Pay, then call to '
   || 'schedule the connection - paying does not schedule it. THE DAY IT GOES LIVE: put up the site wifi and the '
   || 'security cameras (step 186 of the Permits - New Build blueprint), and confirm anything that had to keep '
   || 'running is running - at 55 Walnut that is a sump pump, 24x7.')
) as s(step_order, step_name, who, necessity, cadence, notes)
where b.name = 'Temporary electric connection'
on conflict (activity_blueprint_id, step_order) do nothing;

-- The two permit filings now say where the rest of the chain lives, so
-- somebody working the permits list does not think the filing is the job.
update public.blueprint_activity_steps
   set notes = notes || ' SEE ALSO the "Temporary electric connection" blueprint: this filing is one step of it.'
 where activity_blueprint_id = '2b66c37a-3124-4bda-838f-706c0df85136'
   and step_order in (180, 182)
   and notes not like '%Temporary electric connection" blueprint%';

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
