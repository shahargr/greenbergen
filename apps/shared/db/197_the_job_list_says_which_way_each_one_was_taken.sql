-- 197: projects.delivery reaches the list, so a row can say DIY or hired.
--
-- Shahar asked for the badge where it earns its place: scanning ten jobs,
-- "am I doing this one or is somebody else" is the question the list is
-- being read for. homeowner_me is what feeds those rows and it did not
-- carry the column.
--
-- PATCHED, NOT RETYPED. The function is 8.5k of SQL that nothing else in
-- this migration needs to change. Re-typing it to add one key is how a
-- careful edit becomes an accidental rewrite, so the definition is read from
-- the catalogue, one anchor is replaced, and the result is executed. The
-- guard below means a drifted anchor fails loudly instead of silently
-- leaving the column out.

do $$
declare
  v_def text;
  v_hits int;
  v_anchor text := '''stage'', j.stage,' || chr(10) || '        ''package_code'', j.package_code,';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'homeowner_me';
  if v_def is null then
    raise exception 'homeowner_me not found';
  end if;

  -- Already carries it: nothing to do, and re-running must be safe.
  if position('''delivery'', j.delivery' in v_def) > 0 then
    return;
  end if;

  v_hits := (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  if v_hits <> 1 then
    raise exception 'Expected exactly one anchor in homeowner_me, found %. The function moved - patch it by hand rather than guessing.', v_hits;
  end if;

  v_def := replace(v_def, v_anchor,
    v_anchor || chr(10) ||
    '        ''delivery'', j.delivery,');

  execute v_def;
end $$;

update public.config set schema_version = 466, schema_updated_at = current_date;
