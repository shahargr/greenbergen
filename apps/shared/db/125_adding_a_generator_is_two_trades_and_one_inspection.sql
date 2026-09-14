-- 125. ADDING A GENERATOR IS TWO TRADES AND ONE INSPECTION.
--
-- Shahar (2026-09-14): "Build a blue print process to add emergency
-- generator" - eight steps, three actors, and a shape the last one did not
-- have: two trades doing half a job each, stopping, being looked at, and
-- then coming back to finish. That pause is the whole point of the sequence
-- and it is what a blueprint is for, because the instinct on site is always
-- to connect it while you are standing there.
--
-- Same machinery as 124: fn_actions_expand_blueprint turns an action carrying
-- this blueprint's id into one child task per step, in order, with
-- default_assigned_to as the holder.
--
-- The notes are the catalogue's own spec, not my idea of a generator. The
-- standby generator package (blueprint_packages 'generator', 6,500 dollars,
-- 10 percent permit deposit) names the hardware exactly:
--   Generac Guardian 22 kW, model 7043
--   200 A automatic transfer switch - THE SWITCH COMES IN THE BOX
--   QwikPad composite pad - no concrete pour
--   gas line from the meter, up to 25 feet
--   start-up and load test; inspections, town approval, permits closed
--
-- One thing the package says and his list does not: the town wants
-- ELECTRICAL, PLUMBING AND ZONING. A generator is a structure standing
-- outdoors, so where it may sit is zoning's business before it is anybody
-- else's - and that has to be settled before the pad location is fixed, not
-- after the pad is down.
insert into public.blueprint_activity (name, domain, description, recurrence_note, auto_close_condition, created_by)
values (
  'Add an emergency generator',
  'construction',
  'Installing a whole-house standby generator, end to end: permits, the order, the pad and the two rough-ins, the '
  || 'inspection, the two connections and closing the permit. TWO TRADES, ONE INSPECTION, AND A DELIBERATE PAUSE - '
  || 'the electrician runs wire and the plumber runs pipe and NEITHER CONNECTS, because the inspector has to see the '
  || 'work before it is live. Connecting early is the most expensive shortcut on this job: it fails the inspection '
  || 'and both trades come back. The catalogue package (blueprint_packages ''generator'') carries the hardware spec '
  || 'and what is included; this is the order it happens in.',
  'Once per property. The unit is the long pole - order it the day the permit is approved, not before.',
  'Permit closed and the system load-tested',
  'Shahar (2026-09-14)'
)
on conflict (name) do nothing;

insert into public.blueprint_activity_steps
  (activity_blueprint_id, step_order, step_name, default_assigned_to, necessity, cadence, notes)
select b.id, s.step_order, s.step_name, s.who, s.necessity, s.cadence, s.notes
from public.blueprint_activity b,
lateral (values
  (10, 'Complete the permits - plumbing and electric', 'PM / Owner', 'required', 'one-time',
   'THREE, NOT TWO: the package says town electrical, plumbing AND ZONING. A generator is a structure standing '
   || 'outdoors, so where it may sit is zoning''s business - setbacks from the line and from windows and doors - and '
   || 'that has to be settled BEFORE the pad location is fixed, not after the pad is down. Separately, check the GAS '
   || 'side with the utility rather than the town: a generator''s draw on top of the house may need the meter or the '
   || 'service upsized, which is a provider filing with its own clock (see step 210 of Permits - New Build). Permit '
   || 'deposit on the catalogue package is 10 percent.'),

  (20, 'Order the generator, pad, transfer switch and battery', 'PM / Owner', 'required', 'one-time',
   'ONLY ONCE THE PERMIT IS APPROVED, because a permit can move the pad or change the size and a delivered generator '
   || 'cannot. What the catalogue package specifies: Generac Guardian 22 kW, model 7043, with a 200 A automatic '
   || 'transfer switch - THE SWITCH COMES IN THE BOX, so do not buy it twice - on a QwikPad composite pad, which '
   || 'needs no concrete pour. The battery is its own line: it does not ship with the unit. Confirm the lead time the '
   || 'day you order and put the date on the job, because everything after this waits on the delivery.'),

  (30, 'Set the pad and run the wires - do not connect', 'Electrician', 'required', 'one-time',
   'Pad down and LEVEL, conduit run, transfer switch mounted, wire pulled and left unterminated. Keep the '
   || 'manufacturer''s clearances from the house and from any opening - they are not the same numbers as the zoning '
   || 'setbacks and both have to be met. NOT CONNECTED is the instruction, not a delay: the inspector has to see this '
   || 'work before it is live, and connecting now means doing it twice.'),

  (40, 'Run the gas pipe to the generator - do not connect', 'Plumber', 'required', 'one-time',
   'Pipe sized for the generator''s draw, not for the length of the run. The catalogue package covers the gas line '
   || 'from the meter UP TO 25 FEET; past that it is a change and should be priced before anybody digs. Same '
   || 'instruction as the electrician: run it, leave it unconnected, let it be seen.'),

  (50, 'Call for the inspection', 'PM / Owner', 'required', 'per-inspection',
   'Both rough-ins in one visit if the town will take them together; two visits if it will not - ask, because '
   || 'assuming one and getting two costs a week. Book a working day ahead. IT CAN FAIL, and when it does this step '
   || 'comes round again: fix what was written up, rebook, and do not close the permit in the meantime. Nothing below '
   || 'this line happens until it passes.'),

  (60, 'Connect the gas line', 'Plumber', 'required', 'one-time',
   'After the inspection passes, not before. Pressure-test and leak-check the run before the unit is fired - the '
   || 'test is the record that it was done, so keep it with the job.'),

  (70, 'Connect the power and test the system', 'Electrician', 'required', 'one-time',
   'Terminate, energise, and then actually TEST it: the package says start-up and LOAD test, which is not the same as '
   || 'watching it start. Cut the utility feed and confirm the transfer switch picks the house up and hands it back '
   || 'when power returns. Set the exercise schedule while you are there, and hand over how to silence an alarm at '
   || 'two in the morning.'),

  (80, 'Close the permit', 'PM / Owner', 'required', 'one-time',
   'The final inspection and the town''s sign-off. The catalogue package sells this as part of the job - '
   || '"inspections, town approval, permits closed" - so it is not optional and it is not somebody else''s. An open '
   || 'permit surfaces years later at a sale, when it is somebody else''s emergency and nobody remembers the job.')
) as s(step_order, step_name, who, necessity, cadence, notes)
where b.name = 'Add an emergency generator'
on conflict (activity_blueprint_id, step_order) do nothing;

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
