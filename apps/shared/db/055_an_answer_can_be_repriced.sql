-- 055 - an answer's price can be changed again.
--
-- Shahar (2026-09-10): "unable to store a price for generator." Every edit
-- of an EXISTING lever answer or photo slot had failed since 045 with
-- "column reference chip is ambiguous": the row writer declared plpgsql
-- variables named chip and hint, the same as the columns, and the UPDATE
-- statements wrote `chip = chip` / `hint = hint`. Postgres refuses to
-- guess which is which; the function caught the error and returned it as
-- the reason. Inserts never hit it (a VALUES list is not ambiguous), which
-- is why new answers saved and edits did not. The variables are v_chip and
-- v_hint now. Nothing else changes.
create or replace function public.admin_package_row_save(p_kind text, p_id uuid, p_parent text, p_patch jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_id uuid := p_id; v_code text; v_lever uuid;
  t text; d text; k text; so int; q text; ctrl text; v_chip text; delta int; def boolean; v_hint text;
  mk text; mkind text; mname text; seq int; pct numeric; rng text; trig text; v_url text; act boolean;
  lk jsonb; e jsonb;
begin
  if not public.is_superadmin() then
    return jsonb_build_object('ok', false, 'reason', 'Administrators only.');
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    return jsonb_build_object('ok', false, 'reason', 'Nothing to save.');
  end if;
  so := nullif(btrim(coalesce(p_patch->>'sort_order', '')), '')::int;

  case p_kind
  when 'item' then
    v_code := p_parent; t := nullif(btrim(p_patch->>'label'), ''); d := nullif(btrim(p_patch->>'detail'), '');
    k := coalesce(nullif(btrim(p_patch->>'kind'), ''), 'work');
    if t is null then return jsonb_build_object('ok', false, 'reason', 'A scope line needs words.'); end if;
    -- Links: an array already, or an array in a string, or nothing.
    lk := case when jsonb_typeof(p_patch->'links') = 'array' then p_patch->'links'
               when nullif(btrim(coalesce(p_patch->>'links', '')), '') is not null then (p_patch->>'links')::jsonb
               else '[]'::jsonb end;
    if jsonb_typeof(lk) <> 'array' then return jsonb_build_object('ok', false, 'reason', 'Links must be a list.'); end if;
    for e in select * from jsonb_array_elements(lk) loop
      if nullif(btrim(coalesce(e->>'label', '')), '') is null or coalesce(e->>'url', '') !~ '^https://' then
        return jsonb_build_object('ok', false, 'reason', 'Every store link needs a name and an https:// address.');
      end if;
    end loop;
    if k <> 'hardware' and jsonb_array_length(lk) > 0 then
      return jsonb_build_object('ok', false, 'reason', 'Store links belong on a hardware line.');
    end if;
    if v_id is null then
      insert into public.blueprint_package_items (package_code, label, detail, kind, sort_order, links)
      values (v_code, t, d, k, coalesce(so, 100), lk) returning id into v_id;
    else
      update public.blueprint_package_items set label = t, detail = d, kind = k, sort_order = coalesce(so, sort_order), links = lk
      where id = v_id returning package_code into v_code;
    end if;

  when 'lever' then
    v_code := p_parent; k := nullif(btrim(p_patch->>'key'), ''); t := nullif(btrim(p_patch->>'label'), '');
    q := nullif(btrim(p_patch->>'question'), ''); ctrl := coalesce(nullif(btrim(p_patch->>'control'), ''), 'seg');
    if k is null or t is null then return jsonb_build_object('ok', false, 'reason', 'A lever needs a key and a label.'); end if;
    if k !~ '^[a-z0-9_]{1,30}$' then return jsonb_build_object('ok', false, 'reason', 'A key is lowercase letters, digits and underscores.'); end if;
    if v_id is null then
      insert into public.blueprint_package_levers (package_code, key, label, control, question, sort_order)
      values (v_code, k, t, ctrl, q, coalesce(so, 100)) returning id into v_id;
    else
      update public.blueprint_package_levers set key = k, label = t, control = ctrl, question = q, sort_order = coalesce(so, sort_order)
      where id = v_id returning package_code into v_code;
    end if;

  when 'option' then
    v_lever := p_parent::uuid;
    select package_code into v_code from public.blueprint_package_levers where id = v_lever;
    if v_code is null then return jsonb_build_object('ok', false, 'reason', 'No such lever.'); end if;
    k := nullif(btrim(p_patch->>'key'), ''); t := nullif(btrim(p_patch->>'label'), ''); v_chip := nullif(btrim(p_patch->>'chip'), '');
    delta := coalesce(nullif(btrim(coalesce(p_patch->>'price_delta_cents', '')), '')::int, 0);
    def := coalesce((p_patch->>'is_default')::boolean, false);
    if k is null or t is null then return jsonb_build_object('ok', false, 'reason', 'An option needs a key and a label.'); end if;
    if k !~ '^[a-z0-9_]{1,30}$' then return jsonb_build_object('ok', false, 'reason', 'A key is lowercase letters, digits and underscores.'); end if;
    if v_id is null then
      insert into public.blueprint_package_lever_options (lever_id, key, label, chip, price_delta_cents, is_default, sort_order)
      values (v_lever, k, t, v_chip, delta, def, coalesce(so, 100)) returning id into v_id;
    else
      update public.blueprint_package_lever_options set key = k, label = t, chip = v_chip, price_delta_cents = delta, is_default = def, sort_order = coalesce(so, sort_order)
      where id = v_id;
    end if;
    if def then
      update public.blueprint_package_lever_options set is_default = false where lever_id = v_lever and id <> v_id and is_default;
    end if;

  when 'photo' then
    v_code := p_parent; k := nullif(btrim(p_patch->>'key'), ''); t := nullif(btrim(p_patch->>'label'), ''); v_hint := nullif(btrim(p_patch->>'hint'), '');
    if k is null or t is null then return jsonb_build_object('ok', false, 'reason', 'A photo slot needs a key and a label.'); end if;
    if v_id is null then
      insert into public.blueprint_package_photos (package_code, key, label, hint, sort_order)
      values (v_code, k, t, v_hint, coalesce(so, 100)) returning id into v_id;
    else
      update public.blueprint_package_photos set key = k, label = t, hint = v_hint, sort_order = coalesce(so, sort_order)
      where id = v_id returning package_code into v_code;
    end if;

  when 'milestone' then
    v_code := p_parent; mk := nullif(btrim(p_patch->>'key'), ''); mkind := nullif(btrim(p_patch->>'kind'), '');
    mname := nullif(btrim(p_patch->>'name'), ''); seq := nullif(btrim(coalesce(p_patch->>'sequence_no', '')), '')::int;
    pct := nullif(btrim(coalesce(p_patch->>'percent_of_contract', '')), '')::numeric;
    rng := nullif(btrim(p_patch->>'typical_range'), ''); trig := nullif(btrim(p_patch->>'trigger_description'), '');
    if mk is null or mkind is null or mname is null then return jsonb_build_object('ok', false, 'reason', 'A milestone needs a key, a kind and a name.'); end if;
    if v_id is null then
      insert into public.blueprint_package_milestones (package_code, key, kind, name, sequence_no, percent_of_contract, typical_range, trigger_description)
      values (v_code, mk, mkind, mname, coalesce(seq, 99), pct, rng, trig) returning id into v_id;
    else
      update public.blueprint_package_milestones set key = mk, kind = mkind, name = mname, sequence_no = coalesce(seq, sequence_no),
        percent_of_contract = pct, typical_range = rng, trigger_description = trig
      where id = v_id returning package_code into v_code;
    end if;

  when 'video' then
    v_code := p_parent; t := nullif(btrim(p_patch->>'label'), ''); v_url := nullif(btrim(p_patch->>'url'), '');
    act := coalesce((p_patch->>'is_active')::boolean, true);
    if t is null or v_url is null then return jsonb_build_object('ok', false, 'reason', 'A video needs a label and a link.'); end if;
    if v_url !~ '^https://' then return jsonb_build_object('ok', false, 'reason', 'A video link starts with https://.'); end if;
    if v_id is null then
      insert into public.blueprint_package_videos (package_code, label, url, sort_order, is_active, created_by, last_modified_at, last_modified_by)
      values (v_code, t, v_url, coalesce(so, 100), act, 'admin:packages', now(), 'admin:packages') returning id into v_id;
    else
      update public.blueprint_package_videos set label = t, url = v_url, sort_order = coalesce(so, sort_order), is_active = act,
             last_modified_at = now(), last_modified_by = 'admin:packages'
      where id = v_id returning package_code into v_code;
    end if;

  else
    return jsonb_build_object('ok', false, 'reason', 'Unknown row kind.');
  end case;

  update public.blueprint_packages set last_modified_at = now(), last_modified_by = 'admin:packages' where code = v_code;
  return jsonb_build_object('ok', true, 'id', v_id, 'code', v_code);
exception when others then
  return jsonb_build_object('ok', false, 'reason', sqlerrm);
end $function$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
