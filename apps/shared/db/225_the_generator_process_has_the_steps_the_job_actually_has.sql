-- THE GENERATOR PROCESS HAS THE STEPS THE JOB ACTUALLY HAS.
--
-- Shahar, 2026-09-21, walking the flow out loud from Ran's job at 8 Jason
-- Woods Road:
--
--   a. I am looking to do a generator for emergency
--   b. I would like to do it alone
--   c. I get all the paper work required from GreenBergen
--   d. I am meeting with plumber and electrician to sign the papers
--   e. I am dropping the papers with the town for approval
--      plumber delivers: sealed paper (plumbing/mechanical), gas diagram,
--        gas calculations, and the owner picks a generator/transfer switch
--      electrician delivers: sealed paper (electrical)
--   once approved: order the generator; electrician preps the site (pad);
--      plumber preps for inspection; inspection - ready for connection;
--      connect and test; inspection - final
--
-- "Add an emergency generator" already gets most of this right and gets the
-- hard part - the gas - righter than the account above: it starts at the
-- meter, because a meter upsize is the utility's clock and it decides whether
-- this job takes a month or a season. That ordering stays.
--
-- FOUR THINGS ARE GENUINELY MISSING, and each of them is a place Ran's job
-- has already drifted:
--
--   5   THE PAPERWORK PACK. Item (c) has no step at all. Nothing in the
--       process hands the owner the town's forms, so the one thing Green
--       Bergen is supposed to do first is the one thing nobody is holding.
--
--   35  CHOOSING THE GENERATOR, which is NOT ordering it. The plumber sizes
--       the pipe off the machine's draw and the electrician specs against the
--       transfer switch, so both of them are blocked until somebody picks a
--       model - and step 60 deliberately refuses to ORDER one until the
--       permits are approved. Those are two different moments and the process
--       only had the second. Ran's job proves it: a loose "Select generator"
--       task, dated the 12th, nine days late, belonging to no step.
--
--   55  PERMITS APPROVED, as a GATE. Step 60 opens "ONLY ONCE BOTH PERMITS
--       ARE APPROVED" - in prose, with is_gate false. A rule written in a
--       note is a rule the board cannot keep. This is also item (e): the
--       filing is already in steps 40 and 50, the waiting is what was
--       missing.
--
--   75  THE PLUMBER'S OWN PREP. Step 70 is the electrician's, and the gas run
--       was a clause inside its notes - so the plumber had no step of their
--       own to be late on, and no trade panel to appear in.
--
--   95  THE FINAL INSPECTION, as an inspection and a gate. It was a sentence
--       inside "close the permit", which is filing, not an inspection that
--       can fail.
--
-- AND TWO STEPS LEARN TO NAME THEIR DELIVERABLES. Steps 40 and 50 both asked
-- for "Permit number and the date it was filed", which is the receipt, not
-- the work. Shahar listed exactly what each trade hands over, and a sealed
-- drawing that nobody asked for is a drawing that arrives the week it is
-- needed. What is added is the list; the notes, which are good, are untouched.
do $$
declare
  bp constant uuid := 'bf689e09-7d94-4787-9903-2fde41aa6323';
  n int;
begin
  if not exists (select 1 from public.blueprint_activity where id = bp) then
    raise exception 'The generator process is not there.';
  end if;
  -- The four slots have to be free, or this is not the blueprint I read.
  select count(*) into n from public.blueprint_activity_steps
   where activity_blueprint_id = bp and step_order in (5, 35, 55, 75, 95);
  if n <> 0 then
    raise exception 'Steps 5/35/55/75/95 are already taken (% of them).', n;
  end if;
end $$;

-- ---- the deliverables each trade hands over -------------------------------

update public.blueprint_activity_steps
   set asks = 'The sealed plumbing/mechanical permit, the gas diagram, the gas calculations - and the permit number and filing date'
 where activity_blueprint_id = 'bf689e09-7d94-4787-9903-2fde41aa6323' and step_order = 40;

update public.blueprint_activity_steps
   set asks = 'The sealed electrical permit and the load calculation - and the permit number and filing date'
 where activity_blueprint_id = 'bf689e09-7d94-4787-9903-2fde41aa6323' and step_order = 50;

-- ---- two titles stop claiming what now has its own step -------------------

-- 60 no longer announces the approval: 55 is the approval.
update public.blueprint_activity_steps
   set step_name = 'Order the generator, the pad and the battery'
 where activity_blueprint_id = 'bf689e09-7d94-4787-9903-2fde41aa6323' and step_order = 60;

-- 70 is the electrician's site prep; the gas run moved to 75.
update public.blueprint_activity_steps
   set step_name = 'Electrician: set the pad and run the wire - do not connect',
       notes = 'Pad down and LEVEL. Conduit run, transfer switch mounted, wire pulled and left unterminated. NOT CONNECTED IS THE INSTRUCTION, not a delay - the inspector has to see this work open, and connecting now means undoing it. Photograph the trench and the runs before anything is covered: this is the one day those photographs can be taken. The gas side is the plumber''s own step below, and both have to be open on the same day the inspector comes.'
 where activity_blueprint_id = 'bf689e09-7d94-4787-9903-2fde41aa6323' and step_order = 70;

-- ---- the four missing steps -----------------------------------------------

insert into public.blueprint_activity_steps
  (activity_blueprint_id, step_order, step_name, default_assigned_to, trade,
   necessity, action_type, is_gate, asks, hidden_from_owner, notes)
values
  ('bf689e09-7d94-4787-9903-2fde41aa6323', 5,
   'Get the town''s permit pack from Green Bergen',
   'PM / Owner', null, 'required', 'documentation', false,
   'Which forms this town wants, and that you have all of them',
   false,
   'THE FIRST THING, and the one thing here that is ours rather than yours. Every town wants a different set and wants it on its own form - Closter is not Tenafly - so the pack is assembled for THIS address: the mechanical/plumbing application, the electrical application, the zoning sheet if the town treats a generator as a structure (most do), and whatever cover sheet they insist on. Get it before the trades come, because the meeting in the next steps is the meeting where they SIGN, and a signing meeting with no forms on the table is a second meeting.'),

  ('bf689e09-7d94-4787-9903-2fde41aa6323', 35,
   'Choose the generator and the transfer switch',
   'Owner', null, 'required', 'backoffice', false,
   'The model and its kW, the transfer switch, and the fuel it will run on',
   false,
   'CHOOSING IS NOT ORDERING - ordering waits for the permits and is step 60, because a permit can move the pad or change the size and a delivered generator cannot. But NOTHING BELOW CAN BE DRAWN UNTIL THIS IS ANSWERED: the plumber sizes the gas pipe off this machine''s draw at full load, and the electrician specs the run and the switch against it. Leaving it open is how both permits end up waiting on one decision nobody realised they were holding. The catalogue package is built around the Generac Guardian 22 kW (model 7043), whose 200 A automatic transfer switch comes in the box - so if that is the pick, say so here and do not buy the switch twice. Natural gas or propane changes the BTU draw, so name the fuel.'),

  ('bf689e09-7d94-4787-9903-2fde41aa6323', 55,
   'Both permits approved by the town',
   'PM / Owner', null, 'required', 'backoffice', true,
   'The date each permit was approved, and the permit numbers as issued',
   false,
   'THE WAIT, and it is a gate because everything below it costs money that a refusal would waste. The papers went in at steps 40 and 50; this is the town coming back. Expect three to six weeks and chase it, because nobody rings you. IT CAN COME BACK MARKED UP - a setback, a clearance from a window, a pipe size - and when it does the answer is to fix the drawing and refile, not to start work on the version that was refused. Put both permit numbers here as ISSUED, which is not always what was filed. Nothing below moves until this closes.'),

  ('bf689e09-7d94-4787-9903-2fde41aa6323', 75,
   'Plumber: run the gas to the pad - do not connect',
   'Plumber', 'Plumbing', 'required', 'build', false,
   null,
   false,
   'The plumber''s half of the rough-in, and it has to be open on the same day the electrician''s is - the inspector comes once. Gas pipe run from the point of connection at the meter to the pad, sized as the diagram says, sediment trap and shutoff in, and LEFT UNCONNECTED at the generator end. Pressure test rig ready but not the final connection: connecting now means undoing it in front of the inspector. Photograph the trench and the run before anything is backfilled.'),

  ('bf689e09-7d94-4787-9903-2fde41aa6323', 95,
   'Final inspection',
   'PM / Owner', null, 'required', 'visual inspection', true,
   'The date it passed, and anything that was written up',
   false,
   'AFTER it is connected and load-tested, not before - this inspector is looking at a finished, working machine. Separate from the rough-in at step 80 and it can fail on its own: the commonest write-ups are the label on the disconnect, the bonding, and clearances that were fine on paper and are not fine with the machine standing there. It is a gate because closing the permit at the next step is the town''s act and it will not happen until this passes.');
