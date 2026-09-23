-- EIGHT PHASES, IN BUILD ORDER.
--
-- Shahar, 2026-09-23, looking at the wizard's phase dropdown: "for phases,
-- update the order: 1. acquisition, 2. permits, 3. pre constructions,
-- 4. foundation and frame, 5. rough and mechanical, 6. internal finishing,
-- 7. hardscape and landscape, 8. sell."
--
-- The old seven had gaps and collisions (no 6, two 1s) and bundled too much:
-- permits hid inside pre-construction, foundation and framing inside rough.
-- The renames CASCADE into budget_categories (its FK is ON UPDATE CASCADE),
-- so every line follows its phase automatically; contract_phases is empty.
-- bid_packages.phase is a plain text copy taken at package creation, so it
-- is re-pointed by hand below.
--
-- "1. Ongoing" survives as plain "Ongoing" (sort 99): it is the CARRYING
-- bucket - interest, taxes, dumpster, cleaning - which is orthogonal to the
-- build order, and 11 live lines sit in it. Its old "1." was a lie.
--
-- Rule 34 note: budget_categories.phase stays a hand-set grouping read by
-- the rollups; this migration only renames the vocabulary and refiles the
-- lines whose names make the move unambiguous (Permit%, Framing, Mason,
-- Foundation). Anything debatable stayed where it was.

-- Renames. No old/new key collides with any other, so order is free.
update public.phases set phase_key = '3. Pre-construction', sort_order = 3
 where phase_key = '2. Pre-construction';
update public.phases set phase_key = '5. Rough & mechanical', phase_name = 'Rough and mechanical', sort_order = 5
 where phase_key = '3. Rough';
update public.phases set phase_key = '6. Internal finishing', phase_name = 'Internal finishing', sort_order = 6
 where phase_key = '5. Finish';
update public.phases set phase_key = '7. Hardscape & landscape', sort_order = 7
 where phase_key = '4. Hardscape & Landscape';
update public.phases set phase_key = '8. Sell', phase_name = 'Sell', sort_order = 8
 where phase_key = '7. Completion';
update public.phases set phase_key = 'Ongoing', sort_order = 99
 where phase_key = '1. Ongoing';

-- The two the old list lacked.
insert into public.phases (phase_key, phase_name, sort_order, is_carrying, notes)
values
  ('2. Permits', 'Permits', 2, false,
   'Split out of pre-construction 2026-09-23 (Shahar''s eight-phase build order).'),
  ('4. Foundation & frame', 'Foundation and frame', 4, false,
   'Split out of rough 2026-09-23 (Shahar''s eight-phase build order).')
on conflict (phase_key) do nothing;

-- The unambiguous refiles: a line NAMED permit is a permit; framing, the
-- mason and the foundation are foundation-and-frame work.
update public.budget_categories set phase = '2. Permits'
 where phase = '3. Pre-construction' and category ilike 'permit%';
update public.budget_categories set phase = '4. Foundation & frame'
 where phase = '5. Rough & mechanical'
   and (category ilike 'framing%' or category = 'Mason'
        or category ilike 'foundation%' or category = 'Survey - Foundation');

-- bid_packages copied the phase text at creation; point the copies at the
-- new names so the bid planner groups the same way the budget does.
update public.bid_packages p set phase = bc.phase
  from public.budget_categories bc
 where p.budget_category_id = bc.id and p.phase is distinct from bc.phase;
