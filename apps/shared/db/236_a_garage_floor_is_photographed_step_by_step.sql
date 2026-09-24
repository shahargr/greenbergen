-- A GARAGE FLOOR IS PHOTOGRAPHED STEP BY STEP.
--
-- Shahar, 2026-09-24, with a four-phone mock-up ("similar for garage - epoxy
-- floor"): a booking that walks the homeowner through the garage one screen
-- at a time before it quotes.
--
--   Step 1  Garage dimensions   1-car / 2-car / 3-car, or the width x length
--                               in feet, and the floor's condition
--   Step 2  Exterior view       a viewfinder: "Step back 15 ft. Capture the
--                               entire opening."
--   Step 3  Interior            "Stand at the back wall. Center the closed
--                               door."
--   Step 4  Angled exterior     two tiles, 45 degrees left and right
--   Finish -> the instant quote (the proposal), then the ordinary booking.
--
-- WHERE EACH ANSWER LANDS - no new home for anything that already has one
-- (rulebook 30):
--
--   * Everything that moves the price is a LEVER (help topic packages): the
--     size, the condition, the finish. The size is a measured quantity in
--     square feet, so it reuses migration 235's unit / upto: each car count is
--     a band, and a typed width x length picks the band that holds it.
--   * Each screen of photos is the package's PHOTO SLOTS, the same rows the
--     ordinary photos step and the inbox request already use. A slot gains
--     where it sits in the walk-through (step - slots sharing a step share a
--     screen), the one line printed over the viewfinder (guide), and an
--     optional reference picture drawn behind it (example_url).
--   * The package says whether it walks the photos this way (guided_photos).
--     Nothing about it is garage-specific: the EV charger, or any package, is
--     one UPDATE and a step and guide on its slots away from the same screens.
--   * What the walk-through said about THIS garage that is not a price - the
--     measured width and length - goes on the booking (project_bookings.survey,
--     migration 235) through homeowner_booking_survey_save.
--
-- PRICES ARE PROVISIONAL, set from typical Bergen County full-flake coating
-- jobs (a 2-car garage, ~450-600 sq ft, grind prep, flake broadcast, clear
-- polyaspartic topcoat). Shahar sets the real numbers in Admin > Packages.
-- The coating system is in the price: it is the trade's own product, not a
-- finish the homeowner chooses in a store (rulebook 53's owner-supplied finish
-- material is tile, hardwood, glass - things with a model number).

-- ---- a photo slot knows its place in a walk-through ---------------------
alter table public.blueprint_package_photos
  add column if not exists step smallint check (step is null or step between 1 and 20),
  add column if not exists guide text check (guide is null or length(guide) <= 120),
  add column if not exists example_url text check (example_url is null or example_url ~ '^https://');
comment on column public.blueprint_package_photos.step is
  'For a package with guided_photos: the screen of the walk-through this slot is taken on. Slots sharing a step share a screen (side by side). Null = asked only on the ordinary photos list.';
comment on column public.blueprint_package_photos.guide is
  'The instruction printed over the viewfinder, at most 120 characters. The first sentence is the headline ("Step back 15 ft."), the rest the line under it.';
comment on column public.blueprint_package_photos.example_url is
  'Optional reference picture shown behind the viewfinder before the homeowner takes theirs - what a good shot looks like. https only.';

alter table public.blueprint_packages
  add column if not exists guided_photos boolean not null default false;
comment on column public.blueprint_packages.guided_photos is
  'The booking opens on a walk-through: the levers first, then one camera screen per photo step (blueprint_package_photos.step), then the instant quote. Migration 236; the garage floor first.';

-- ---- the package ---------------------------------------------------------
insert into public.blueprint_packages
  (code, name, tile_title, tile_line2, trade, tile_group, availability, base_price_cents, config_label,
   requires_permit, permit_deposit_pct, instant_book, illustration, description, sort_order, is_active,
   category, promote, guided_photos, created_by, last_modified_by, last_modified_at)
values
  ('garage_floor', 'Epoxy garage floor', 'Epoxy garage floor', null, 'Flooring Installer', 'front', 'priced', 390000,
   '2-car garage up to 600 sq ft, sound concrete, full-flake epoxy with a clear polyaspartic topcoat',
   false, null, true, 'garage_floor',
   'A showroom floor that shrugs off oil, salt and hot tires - ground, coated and sealed in two days.',
   8, true, 'inside', false, true, 'migration 236', 'migration 236', now())
on conflict (code) do nothing;

-- ---- what gets done -------------------------------------------------------
insert into public.blueprint_package_items (package_code, kind, label, detail, sort_order)
select 'garage_floor', v.kind, v.label, v.detail, v.sort_order
  from (values
    ('work',      'Diamond-grind the whole floor',            'opens the concrete so the coating bonds, dust-extracted', 10),
    ('work',      'Fill hairline cracks and small pits',       'wider cracks and spalling are the condition answer', 20),
    ('work',      'Epoxy base coat with full color-flake broadcast', null, 30),
    ('work',      'Clear polyaspartic topcoat',               'UV-stable, oil- and salt-resistant, textured against slipping', 40),
    ('work',      'Walk on it in 24 hours, park on it in 72', null, 50),
    ('assurance', 'Insurance coverage',                       null, 60),
    ('assurance', 'Workmanship warranty',                     'against peeling and hot-tire lift', 70)
  ) as v(kind, label, detail, sort_order)
 where not exists (select 1 from public.blueprint_package_items i where i.package_code = 'garage_floor');

-- ---- what moves the price -------------------------------------------------
do $mig$
declare v_lever uuid;
begin
  insert into public.blueprint_package_levers (package_code, key, label, control, question, sort_order, unit)
  values ('garage_floor', 'size', 'Garage size', 'seg', 'How big is the garage?', 10, 'sqft')
  on conflict (package_code, key) do nothing
  returning id into v_lever;
  if v_lever is not null then
    insert into public.blueprint_package_lever_options (lever_id, key, label, price_delta_cents, is_default, chip, sort_order, upto) values
      (v_lever, 'one_car',   '1-car garage, up to 300 sq ft', -130000, false, '1-Car', 10, 300),
      (v_lever, 'two_car',   '2-car garage, up to 600 sq ft',       0, true,  '2-Car', 20, 600),
      (v_lever, 'three_car', '3-car garage, over 600 sq ft',   170000, false, '3-Car', 30, null);
  end if;

  v_lever := null;
  insert into public.blueprint_package_levers (package_code, key, label, control, question, sort_order)
  values ('garage_floor', 'condition', 'Floor condition', 'seg', 'What shape is the concrete in?', 20)
  on conflict (package_code, key) do nothing
  returning id into v_lever;
  if v_lever is not null then
    insert into public.blueprint_package_lever_options (lever_id, key, label, price_delta_cents, is_default, chip, sort_order) values
      (v_lever, 'smooth',  'Smooth, sound concrete',            0,     true,  'Smooth',  10),
      (v_lever, 'cracked', 'Cracks wider than a hairline',      45000, false, 'Cracked', 20),
      (v_lever, 'stained', 'Oil or rust stains',                25000, false, 'Stained', 30),
      (v_lever, 'pitted',  'Pitted, flaking or an old coating', 75000, false, 'Pitted',  40);
  end if;

  v_lever := null;
  insert into public.blueprint_package_levers (package_code, key, label, control, question, sort_order)
  values ('garage_floor', 'finish', 'Finish', 'seg', 'Which finish?', 30)
  on conflict (package_code, key) do nothing
  returning id into v_lever;
  if v_lever is not null then
    insert into public.blueprint_package_lever_options (lever_id, key, label, price_delta_cents, is_default, chip, sort_order) values
      (v_lever, 'flake',    'Full color flake',     0,       true,  'Flake',    10),
      (v_lever, 'solid',    'Solid color',          -35000,  false, 'Solid',    20),
      (v_lever, 'metallic', 'Metallic epoxy',       120000,  false, 'Metallic', 30);
  end if;
end $mig$;

-- ---- the walk-through's photos ------------------------------------------
insert into public.blueprint_package_photos (package_code, key, label, hint, sort_order, step, guide) values
  ('garage_floor', 'exterior',    'Exterior view',
   'Door open, from the driveway about 15 ft back, so the whole opening and the floor inside are in frame.',
   10, 2, 'Step back 15 ft. Capture the entire opening.'),
  ('garage_floor', 'interior',    'Interior to the closed door',
   'Door closed, from the back wall, the door centered - the floor end to end, cracks and stains included.',
   20, 3, 'Stand at the back wall. Center the closed door.'),
  ('garage_floor', 'angle_left',  'Exterior, 45° to the left',
   'Stand near the door and face left: the driveway and yard on that side, where the crew parks and sets up.',
   30, 4, 'Face left. Capture the landscape.'),
  ('garage_floor', 'angle_right', 'Exterior, 45° to the right',
   'Stand near the door and face right: the house and the driveway, how the crew gets in.',
   40, 4, 'Face right. Capture the house and driveway.')
on conflict (package_code, key) do nothing;

-- ---- the progress line ------------------------------------------------------
insert into public.blueprint_package_milestones (package_code, key, kind, name, sequence_no, percent_of_contract, typical_range, trigger_description)
values
  ('garage_floor', 'booked',    'booked',   'Booked',              1, null, null,           'You booked the package.'),
  ('garage_floor', 'accepted',  'accepted', 'Contractor accepted', 2, null, '24–48 h',      'A coating crew took the job.'),
  ('garage_floor', 'scheduled', 'payment',  'Date set',            3, 20,   'within a week', 'You agree the two days with the crew. 20% is due to hold the date and order the coating, paid to the contractor.'),
  ('garage_floor', 'work_done', 'payment',  'Floor coated',        4, 80,   '2 days',       'Ground, coated and sealed. The balance is due to the contractor.'),
  ('garage_floor', 'done',      'done',     'Done',                5, null, null,           'Park on it after 72 hours.')
on conflict (package_code, key) do nothing;

-- ---- the package says whether it walks the photos, and how -------------------
create or replace function public.homeowner_package(p_code text)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select jsonb_build_object(
    'code', p.code, 'name', p.name, 'tile_title', p.tile_title, 'tile_line2', p.tile_line2,
    'trade', p.trade, 'tile_group', p.tile_group, 'availability', p.availability,
    'base_price_cents', p.base_price_cents, 'config_label', p.config_label,
    'requires_permit', p.requires_permit, 'permit_deposit_pct', p.permit_deposit_pct,
    'instant_book', p.instant_book, 'approval_note', p.approval_note,
    'illustration', p.illustration, 'description', p.description, 'sort_order', p.sort_order,
    'photo_url', p.photo_url, 'promote', p.promote,
    'needs_gas_survey', p.needs_gas_survey,
    'guided_photos', p.guided_photos,
    'items', coalesce((select jsonb_agg(jsonb_build_object('label', i.label, 'detail', i.detail, 'kind', i.kind, 'links', i.links) order by i.sort_order)
                         from public.blueprint_package_items i where i.package_code = p.code), '[]'::jsonb),
    'levers', coalesce((select jsonb_agg(jsonb_build_object(
                 'key', l.key, 'label', l.label, 'control', l.control, 'question', l.question, 'unit', l.unit,
                 'options', coalesce((select jsonb_agg(jsonb_build_object(
                     'key', o.key, 'label', o.label, 'price_delta_cents', o.price_delta_cents,
                     'is_default', o.is_default, 'chip', o.chip, 'upto', o.upto) order by o.sort_order)
                   from public.blueprint_package_lever_options o where o.lever_id = l.id), '[]'::jsonb))
                 order by l.sort_order)
               from public.blueprint_package_levers l where l.package_code = p.code), '[]'::jsonb),
    'photos', coalesce((select jsonb_agg(jsonb_build_object(
                 'key', ph.key, 'label', ph.label, 'hint', ph.hint,
                 'step', ph.step, 'guide', ph.guide, 'example_url', ph.example_url) order by ph.sort_order)
                         from public.blueprint_package_photos ph where ph.package_code = p.code), '[]'::jsonb),
    'milestones', coalesce((select jsonb_agg(jsonb_build_object(
                 'key', m.key, 'kind', m.kind, 'name', m.name, 'sequence_no', m.sequence_no,
                 'percent_of_contract', m.percent_of_contract, 'typical_range', m.typical_range,
                 'trigger_description', m.trigger_description) order by m.sequence_no)
               from public.blueprint_package_milestones m where m.package_code = p.code), '[]'::jsonb),
    'videos', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'label', v.label, 'url', v.url) order by v.sort_order, v.created_at)
                         from public.blueprint_package_videos v where v.package_code = p.code and v.is_active), '[]'::jsonb),
    'sections', coalesce((select jsonb_agg(jsonb_build_object(
                 'kind', s.kind, 'headline', s.headline, 'body', s.body, 'image_url', s.image_url)
                 order by s.sort_order)
               from public.blueprint_package_sections s
              where s.package_code = p.code and s.is_active), '[]'::jsonb),
    -- The questions a gas job asks about the house. Reference data, public by
    -- nature: the same eight-plus names every house is asked about.
    'gas_kinds', case when p.needs_gas_survey then coalesce((select jsonb_agg(jsonb_build_object(
                 'key', k.key, 'label', k.label, 'hint', k.hint,
                 'typical_low', k.typical_btuh_low, 'typical_high', k.typical_btuh_high) order by k.sort_order)
               from public.gas_appliance_kinds k), '[]'::jsonb) end)
  from public.blueprint_packages p
  where p.code = p_code and p.is_active;
$function$;

-- ---- what the walk-through measured, on the booking --------------------------
-- p_survey: { approach ('turnkey' / 'diy'), width_ft, length_ft }. Merged into
-- project_bookings.survey, so a later answer adds to an earlier one rather than
-- wiping it. The priced band is already in selections; the feet are what the
-- crew measures against.
create or replace function public.homeowner_booking_survey_save(p_project uuid, p_survey jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_w int; v_l int; v_add jsonb;
begin
  perform public.assert_own_hands();
  if p_project is null or not public.is_project_member(p_project) then
    return jsonb_build_object('ok', false, 'reason', 'That job is not one of yours.');
  end if;
  if not exists (select 1 from public.project_bookings where project_id = p_project) then
    return jsonb_build_object('ok', false, 'reason', 'That job was not booked from a package.');
  end if;
  if p_survey is null or jsonb_typeof(p_survey) <> 'object' then
    return jsonb_build_object('ok', false, 'reason', 'Nothing to save.');
  end if;

  v_w := case when (p_survey->>'width_ft') ~ '^\d{1,3}$' then (p_survey->>'width_ft')::int end;
  v_l := case when (p_survey->>'length_ft') ~ '^\d{1,3}$' then (p_survey->>'length_ft')::int end;
  if (v_w is not null and (v_w < 4 or v_w > 200)) or (v_l is not null and (v_l < 4 or v_l > 200)) then
    return jsonb_build_object('ok', false, 'reason', 'A garage side is between 4 and 200 feet.');
  end if;

  v_add := jsonb_strip_nulls(jsonb_build_object(
    'approach',  case when p_survey->>'approach' in ('turnkey', 'diy') then p_survey->>'approach' end,
    'width_ft',  v_w,
    'length_ft', v_l,
    'sqft',      case when v_w is not null and v_l is not null then v_w * v_l end,
    'at',        now()));

  update public.project_bookings
     set survey = coalesce(survey, '{}'::jsonb) || v_add,
         last_modified_at = now()
   where project_id = p_project;

  return jsonb_build_object('ok', true, 'survey', v_add);
end $function$;

revoke all on function public.homeowner_booking_survey_save(uuid, jsonb) from public, anon;
grant execute on function public.homeowner_booking_survey_save(uuid, jsonb) to authenticated, service_role;

update public.config set schema_version = schema_version + 1, schema_updated_at = current_date;
