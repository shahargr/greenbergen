-- 049 - a package has a video, or several, and we learn which one works.
--
-- Shahar: "Add to the package main screen video explaining what it is /
-- 2nd half of the screen. Have few versions to see which one drive better
-- engagement. Video like to be provided in the package setup."
--
-- Two tables, both the package's own:
--   blueprint_package_videos   the versions Admin sets up: a label, a URL
--                              (YouTube or a plain video file), an order,
--                              on or off. A package with several active
--                              versions is an experiment.
--   package_video_events       what happened: shown / play / complete, per
--                              viewer. A viewer is a signed-in member (the
--                              anon surface stays read-only, rulebook 71);
--                              the browser keeps a viewer key so the SAME
--                              person sees the SAME version every visit -
--                              an experiment where the variant changes on
--                              every reload measures nothing.
-- The version a viewer gets is chosen in the app from that key, evenly
-- across the active versions. Admin reads, per version: how many were
-- shown it, how many pressed play, how many watched to the end, and how
-- many of those shown it booked the package within fourteen days.

create table if not exists public.blueprint_package_videos (
  id               uuid primary key default gen_random_uuid(),
  package_code     text not null references public.blueprint_packages(code) on delete cascade,
  label            text not null,
  url              text not null,
  sort_order       integer not null default 100,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  created_by       text,
  last_modified_at timestamptz,
  last_modified_by text,
  constraint chk_blueprint_package_videos_url check (url ~ '^https://')
);
comment on table public.blueprint_package_videos is
  'The explainer video versions of a package (Admin > Packages). YouTube links embed; anything else plays as a file. Several active rows on one package are an experiment: each viewer is assigned one, evenly, and package_video_events says which version drew the play, the finish and the booking.';
alter table public.blueprint_package_videos enable row level security;
revoke all on public.blueprint_package_videos from anon, authenticated;

create table if not exists public.package_video_events (
  id           uuid primary key default gen_random_uuid(),
  video_id     uuid not null references public.blueprint_package_videos(id) on delete cascade,
  package_code text not null,
  app_user_id  uuid references public.app_users(id) on delete set null,
  viewer_key   text not null,
  event        text not null check (event in ('shown', 'play', 'complete')),
  created_at   timestamptz not null default now()
);
create index if not exists package_video_events_video_idx on public.package_video_events (video_id, event, viewer_key);
create index if not exists package_video_events_user_idx on public.package_video_events (app_user_id, created_at);
comment on table public.package_video_events is
  'One row per thing a viewer did with a package video: shown, play, complete. Written by homeowner_video_event for signed-in members only; read by admin_package for the per-version numbers.';
alter table public.package_video_events enable row level security;
revoke all on public.package_video_events from anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. The homeowner app reads the active versions with the package.
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

-- What a viewer did. Signed-in only; 'shown' once per viewer per video per
-- day so a reload is not a second impression.
create or replace function public.homeowner_video_event(p_video uuid, p_event text, p_viewer text)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare me uuid := public.current_app_user_id(); v public.blueprint_package_videos; k text := left(btrim(coalesce(p_viewer, '')), 64);
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'signed-in only'); end if;
  if p_event not in ('shown', 'play', 'complete') then return jsonb_build_object('ok', false, 'reason', 'unknown event'); end if;
  if k = '' then return jsonb_build_object('ok', false, 'reason', 'no viewer'); end if;
  select * into v from public.blueprint_package_videos where id = p_video;
  if v.id is null then return jsonb_build_object('ok', false, 'reason', 'no such video'); end if;
  if p_event = 'shown' and exists (
       select 1 from public.package_video_events e
        where e.video_id = v.id and e.viewer_key = k and e.event = 'shown' and e.created_at > now() - interval '1 day') then
    return jsonb_build_object('ok', true, 'dup', true);
  end if;
  insert into public.package_video_events (video_id, package_code, app_user_id, viewer_key, event)
  values (v.id, v.package_code, me, k, p_event);
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.homeowner_video_event(uuid, text, text) from public, anon;
grant execute on function public.homeowner_video_event(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 2. Admin reads the versions with their numbers, and writes them.
-- ---------------------------------------------------------------------
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
                   -- Booked this package within fourteen days of being shown this version.
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

create or replace function public.admin_package_row_save(p_kind text, p_id uuid, p_parent text, p_patch jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_id uuid := p_id; v_code text; v_lever uuid;
  t text; d text; k text; so int; q text; ctrl text; chip text; delta int; def boolean; hint text;
  mk text; mkind text; mname text; seq int; pct numeric; rng text; trig text; v_url text; act boolean;
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
    if v_id is null then
      insert into public.blueprint_package_items (package_code, label, detail, kind, sort_order)
      values (v_code, t, d, k, coalesce(so, 100)) returning id into v_id;
    else
      update public.blueprint_package_items set label = t, detail = d, kind = k, sort_order = coalesce(so, sort_order)
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

  -- A video version (migration 049): a label to tell them apart in the
  -- numbers, an https URL (YouTube or a file), on or off.
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
end $$;

create or replace function public.admin_package_row_delete(p_kind text, p_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_code text;
begin
  if not public.is_superadmin() then
    return jsonb_build_object('ok', false, 'reason', 'Administrators only.');
  end if;
  case p_kind
  when 'item'      then delete from public.blueprint_package_items where id = p_id returning package_code into v_code;
  when 'lever'     then delete from public.blueprint_package_levers where id = p_id returning package_code into v_code;
  when 'option'    then delete from public.blueprint_package_lever_options o where o.id = p_id
                          returning (select l.package_code from public.blueprint_package_levers l where l.id = o.lever_id) into v_code;
  when 'photo'     then delete from public.blueprint_package_photos where id = p_id returning package_code into v_code;
  when 'milestone' then delete from public.blueprint_package_milestones where id = p_id returning package_code into v_code;
  when 'video'     then delete from public.blueprint_package_videos where id = p_id returning package_code into v_code;
  else return jsonb_build_object('ok', false, 'reason', 'Unknown row kind.');
  end case;
  if v_code is null then return jsonb_build_object('ok', false, 'reason', 'Already gone.'); end if;
  update public.blueprint_packages set last_modified_at = now(), last_modified_by = 'admin:packages' where code = v_code;
  return jsonb_build_object('ok', true, 'code', v_code);
end $$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
