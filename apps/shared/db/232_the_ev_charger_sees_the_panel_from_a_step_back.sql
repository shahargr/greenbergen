-- THE EV CHARGER SEES THE PANEL FROM A STEP BACK.
--
-- Shahar, 2026-09-24, with a three-screen mock of the EV charger booking:
-- step 2 is "Electrical Panel Details" and asks for two photographs of the
-- panel - the door open with the breakers legible, and a context shot from
-- 5-10 ft back.
--
-- The close-up answers what the panel can carry. The step back answers what
-- the price actually turns on: where the panel sits, which wall the new
-- circuit leaves by, and what is between it and the charger. So it is a slot
-- of its own, between the panel and the charger spot, and the wizard puts
-- every slot except the spot on the panel step (apps/homeowner lib/ev.ts).
--
-- Data, not schema: one row, so no schema_version bump. Admin > Packages
-- edits or removes it like any other photo slot.
insert into public.blueprint_package_photos (package_code, key, label, hint, sort_order)
values ('ev_charger', 'panel_context', 'Panel from a step back',
        '5-10 ft back, so the wall around the panel and the way out of it are in frame.', 15)
on conflict (package_code, key) do nothing;
