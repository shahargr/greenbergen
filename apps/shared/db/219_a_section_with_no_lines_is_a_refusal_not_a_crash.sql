-- A SECTION WITH NO LINES IS A REFUSAL, NOT A CRASH.
--
-- portal_bid_sections_set did `coalesce(sec->'lines', '[]'::jsonb)`, which
-- looks like it handles a missing list and does not: `->` returns JSON null
-- for an absent key, and JSON null is not SQL NULL, so coalesce passes it
-- straight through to jsonb_array_elements_text and Postgres answers
--
--   22023: cannot extract elements from a scalar
--
-- Found on the first real call, building the roofing ask - a query whose
-- section matched nothing produced `"lines": null` and the whole thing died
-- with an error that says nothing about sections.
--
-- jsonb_typeof is the honest test. A section naming no lines is now refused
-- by name, because a heading with nothing under it is a mistake worth being
-- told about rather than a no-op to discover later when the ask goes out
-- with an empty section in it.
create or replace function public.portal_bid_sections_set(
  p_package uuid, p_sections jsonb, p_basis text default 'section')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  pk    public.bid_packages;
  sec   jsonb;
  ix    int := 0;
  v_set int := 0;
  v_ids uuid[];
  v_all uuid[] := '{}';
  v_name text;
begin
  perform public.assert_own_hands();
  select * into pk from public.bid_packages where id = p_package;
  if pk.id is null or not public.bid_can_manage(pk.project_id) then
    return jsonb_build_object('ok', false, 'reason', 'Changing this ask is not yours to do.');
  end if;
  if pk.awarded_bid_id is not null then
    return jsonb_build_object('ok', false, 'reason',
      'This package is awarded. The sections are what the winning price was given against, so they stand.');
  end if;
  if p_basis is not null and p_basis not in ('lump', 'section', 'line') then
    return jsonb_build_object('ok', false, 'reason', 'A price is asked for as a lump, by section, or by line.');
  end if;
  if p_sections is not null and jsonb_typeof(p_sections) <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'The sections have to come as a list.');
  end if;

  for sec in select value from jsonb_array_elements(coalesce(p_sections, '[]'::jsonb)) loop
    ix := ix + 1;
    v_name := nullif(btrim(coalesce(sec->>'section', '')), '');
    if v_name is null then
      return jsonb_build_object('ok', false, 'reason', format('Section %s has no name.', ix));
    end if;
    -- jsonb_typeof, not coalesce: `->` gives JSON null for a missing key and
    -- JSON null is not SQL NULL, so coalesce never fires.
    if jsonb_typeof(sec->'lines') is distinct from 'array'
       or jsonb_array_length(sec->'lines') = 0 then
      return jsonb_build_object('ok', false, 'reason',
        format('"%s" has no lines under it. A heading with nothing in it is not a section anybody can price.', v_name));
    end if;

    select array_agg((v)::uuid) into v_ids
      from jsonb_array_elements_text(sec->'lines') v;

    update public.bid_package_items
       set section = v_name, section_sort = ix
     where package_id = p_package and id = any(v_ids);
    v_set := v_set + coalesce(array_length(v_ids, 1), 0);
    v_all := v_all || v_ids;
  end loop;

  -- Anything the caller did not place comes OUT of its section rather than
  -- keeping a stale heading - a line quietly left under "ROOFING" after
  -- being moved is worse than one with no section at all.
  update public.bid_package_items
     set section = null, section_sort = null
   where package_id = p_package and not (id = any(v_all)) and section is not null;

  update public.bid_packages
     set price_basis = coalesce(p_basis, price_basis),
         price_per_line = (coalesce(p_basis, price_basis) = 'line'),
         last_modified_at = now(), last_modified_by = 'portal:sections'
   where id = p_package;

  return jsonb_build_object('ok', true, 'sections', ix, 'lines_placed', v_set,
                            'basis', coalesce(p_basis, pk.price_basis));
end $fn$;

revoke all on function public.portal_bid_sections_set(uuid, jsonb, text) from public, anon;
grant execute on function public.portal_bid_sections_set(uuid, jsonb, text) to authenticated, service_role;
