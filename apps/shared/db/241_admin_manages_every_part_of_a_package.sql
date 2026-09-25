-- 241 ADMIN MANAGES EVERY PART OF A PACKAGE
--
-- Shahar (2026-09-25): "any package is managed by Admin." Migrations 235 and
-- 236 added fields the migration set and Admin could not touch:
--
--   blueprint_packages.guided_photos      the booking walks its photos one
--                                         camera screen at a time (236)
--   blueprint_packages.needs_gas_survey   the booking asks the gas survey (235)
--   blueprint_package_levers.unit         a lever measured in a unit - ft
--                                         draws a slider, sqft car-count
--                                         cards (235, 236)
--   blueprint_package_lever_options.upto  the far end of that answer's band
--   blueprint_package_photos.step         slots sharing a step share a camera
--                                         screen; blank = the photos list only
--   blueprint_package_photos.guide        the viewfinder line (120 characters)
--   blueprint_package_photos.example_url  a reference picture behind it
--
-- admin_package returns them; admin_package_save takes the two package
-- switches; admin_package_row_save takes the rest - but only when the patch
-- CARRIES the key, so a caller that does not send a field leaves it as it is
-- (the rule the photo row already followed for step / guide / example_url).

do $mig$
declare
  src text; n int;
  edits jsonb;
  e jsonb;
  has_unit text := 'case when p_patch ? ''unit'' then nullif(lower(btrim(p_patch->>''unit'')), '''') end';
  has_upto text := 'case when p_patch ? ''upto'' then nullif(btrim(p_patch->>''upto''), '''')::numeric end';
  has_step text := 'case when p_patch ? ''step'' then nullif(btrim(p_patch->>''step''), '''')::int end';
  has_guide text := 'case when p_patch ? ''guide'' then nullif(btrim(p_patch->>''guide''), '''') end';
  has_example text := 'case when p_patch ? ''example_url'' then nullif(btrim(p_patch->>''example_url''), '''') end';
begin
  edits := jsonb_build_array(
    -- the read
    jsonb_build_object('fn', 'public.admin_package(text)',
      'a', '''promote'', p.promote, ''collected_by'', p.collected_by,',
      'b', '''promote'', p.promote, ''collected_by'', p.collected_by, ''guided_photos'', p.guided_photos, ''needs_gas_survey'', p.needs_gas_survey,'),
    jsonb_build_object('fn', 'public.admin_package(text)',
      'a', '''control'', l.control, ''question'', l.question, ''sort_order'', l.sort_order,',
      'b', '''control'', l.control, ''question'', l.question, ''sort_order'', l.sort_order, ''unit'', l.unit,'),
    jsonb_build_object('fn', 'public.admin_package(text)',
      'a', '''is_default'', o.is_default, ''sort_order'', o.sort_order)',
      'b', '''is_default'', o.is_default, ''sort_order'', o.sort_order, ''upto'', o.upto)'),
    jsonb_build_object('fn', 'public.admin_package(text)',
      'a', '''hint'', ph.hint, ''sort_order'', ph.sort_order)',
      'b', '''hint'', ph.hint, ''sort_order'', ph.sort_order, ''step'', ph.step, ''guide'', ph.guide, ''example_url'', ph.example_url)'),
    -- the package switches
    jsonb_build_object('fn', 'public.admin_package_save(text,jsonb)',
      'a', 'if p_patch ? ''collected_by''  then',
      'b', E'if p_patch ? ''guided_photos'' then p.guided_photos := coalesce((p_patch->>''guided_photos'')::boolean, false); end if;\n  if p_patch ? ''needs_gas_survey'' then p.needs_gas_survey := coalesce((p_patch->>''needs_gas_survey'')::boolean, false); end if;\n  if p_patch ? ''collected_by''  then'),
    jsonb_build_object('fn', 'public.admin_package_save(text,jsonb)',
      'a', 'promote, collected_by, created_by,',
      'b', 'promote, collected_by, guided_photos, needs_gas_survey, created_by,'),
    jsonb_build_object('fn', 'public.admin_package_save(text,jsonb)',
      'a', 'coalesce(p.collected_by, ''contractor''), who,',
      'b', 'coalesce(p.collected_by, ''contractor''), coalesce(p.guided_photos, false), coalesce(p.needs_gas_survey, false), who,'),
    jsonb_build_object('fn', 'public.admin_package_save(text,jsonb)',
      'a', 'collected_by = p.collected_by,',
      'b', 'collected_by = p.collected_by, guided_photos = coalesce(p.guided_photos, false), needs_gas_survey = coalesce(p.needs_gas_survey, false),'),
    -- a lever's unit
    jsonb_build_object('fn', 'public.admin_package_row_save(text,uuid,text,jsonb)',
      'a', '(package_code, key, label, control, question, sort_order)',
      'b', '(package_code, key, label, control, question, sort_order, unit)'),
    jsonb_build_object('fn', 'public.admin_package_row_save(text,uuid,text,jsonb)',
      'a', 'values (v_code, k, t, ctrl, q, coalesce(so, 100))',
      'b', 'values (v_code, k, t, ctrl, q, coalesce(so, 100), ' || has_unit || ')'),
    jsonb_build_object('fn', 'public.admin_package_row_save(text,uuid,text,jsonb)',
      'a', 'control = ctrl, question = q,',
      'b', 'control = ctrl, question = q, unit = case when p_patch ? ''unit'' then ' || has_unit || ' else unit end,'),
    -- an answer's band
    jsonb_build_object('fn', 'public.admin_package_row_save(text,uuid,text,jsonb)',
      'a', '(lever_id, key, label, chip, price_delta_cents, is_default, sort_order)',
      'b', '(lever_id, key, label, chip, price_delta_cents, is_default, sort_order, upto)'),
    jsonb_build_object('fn', 'public.admin_package_row_save(text,uuid,text,jsonb)',
      'a', 'values (v_lever, k, t, v_chip, delta, def, coalesce(so, 100))',
      'b', 'values (v_lever, k, t, v_chip, delta, def, coalesce(so, 100), ' || has_upto || ')'),
    jsonb_build_object('fn', 'public.admin_package_row_save(text,uuid,text,jsonb)',
      'a', 'price_delta_cents = delta, is_default = def,',
      'b', 'price_delta_cents = delta, is_default = def, upto = case when p_patch ? ''upto'' then ' || has_upto || ' else upto end,'),
    -- a photo slot's screen
    jsonb_build_object('fn', 'public.admin_package_row_save(text,uuid,text,jsonb)',
      'a', '(package_code, key, label, hint, sort_order)',
      'b', '(package_code, key, label, hint, sort_order, step, guide, example_url)'),
    jsonb_build_object('fn', 'public.admin_package_row_save(text,uuid,text,jsonb)',
      'a', 'values (v_code, k, t, v_hint, coalesce(so, 100))',
      'b', 'values (v_code, k, t, v_hint, coalesce(so, 100), ' || has_step || ', ' || has_guide || ', ' || has_example || ')'),
    jsonb_build_object('fn', 'public.admin_package_row_save(text,uuid,text,jsonb)',
      'a', 'set key = k, label = t, hint = v_hint,',
      'b', 'set key = k, label = t, hint = v_hint, step = case when p_patch ? ''step'' then ' || has_step || ' else step end, guide = case when p_patch ? ''guide'' then ' || has_guide || ' else guide end, example_url = case when p_patch ? ''example_url'' then ' || has_example || ' else example_url end,')
  );
  for e in select * from jsonb_array_elements(edits) loop
    src := pg_get_functiondef((e->>'fn')::regprocedure);
    n := (length(src) - length(replace(src, e->>'a', ''))) / length(e->>'a');
    if n <> 1 then raise exception 'Migration 241: % matched % times in %, expected 1.', e->>'a', n, e->>'fn'; end if;
    execute replace(src, e->>'a', e->>'b');
  end loop;
end $mig$;

update public.config set schema_version = schema_version + 1, schema_updated_at = current_date;
