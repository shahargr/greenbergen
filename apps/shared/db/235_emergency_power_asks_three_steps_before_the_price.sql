-- EMERGENCY POWER ASKS THREE STEPS BEFORE THE PRICE.
--
-- Shahar, 2026-09-24, with a three-phone mock-up: "Emergency power solution -
-- high level 3-step design. Build this into the offering. If selecting a
-- turn key solution, progress to show the price, and what is included on
-- the proposal."
--
--   Step 1  Scope & sizing      whole house or essentials, automatic or
--                               manual transfer switch, distance to the
--                               panel, and which gas appliances the house has
--   Step 2  Appliance details   per appliance: spec-plate photos, a product
--                               link, more photos
--   Step 3  Installation        distance from the gas meter, one wide context
--                               shot, then turn-key or DIY-assisted
--   Turn-key -> the proposal: the price, and what is included.
--
-- WHERE EACH ANSWER LANDS - nothing here is a new place for something that
-- already has one (rulebook 30):
--
--   * Anything that moves the price is a LEVER (help topic packages). Whole
--     house / essentials was already the size lever. The transfer switch and
--     the two distances are three new levers, so homeowner_price(), the
--     configurator, Admin > Packages and the booking all price them with no
--     new code. A distance is a band: each option says how far it reaches
--     (upto, in the lever's unit), so the app can draw the mock-up's slider
--     and still hand the server an option key.
--   * The appliances are the house's GAS SURVEY (migrations 228-230 on the
--     other line of work: gas_appliances, keyed to the asset, three answers
--     per kind). The homeowner fills the same rows the Professionals app
--     reads through portal_gas_survey, so the plumber pricing the gas line
--     sees what the owner photographed. The mock-up lists patio heaters, which
--     the survey did not ask about, and "are all appliances on this list?",
--     whose No needs somewhere to go - two new kinds.
--   * A spec plate photo is a file on the job linked to the appliance
--     (file_links.gas_appliance_id), exactly as portal_gas_photo_attach does.
--   * The context shot is the package's 'spot' photo slot, re-worded to the
--     mock-up's wide shot. Same key, so an open photo request still settles.
--   * What the survey said about THIS job that is not a price - the exact
--     feet on each slider, the approach chosen, the answer to "is that all
--     of them" - goes on the booking (project_bookings.survey). The feet are
--     what the contractor measures against; the band is what was priced.

-- ---- a lever can be a distance ------------------------------------------
alter table public.blueprint_package_levers
  add column if not exists unit text
    check (unit is null or unit ~ '^[a-z]{1,8}$');
comment on column public.blueprint_package_levers.unit is
  'Set when the lever is a measured quantity (ft). Its options are then bands, each reaching up to blueprint_package_lever_options.upto, and the app may draw a slider instead of segments. Null for an ordinary choice.';

alter table public.blueprint_package_lever_options
  add column if not exists upto numeric
    check (upto is null or upto > 0);
comment on column public.blueprint_package_lever_options.upto is
  'For a lever with a unit: the far end of this band, inclusive, in that unit. Null on the last, open-ended band ("over 50 ft"). Ignored when the lever has no unit.';

-- ---- the booking remembers what the survey said -------------------------
alter table public.project_bookings
  add column if not exists survey jsonb;
comment on column public.project_bookings.survey is
  'The pre-booking survey a package asks (the generator''s three steps, migration 235): exact measurements behind a banded lever (panel_ft, gas_ft), the approach chosen (turnkey / diy), whether the owner said the appliance list was complete, and anything else on gas in their words. The priced answers are in selections; the appliances themselves are on the house (gas_appliances).';

-- ---- a product page for an appliance -------------------------------------
alter table public.gas_appliances
  add column if not exists product_url text
    check (product_url is null or product_url ~ '^https://');
comment on column public.gas_appliances.product_url is
  'A link to the maker''s or a store''s page for this model, pasted by the owner when the plate is hard to photograph. https only.';

-- ---- two more things a house burns ---------------------------------------
insert into public.gas_appliance_kinds (key, label, sort_order, typical_btuh_low, typical_btuh_high, hint) values
  ('patio_heater', 'Outdoor patio heater', 45, 30000, 60000,
   'Only if it is PLUMBED IN to the house gas line. A heater on a propane bottle is not on the meter and does not count.'),
  ('other', 'Something else on gas', 90, null, null,
   'Anything the list does not name - a garage heater, a gas light, a second furnace. Say what it is in the note.')
on conflict (key) do nothing;

-- ---- the generator's new levers ------------------------------------------
-- Prices: the two distance levers borrow the EV charger's run from the panel
-- (+$450 for the middle band, +$950 for the far one) as the only priced
-- precedent for a longer run in the catalogue. They are Shahar's to set in
-- Admin > Packages; the bands themselves follow the mock-up's sliders and the
-- existing scope line "Gas line from the meter - Up to 25' from meter".
do $mig$
declare v_lever uuid;
begin
  insert into public.blueprint_package_levers (package_code, key, label, control, question, sort_order)
  values ('generator', 'transfer', 'Transfer switch', 'seg',
          'Should the house switch over by itself when the power drops, or will you flip it by hand?', 12)
  on conflict (package_code, key) do nothing
  returning id into v_lever;
  if v_lever is not null then
    insert into public.blueprint_package_lever_options (lever_id, key, label, price_delta_cents, is_default, chip, sort_order) values
      (v_lever, 'automatic', 'Automatic transfer switch', 0, true,  'Automatic', 10),
      (v_lever, 'manual',    'Manual transfer switch',    0, false, 'Manual',    20);
  end if;

  v_lever := null;
  insert into public.blueprint_package_levers (package_code, key, label, control, question, sort_order, unit)
  values ('generator', 'panel_run', 'Distance to the panel', 'seg',
          'How far from the generator spot to your electrical panel?', 14, 'ft')
  on conflict (package_code, key) do nothing
  returning id into v_lever;
  if v_lever is not null then
    insert into public.blueprint_package_lever_options (lever_id, key, label, price_delta_cents, is_default, chip, sort_order, upto) values
      (v_lever, 'near', 'Panel within 25 ft',  0,     true,  'Up to 25 ft', 10, 25),
      (v_lever, 'mid',  'Panel 25–50 ft away', 45000, false, '25–50 ft',    20, 50),
      (v_lever, 'far',  'Panel over 50 ft away', 95000, false, 'Over 50 ft', 30, null);
  end if;

  v_lever := null;
  insert into public.blueprint_package_levers (package_code, key, label, control, question, sort_order, unit)
  values ('generator', 'gas_run', 'Distance from the gas meter', 'seg',
          'How far from the gas meter to the generator spot?', 22, 'ft')
  on conflict (package_code, key) do nothing
  returning id into v_lever;
  if v_lever is not null then
    insert into public.blueprint_package_lever_options (lever_id, key, label, price_delta_cents, is_default, chip, sort_order, upto) values
      (v_lever, 'near', 'Meter within 25 ft',   0,     true,  'Up to 25 ft', 10, 25),
      (v_lever, 'mid',  'Meter 25–35 ft away',  45000, false, '25–35 ft',    20, 35),
      (v_lever, 'far',  'Meter over 35 ft away', 95000, false, 'Over 35 ft', 30, null);
  end if;
end $mig$;

-- The context shot of step 3: the 'spot' slot, in the mock-up's words.
update public.blueprint_package_photos
   set label = 'Gas meter and the generator spot',
       hint  = 'One wide shot from about 20 ft back, with the gas meter and the spot where the generator goes both in frame.'
 where package_code = 'generator' and key = 'spot';

-- ---- the package says whether it asks, and what ---------------------------
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
    'photos', coalesce((select jsonb_agg(jsonb_build_object('key', ph.key, 'label', ph.label, 'hint', ph.hint) order by ph.sort_order)
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

-- ---- the owner's answers, in one call -------------------------------------
-- p_survey: { approach, panel_ft, gas_ft, all_listed (true / false / null),
--             other (text), appliances: [{ kind, product_url }] }
-- Every kind in appliances is present. When all_listed was answered, every
-- kind NOT in the list is recorded as absent - asked, and there is none -
-- which is the commonest and most useful answer. When it was not answered,
-- the unticked kinds are left alone: a house that told us last year it has a
-- pool heater keeps that answer rather than being wiped by a blank.
create or replace function public.homeowner_gas_survey_save(p_project uuid, p_survey jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_asset uuid; v_me text; v_all boolean; v_other text; v_ids jsonb := '{}'::jsonb;
  k record; v_item jsonb; v_url text; v_present boolean; v_id uuid;
begin
  perform public.assert_own_hands();
  if p_project is null or not public.is_project_member(p_project) then
    return jsonb_build_object('ok', false, 'reason', 'That job is not one of yours.');
  end if;
  if not exists (select 1 from public.project_bookings where project_id = p_project) then
    return jsonb_build_object('ok', false, 'reason', 'That job was not booked from a package.');
  end if;
  select asset_id into v_asset from public.projects where id = p_project;
  if v_asset is null then
    return jsonb_build_object('ok', false, 'reason', 'This job is not attached to a house, so there is nowhere to keep the survey.');
  end if;

  v_me := public.current_app_user_id()::text;
  v_all := case when jsonb_typeof(p_survey->'all_listed') = 'boolean' then (p_survey->>'all_listed')::boolean end;
  v_other := nullif(btrim(coalesce(p_survey->>'other', '')), '');

  for k in select key, label from public.gas_appliance_kinds order by sort_order loop
    v_item := (select a from jsonb_array_elements(coalesce(p_survey->'appliances', '[]'::jsonb)) a where a->>'kind' = k.key limit 1);
    v_url := nullif(btrim(coalesce(v_item->>'product_url', '')), '');
    if v_url is not null and v_url !~ '^https://' then
      return jsonb_build_object('ok', false, 'reason', 'The link for the ' || lower(k.label) || ' has to start with https://.');
    end if;

    v_present := case
      when k.key = 'other' then case when v_all is false or v_other is not null then true
                                     when v_all is true then false end
      when v_item is not null then true
      when v_all is not null then false
    end;
    continue when v_present is null;

    insert into public.gas_appliances as g
      (asset_id, kind, present, product_url, note, surveyed_at, surveyed_by, created_by, last_modified_by)
    values (v_asset, k.key, v_present,
            case when v_present then v_url end,
            case when k.key = 'other' and v_present then v_other end,
            now(), v_me, v_me, v_me)
    on conflict (asset_id, kind) do update set
      present      = excluded.present,
      -- Absent drops whatever was recorded, as the table's check insists.
      manufacturer = case when excluded.present then g.manufacturer end,
      model        = case when excluded.present then g.model end,
      input_btuh   = case when excluded.present then g.input_btuh end,
      product_url  = case when excluded.present then coalesce(excluded.product_url, g.product_url) end,
      note         = coalesce(excluded.note, g.note),
      surveyed_at  = excluded.surveyed_at,
      surveyed_by  = excluded.surveyed_by,
      last_modified_at = now(),
      last_modified_by = excluded.last_modified_by
    returning g.id into v_id;

    if v_present then v_ids := v_ids || jsonb_build_object(k.key, v_id); end if;
  end loop;

  update public.project_bookings
     set survey = jsonb_strip_nulls(jsonb_build_object(
           'approach',   case when p_survey->>'approach' in ('turnkey', 'diy') then p_survey->>'approach' end,
           'panel_ft',   case when (p_survey->>'panel_ft') ~ '^\d{1,4}$' then (p_survey->>'panel_ft')::int end,
           'gas_ft',     case when (p_survey->>'gas_ft') ~ '^\d{1,4}$' then (p_survey->>'gas_ft')::int end,
           'all_listed', v_all,
           'other',      v_other,
           'appliances', (select jsonb_agg(a->>'kind') from jsonb_array_elements(coalesce(p_survey->'appliances', '[]'::jsonb)) a),
           'at',         now())),
         last_modified_at = now()
   where project_id = p_project;

  return jsonb_build_object('ok', true, 'appliances', v_ids);
end $function$;

-- ---- a spec plate photograph, filed against the appliance -----------------
-- The browser has already put the bytes in project-media under the job's id;
-- this records the file on the job and links it to the house's appliance.
create or replace function public.homeowner_gas_photo_add(
  p_project uuid, p_kind text, p_path text,
  p_file_name text default null, p_mime text default null, p_size bigint default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_app uuid; v_label text; v_file uuid;
begin
  perform public.assert_own_hands();
  if p_project is null or not public.is_project_member(p_project) then
    return jsonb_build_object('ok', false, 'reason', 'That job is not one of yours.');
  end if;
  select ga.id, k.label into v_app, v_label
    from public.projects pr
    join public.gas_appliances ga on ga.asset_id = pr.asset_id and ga.kind = p_kind and ga.present
    join public.gas_appliance_kinds k on k.key = ga.kind
   where pr.id = p_project;
  if v_app is null then
    return jsonb_build_object('ok', false, 'reason', 'Save the appliance list first.');
  end if;

  v_file := public.record_project_file(p_project, p_path, p_file_name, p_mime, p_size, v_label || ' - spec plate', 'photo');
  insert into public.file_links (file_id, role, project_id, gas_appliance_id, created_by_user_id)
  values (v_file, 'evidence', p_project, v_app, public.current_app_user_id());

  return jsonb_build_object('ok', true, 'file_id', v_file);
end $function$;

revoke all on function public.homeowner_gas_survey_save(uuid, jsonb) from public, anon;
revoke all on function public.homeowner_gas_photo_add(uuid, text, text, text, text, bigint) from public, anon;
grant execute on function public.homeowner_gas_survey_save(uuid, jsonb) to authenticated, service_role;
grant execute on function public.homeowner_gas_photo_add(uuid, text, text, text, text, bigint) to authenticated, service_role;

-- ---- the contractor sees the link too ------------------------------------
create or replace function public.portal_gas_survey(p_project uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with gate as (
    select public.is_project_member(p_project)
        or public.bid_is_bidder_on(p_project)
        or public.is_superadmin() as ok),
  house as (
    select pr.asset_id, a.asset_name
      from public.projects pr
      left join public.assets a on a.id = pr.asset_id
     where pr.id = p_project),
  row_ as (
    select k.key, k.label, k.sort_order, k.typical_btuh_low, k.typical_btuh_high, k.hint,
           ga.id, ga.present, ga.manufacturer, ga.model, ga.input_btuh, ga.fuel,
           ga.location, ga.note, ga.product_url, ga.surveyed_at, ga.surveyed_by
      from public.gas_appliance_kinds k
      left join house h on true
      left join public.gas_appliances ga
             on ga.asset_id = h.asset_id and ga.kind = k.key)
  select case when not (select ok from gate) then null else
    jsonb_build_object(
      'asset_id', (select asset_id from house),
      'house',    (select asset_name from house),
      -- No asset on the job means nowhere to keep this. The screen says so
      -- rather than showing eight fields that cannot be saved.
      'can_survey', (select asset_id is not null from house),
      -- Whether this job asks at all. The scope screen shows the survey step
      -- only when this is true (migration 230).
      'asked', coalesce((select bp.needs_gas_survey
                           from public.projects pr
                           join public.blueprint_packages bp on bp.code = pr.package_code
                          where pr.id = p_project), false),
      'of',       (select count(*) from public.gas_appliance_kinds),
      'answered', (select count(*) from row_ where present is not null),
      'present_n',(select count(*) from row_ where present),
      -- Only what is actually there, and only where somebody gave a rating.
      'total_btuh', coalesce((select sum(input_btuh) from row_ where present and input_btuh is not null), 0),
      'rated_n',  (select count(*) from row_ where present and input_btuh is not null),
      -- True whenever the sum cannot be trusted as the whole load: something
      -- unanswered, or present with no rating on it.
      'total_is_partial', (select exists (select 1 from row_ where present is null)
                                or exists (select 1 from row_ where present and input_btuh is null)),
      'rows', coalesce((select jsonb_agg(jsonb_build_object(
          'kind', r.key, 'label', r.label, 'hint', r.hint,
          'typical_low', r.typical_btuh_low, 'typical_high', r.typical_btuh_high,
          'id', r.id, 'present', r.present, 'manufacturer', r.manufacturer,
          'model', r.model, 'input_btuh', r.input_btuh, 'fuel', r.fuel,
          'location', r.location, 'note', r.note, 'product_url', r.product_url,
          'surveyed_at', r.surveyed_at, 'surveyed_by', r.surveyed_by,
          'photos', coalesce((
            select jsonb_agg(jsonb_build_object(
              'file_id', f.id, 'file_name', f.file_name, 'kind', f.kind,
              'mime', f.mime_type, 'bucket', f.bucket, 'path', f.path,
              'role', fl.role, 'at', fl.created_at)
              order by fl.created_at desc)
            from public.file_links fl join public.files f on f.id = fl.file_id
           where fl.gas_appliance_id = r.id), '[]'::jsonb))
          order by r.sort_order)
        from row_ r), '[]'::jsonb))
  end;
$function$;

update public.config set schema_version = schema_version + 1, schema_updated_at = current_date;
