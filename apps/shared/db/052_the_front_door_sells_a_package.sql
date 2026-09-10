-- 052 - the front door sells a package.
--
-- Shahar (2026-09-10): the homeowner landing page must show what the
-- company does - a professional at work in a house, the water heater, the
-- standby generator, what we want to promote - and link to the live and
-- completed projects. A visitor starts buying a package from there and
-- registers only at checkout.
--
-- Two things the catalogue did not know, both editable in Admin > Packages:
--
--   photo_url  A photograph of the work being done (public-media or any
--              https URL). The landing draws it large; the tile keeps its
--              line art. Null falls back to the illustration, so the page
--              is never empty while the photos are being taken.
--   promote    Feature this package on the landing page. What is promoted
--              is a decision, not a sort order; when nothing is flagged the
--              landing takes the first open front-page tiles instead.
--
-- The projects side needs nothing new: public_company() already returns the
-- houses in flight and the ones built, with hero photos and public slugs,
-- and anon may call it (that is what the portal's front page reads).
alter table public.blueprint_packages
  add column if not exists photo_url text,
  add column if not exists promote boolean not null default false;
alter table public.blueprint_packages drop constraint if exists blueprint_packages_photo_url_chk;
alter table public.blueprint_packages
  add constraint blueprint_packages_photo_url_chk check (photo_url is null or photo_url ~ '^https://');
comment on column public.blueprint_packages.photo_url is 'A photograph of the work, shown large on the homeowner landing page (052). https only; null draws the illustration.';
comment on column public.blueprint_packages.promote is 'Feature on the homeowner landing page (052). Nothing flagged = the first open front-page tiles.';

-- ---------------------------------------------------------------------
-- 1. The tiles read (anon) carries both; the landing is drawn from it.
-- ---------------------------------------------------------------------
create or replace function public.homeowner_catalogue_tiles()
returns jsonb
language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'code', p.code, 'tile_title', p.tile_title, 'tile_line2', p.tile_line2,
    'tile_group', p.tile_group, 'availability', p.availability,
    'illustration', p.illustration, 'sort_order', p.sort_order,
    'category', p.category, 'season_months', p.season_months,
    'trade', p.trade,
    'covered', public.homeowner_trade_covered(p.trade),
    'photo_url', p.photo_url, 'promote', p.promote,
    'base_price_cents', p.base_price_cents)
    order by p.sort_order, p.name), '[]'::jsonb)
  from public.blueprint_packages p
  where p.is_active;
$function$;

-- ---------------------------------------------------------------------
-- 2. The package page can show the same photograph.
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
    'items', coalesce((select jsonb_agg(jsonb_build_object('label', i.label, 'detail', i.detail) order by i.sort_order)
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

-- ---------------------------------------------------------------------
-- 3. Admin reads and writes both.
-- ---------------------------------------------------------------------
create or replace function public.admin_packages()
returns jsonb
language sql stable security definer set search_path to 'public'
as $$
  select case when not public.is_superadmin() then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object(
      'code', p.code, 'name', p.name, 'tile_title', p.tile_title, 'trade', p.trade,
      'availability', p.availability, 'base_price_cents', p.base_price_cents,
      'is_active', p.is_active, 'sort_order', p.sort_order, 'tile_group', p.tile_group,
      'category', p.category, 'covered', public.homeowner_trade_covered(p.trade),
      'promote', p.promote, 'has_photo', p.photo_url is not null,
      'items', (select count(*) from public.blueprint_package_items i where i.package_code = p.code),
      'levers', (select count(*) from public.blueprint_package_levers l where l.package_code = p.code),
      'servers', (select count(*) from public.package_contractors pc where pc.package_code = p.code and pc.status = 'active'),
      'last_modified_at', p.last_modified_at, 'last_modified_by', p.last_modified_by
    ) order by p.sort_order, p.name)
    from public.blueprint_packages p), '[]'::jsonb) end;
$$;

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
      'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'label', i.label, 'detail', i.detail, 'kind', i.kind, 'sort_order', i.sort_order) order by i.sort_order, i.label)
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

-- The save (045), with two more keys in the patch.
create or replace function public.admin_package_save(p_code text, p_patch jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  p public.blueprint_packages; is_new boolean := false; v_code text := lower(btrim(p_code));
  who text := 'admin:packages';
  months int[];
  v_photo text;
begin
  if not public.is_superadmin() then
    return jsonb_build_object('ok', false, 'reason', 'Administrators only.');
  end if;
  if v_code !~ '^[a-z0-9_]{2,40}$' then
    return jsonb_build_object('ok', false, 'reason', 'A code is lowercase letters, digits and underscores.');
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    return jsonb_build_object('ok', false, 'reason', 'Nothing to save.');
  end if;

  select * into p from public.blueprint_packages where blueprint_packages.code = v_code;
  if p.code is null then
    is_new := true;
    p.code := v_code; p.tile_group := 'more'; p.availability := 'coming_soon'; p.is_active := true;
    p.requires_permit := false; p.instant_book := true; p.sort_order := 500; p.promote := false;
  end if;

  if p_patch ? 'name'          then p.name := nullif(btrim(p_patch->>'name'), ''); end if;
  if p_patch ? 'tile_title'    then p.tile_title := nullif(btrim(p_patch->>'tile_title'), ''); end if;
  if p_patch ? 'tile_line2'    then p.tile_line2 := nullif(btrim(p_patch->>'tile_line2'), ''); end if;
  if p_patch ? 'trade'         then p.trade := nullif(btrim(p_patch->>'trade'), ''); end if;
  if p_patch ? 'tile_group'    then p.tile_group := nullif(btrim(p_patch->>'tile_group'), ''); end if;
  if p_patch ? 'availability'  then p.availability := nullif(btrim(p_patch->>'availability'), ''); end if;
  if p_patch ? 'category'      then p.category := nullif(btrim(p_patch->>'category'), ''); end if;
  if p_patch ? 'illustration'  then p.illustration := nullif(btrim(p_patch->>'illustration'), ''); end if;
  if p_patch ? 'config_label'  then p.config_label := nullif(btrim(p_patch->>'config_label'), ''); end if;
  if p_patch ? 'approval_note' then p.approval_note := nullif(btrim(p_patch->>'approval_note'), ''); end if;
  if p_patch ? 'description'   then p.description := nullif(btrim(p_patch->>'description'), ''); end if;
  if p_patch ? 'base_price_cents' then
    p.base_price_cents := nullif(btrim(p_patch->>'base_price_cents'), '')::integer;
  end if;
  if p_patch ? 'permit_deposit_pct' then
    p.permit_deposit_pct := nullif(btrim(p_patch->>'permit_deposit_pct'), '')::numeric;
  end if;
  if p_patch ? 'sort_order'    then p.sort_order := coalesce(nullif(btrim(p_patch->>'sort_order'), '')::integer, p.sort_order); end if;
  if p_patch ? 'requires_permit' then p.requires_permit := coalesce((p_patch->>'requires_permit')::boolean, false); end if;
  if p_patch ? 'instant_book'  then p.instant_book := coalesce((p_patch->>'instant_book')::boolean, false); end if;
  if p_patch ? 'is_active'     then p.is_active := coalesce((p_patch->>'is_active')::boolean, true); end if;
  if p_patch ? 'season_months' then
    -- "10,11" or "" (all year).
    select array_agg(x::int) into months
      from unnest(string_to_array(nullif(btrim(p_patch->>'season_months'), ''), ',')) x
     where btrim(x) ~ '^\d+$' and btrim(x)::int between 1 and 12;
    p.season_months := months;
  end if;
  -- 052: the photograph and the landing flag.
  if p_patch ? 'photo_url' then
    v_photo := nullif(btrim(p_patch->>'photo_url'), '');
    if v_photo is not null and v_photo !~ '^https://' then
      return jsonb_build_object('ok', false, 'reason', 'The photo must be an https:// address.');
    end if;
    p.photo_url := v_photo;
  end if;
  if p_patch ? 'promote'       then p.promote := coalesce((p_patch->>'promote')::boolean, false); end if;

  if p.name is null or p.tile_title is null or p.trade is null then
    return jsonb_build_object('ok', false, 'reason', 'A package needs a name, a tile title and a trade.');
  end if;
  if p.availability = 'priced' and p.base_price_cents is null then
    return jsonb_build_object('ok', false, 'reason', 'A priced package needs a base price.');
  end if;

  if is_new then
    insert into public.blueprint_packages
      (code, name, tile_title, tile_line2, trade, tile_group, availability, base_price_cents, config_label,
       requires_permit, permit_deposit_pct, instant_book, approval_note, illustration, description, sort_order,
       is_active, category, season_months, photo_url, promote, created_by, last_modified_at, last_modified_by)
    values
      (p.code, p.name, p.tile_title, p.tile_line2, p.trade, p.tile_group, p.availability, p.base_price_cents, p.config_label,
       p.requires_permit, p.permit_deposit_pct, p.instant_book, p.approval_note, p.illustration, p.description, p.sort_order,
       p.is_active, p.category, p.season_months, p.photo_url, p.promote, who, now(), who);
  else
    update public.blueprint_packages set
      name = p.name, tile_title = p.tile_title, tile_line2 = p.tile_line2, trade = p.trade, tile_group = p.tile_group,
      availability = p.availability, base_price_cents = p.base_price_cents, config_label = p.config_label,
      requires_permit = p.requires_permit, permit_deposit_pct = p.permit_deposit_pct, instant_book = p.instant_book,
      approval_note = p.approval_note, illustration = p.illustration, description = p.description, sort_order = p.sort_order,
      is_active = p.is_active, category = p.category, season_months = p.season_months,
      photo_url = p.photo_url, promote = p.promote,
      last_modified_at = now(), last_modified_by = who
    where blueprint_packages.code = p.code;
  end if;
  return jsonb_build_object('ok', true, 'code', p.code, 'created', is_new);
exception when others then
  return jsonb_build_object('ok', false, 'reason', sqlerrm);
end $$;


update public.config set schema_version = schema_version + 1, schema_updated_at = now();
