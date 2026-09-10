-- 054 - hardware is a scope line of its own kind, with a store link.
--
-- Shahar (2026-09-10), on the generator: "the base cost for services only
-- is $6,500, but on top, generator, pad and transfer switch are needed.
-- Add a link to the suggested product page on Home Depot and Lowe's."
--
-- So a package can now say what the price does NOT include and where to
-- buy it. No new table (rulebook 30): blueprint_package_items already
-- holds what a package is made of, in kinds - work (what gets done) and
-- assurance (what comes with it). A third kind, HARDWARE, is what the
-- homeowner buys before the crew arrives, and it carries `links`: the
-- suggested product pages, [{label, url}], https only. The package page
-- lists hardware under "What you buy" with the store buttons; the price
-- block above it is services only when the package says so in its
-- configuration line.
--
-- Booking copies every item into project_scope_items as before (041), so
-- the contractor's checklist carries "generator with transfer switch" as
-- a line to install, whoever paid for it.
alter table public.blueprint_package_items drop constraint if exists blueprint_package_items_kind_check;
alter table public.blueprint_package_items
  add constraint blueprint_package_items_kind_check check (kind = any (array['work','assurance','hardware']));
alter table public.blueprint_package_items
  add column if not exists links jsonb not null default '[]'::jsonb;
alter table public.blueprint_package_items drop constraint if exists blueprint_package_items_links_chk;
alter table public.blueprint_package_items
  add constraint blueprint_package_items_links_chk check (jsonb_typeof(links) = 'array');
comment on column public.blueprint_package_items.kind is 'work = what gets done; assurance = what comes with it (insurance, warranty); hardware = what the homeowner buys, not in the price (054).';
comment on column public.blueprint_package_items.links is 'Suggested product pages for a hardware line: [{label, url}], https only (054). Empty for work and assurance.';

-- ---------------------------------------------------------------------
-- 1. Reads carry kind and links.
-- ---------------------------------------------------------------------
create or replace function public.homeowner_package(p_code text)
returns jsonb
language sql stable security definer set search_path to 'public'
as $function$
  select jsonb_build_object(
    'code', p.code, 'name', p.name, 'tile_title', p.tile_title, 'tile_line2', p.tile_line2,
    'trade', p.trade, 'tile_group', p.tile_group, 'availability', p.availability,
    'base_price_cents', p.base_price_cents, 'config_label', p.config_label,
    'requires_permit', p.requires_permit, 'permit_deposit_pct', p.permit_deposit_pct,
    'instant_book', p.instant_book, 'approval_note', p.approval_note,
    'illustration', p.illustration, 'description', p.description, 'sort_order', p.sort_order,
    'photo_url', p.photo_url, 'promote', p.promote,
    'items', coalesce((select jsonb_agg(jsonb_build_object('label', i.label, 'detail', i.detail, 'kind', i.kind, 'links', i.links) order by i.sort_order)
                         from public.blueprint_package_items i where i.package_code = p.code), '[]'::jsonb),
    'levers', coalesce((select jsonb_agg(jsonb_build_object(
                 'key', l.key, 'label', l.label, 'control', l.control, 'question', l.question,
                 'options', coalesce((select jsonb_agg(jsonb_build_object(
                     'key', o.key, 'label', o.label, 'price_delta_cents', o.price_delta_cents,
                     'is_default', o.is_default, 'chip', o.chip) order by o.sort_order)
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
                         from public.blueprint_package_videos v where v.package_code = p.code and v.is_active), '[]'::jsonb))
  from public.blueprint_packages p
  where p.code = p_code and p.is_active;
$function$;

create or replace function public.admin_package(p_code text)
returns jsonb
language sql stable security definer set search_path to 'public'
as $$
  select case when not public.is_superadmin() then null else (
    select jsonb_build_object(
      'code', p.code, 'name', p.name, 'tile_title', p.tile_title, 'tile_line2', p.tile_line2,
      'trade', p.trade, 'tile_group', p.tile_group, 'availability', p.availability,
      'base_price_cents', p.base_price_cents, 'config_label', p.config_label,
      'requires_permit', p.requires_permit, 'permit_deposit_pct', p.permit_deposit_pct,
      'instant_book', p.instant_book, 'approval_note', p.approval_note,
      'illustration', p.illustration, 'description', p.description, 'sort_order', p.sort_order,
      'is_active', p.is_active, 'category', p.category, 'season_months', p.season_months,
      'photo_url', p.photo_url, 'promote', p.promote,
      'covered', public.homeowner_trade_covered(p.trade),
      'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'label', i.label, 'detail', i.detail, 'kind', i.kind, 'links', i.links, 'sort_order', i.sort_order) order by i.sort_order, i.label)
                           from public.blueprint_package_items i where i.package_code = p.code), '[]'::jsonb),
      'levers', coalesce((select jsonb_agg(jsonb_build_object(
                   'id', l.id, 'key', l.key, 'label', l.label, 'control', l.control, 'question', l.question, 'sort_order', l.sort_order,
                   'options', coalesce((select jsonb_agg(jsonb_build_object(
                       'id', o.id, 'key', o.key, 'label', o.label, 'chip', o.chip, 'price_delta_cents', o.price_delta_cents,
                       'is_default', o.is_default, 'sort_order', o.sort_order) order by o.sort_order, o.label)
                     from public.blueprint_package_lever_options o where o.lever_id = l.id), '[]'::jsonb))
                   order by l.sort_order, l.label)
                 from public.blueprint_package_levers l where l.package_code = p.code), '[]'::jsonb),
      'photos', coalesce((select jsonb_agg(jsonb_build_object('id', ph.id, 'key', ph.key, 'label', ph.label, 'hint', ph.hint, 'sort_order', ph.sort_order) order by ph.sort_order)
                           from public.blueprint_package_photos ph where ph.package_code = p.code), '[]'::jsonb),
      'milestones', coalesce((select jsonb_agg(jsonb_build_object(
                   'id', m.id, 'key', m.key, 'kind', m.kind, 'name', m.name, 'sequence_no', m.sequence_no,
                   'percent_of_contract', m.percent_of_contract, 'typical_range', m.typical_range,
                   'trigger_description', m.trigger_description) order by m.sequence_no)
                 from public.blueprint_package_milestones m where m.package_code = p.code), '[]'::jsonb),
      'videos', coalesce((select jsonb_agg(jsonb_build_object(
                   'id', v.id, 'label', v.label, 'url', v.url, 'sort_order', v.sort_order, 'is_active', v.is_active,
                   'shown', (select count(distinct e.viewer_key) from public.package_video_events e where e.video_id = v.id and e.event = 'shown'),
                   'plays', (select count(distinct e.viewer_key) from public.package_video_events e where e.video_id = v.id and e.event = 'play'),
                   'completes', (select count(distinct e.viewer_key) from public.package_video_events e where e.video_id = v.id and e.event = 'complete'),
                   'booked', (select count(distinct b.id)
                                from public.package_video_events e
                                join public.projects pr on pr.owner_user_id = e.app_user_id
                                join public.project_bookings b on b.project_id = pr.id and b.package_code = v.package_code
                               where e.video_id = v.id and e.event = 'shown' and e.app_user_id is not null
                                 and b.created_at between e.created_at and e.created_at + interval '14 days'))
                   order by v.sort_order, v.created_at)
                 from public.blueprint_package_videos v where v.package_code = p.code), '[]'::jsonb),
      'contractors', coalesce((select jsonb_agg(jsonb_build_object(
                   'contact_id', pc.contact_id, 'name', coalesce(c.person_name, c.name), 'status', pc.status,
                   'price_cents', pc.price_cents, 'note', pc.note, 'updated_at', pc.updated_at) order by pc.updated_at desc)
                 from public.package_contractors pc join public.contacts c on c.id = pc.contact_id
                 where pc.package_code = p.code), '[]'::jsonb)
    ) from public.blueprint_packages p where p.code = p_code) end;
$$;

-- ---------------------------------------------------------------------
-- 2. The row writer accepts links on an item. Given as a JSON array in the
--    patch (the admin form builds it from one field per store); each entry
--    needs a label and an https url. Only the item branch changes.
-- ---------------------------------------------------------------------
create or replace function public.admin_package_row_save(p_kind text, p_id uuid, p_parent text, p_patch jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_id uuid := p_id; v_code text; v_lever uuid;
  t text; d text; k text; so int; q text; ctrl text; chip text; delta int; def boolean; hint text;
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
    k := nullif(btrim(p_patch->>'key'), ''); t := nullif(btrim(p_patch->>'label'), ''); chip := nullif(btrim(p_patch->>'chip'), '');
    delta := coalesce(nullif(btrim(coalesce(p_patch->>'price_delta_cents', '')), '')::int, 0);
    def := coalesce((p_patch->>'is_default')::boolean, false);
    if k is null or t is null then return jsonb_build_object('ok', false, 'reason', 'An option needs a key and a label.'); end if;
    if k !~ '^[a-z0-9_]{1,30}$' then return jsonb_build_object('ok', false, 'reason', 'A key is lowercase letters, digits and underscores.'); end if;
    if v_id is null then
      insert into public.blueprint_package_lever_options (lever_id, key, label, chip, price_delta_cents, is_default, sort_order)
      values (v_lever, k, t, chip, delta, def, coalesce(so, 100)) returning id into v_id;
    else
      update public.blueprint_package_lever_options set key = k, label = t, chip = chip, price_delta_cents = delta, is_default = def, sort_order = coalesce(so, sort_order)
      where id = v_id;
    end if;
    if def then
      update public.blueprint_package_lever_options set is_default = false where lever_id = v_lever and id <> v_id and is_default;
    end if;

  when 'photo' then
    v_code := p_parent; k := nullif(btrim(p_patch->>'key'), ''); t := nullif(btrim(p_patch->>'label'), ''); hint := nullif(btrim(p_patch->>'hint'), '');
    if k is null or t is null then return jsonb_build_object('ok', false, 'reason', 'A photo slot needs a key and a label.'); end if;
    if v_id is null then
      insert into public.blueprint_package_photos (package_code, key, label, hint, sort_order)
      values (v_code, k, t, hint, coalesce(so, 100)) returning id into v_id;
    else
      update public.blueprint_package_photos set key = k, label = t, hint = hint, sort_order = coalesce(so, sort_order)
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
