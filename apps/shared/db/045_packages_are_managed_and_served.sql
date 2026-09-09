-- 045 - packages are managed in Admin and served by contractors who sign up.
--
-- Shahar: "let's define the packages and how to manage them. every package
-- should have a basic cost for services & hardware (basic setup), with
-- options for upgrade (at cost), such as underground piping, upgraded
-- generator, longer distance deployment. i need an interface under admin
-- to edit those. a contractor with the right trade should have a way to see
-- the packages and sign up to service these. contractor can see the
-- suggested price (as approved by other vendors), and call a different
-- price to win more jobs."
--
-- THE MODEL WAS ALREADY THE MODEL - it just had no door. A package is:
--   blueprint_packages          the basic setup: base_price_cents is what
--                               the default configuration costs, services
--                               and hardware together; config_label says
--                               in words what that default is.
--   blueprint_package_items     the scope lines - what the basic setup
--                               includes (kind work) and what comes with
--                               it (kind assurance: insurance, warranty).
--   blueprint_package_levers    the questions that move the price, each
--     + lever_options           with its answers; the default answer is the
--                               basic setup at +$0, every other answer is
--                               an upgrade (or a saving) at its delta -
--                               a longer run, a bigger generator, propane,
--                               the contractor supplying the hardware.
--                               An add-on that is simply on or off is a
--                               two-answer lever (no / yes).
--   blueprint_package_photos    what the homeowner photographs so the
--                               contractor can confirm without a visit.
--   blueprint_package_milestones the progress line and where money moves.
-- homeowner_price() prices a booking as base + the chosen options' deltas.
-- Nothing here changes that arithmetic.
--
-- WHAT THIS MIGRATION ADDS:
--   1. admin_* functions so the portal's Admin door can read and write all
--      of it, superadmin only, one patch at a time. The database keeps its
--      own rules: the CHECKs on availability, tile_group, control, kind and
--      price, the trade and category foreign keys.
--   2. package_contractors - a contractor's standing on a package: signed
--      up to serve it, with an optional price of their own. expert_packages()
--      shows a contractor the packages in their trades with the community
--      price and who else serves them; expert_package_signup() writes their
--      row. HOW that price reaches the homeowner is NOT decided here (see
--      the help topic packages): the offer loop still sends every job at the
--      community price to every contractor with the trade, and a standing
--      price is recorded and shown, not yet applied.

-- ---------------------------------------------------------------------
-- 1. Admin: read
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
      'contractors', coalesce((select jsonb_agg(jsonb_build_object(
                   'contact_id', pc.contact_id, 'name', coalesce(c.person_name, c.name), 'status', pc.status,
                   'price_cents', pc.price_cents, 'note', pc.note, 'updated_at', pc.updated_at) order by pc.updated_at desc)
                 from public.package_contractors pc join public.contacts c on c.id = pc.contact_id
                 where pc.package_code = p.code), '[]'::jsonb)
    ) from public.blueprint_packages p where p.code = p_code) end;
$$;

-- ---------------------------------------------------------------------
-- 2. Admin: write the package
-- ---------------------------------------------------------------------
create or replace function public.admin_package_save(p_code text, p_patch jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  p public.blueprint_packages; is_new boolean := false; v_code text := lower(btrim(p_code));
  who text := 'admin:packages';
  months int[];
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
    p.requires_permit := false; p.instant_book := true; p.sort_order := 500;
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
       is_active, category, season_months, created_by, last_modified_at, last_modified_by)
    values
      (p.code, p.name, p.tile_title, p.tile_line2, p.trade, p.tile_group, p.availability, p.base_price_cents, p.config_label,
       p.requires_permit, p.permit_deposit_pct, p.instant_book, p.approval_note, p.illustration, p.description, p.sort_order,
       p.is_active, p.category, p.season_months, who, now(), who);
  else
    update public.blueprint_packages set
      name = p.name, tile_title = p.tile_title, tile_line2 = p.tile_line2, trade = p.trade, tile_group = p.tile_group,
      availability = p.availability, base_price_cents = p.base_price_cents, config_label = p.config_label,
      requires_permit = p.requires_permit, permit_deposit_pct = p.permit_deposit_pct, instant_book = p.instant_book,
      approval_note = p.approval_note, illustration = p.illustration, description = p.description, sort_order = p.sort_order,
      is_active = p.is_active, category = p.category, season_months = p.season_months,
      last_modified_at = now(), last_modified_by = who
    where blueprint_packages.code = p.code;
  end if;
  return jsonb_build_object('ok', true, 'code', p.code, 'created', is_new);
exception when others then
  return jsonb_build_object('ok', false, 'reason', sqlerrm);
end $$;

-- ---------------------------------------------------------------------
-- 3. Admin: write one child row - a scope line, a lever, an option, a
--    photo slot, a milestone. p_parent is the package code, or for an
--    option the lever id. Null p_id inserts. Explicit statements per kind,
--    no dynamic SQL.
-- ---------------------------------------------------------------------
create or replace function public.admin_package_row_save(p_kind text, p_id uuid, p_parent text, p_patch jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_id uuid := p_id; v_code text; v_lever uuid;
  t text; d text; k text; so int; q text; ctrl text; chip text; delta int; def boolean; hint text;
  mk text; mkind text; mname text; seq int; pct numeric; rng text; trig text;
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
    -- ONE default per lever: the basic setup is one answer, at +$0.
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
  else return jsonb_build_object('ok', false, 'reason', 'Unknown row kind.');
  end case;
  if v_code is null then return jsonb_build_object('ok', false, 'reason', 'Already gone.'); end if;
  update public.blueprint_packages set last_modified_at = now(), last_modified_by = 'admin:packages' where code = v_code;
  return jsonb_build_object('ok', true, 'code', v_code);
end $$;

-- ---------------------------------------------------------------------
-- 4. Contractors serve packages
-- ---------------------------------------------------------------------
create table if not exists public.package_contractors (
  id            uuid primary key default gen_random_uuid(),
  contact_id    uuid not null references public.contacts(id) on delete cascade,
  package_code  text not null references public.blueprint_packages(code) on delete cascade,
  status        text not null default 'active' check (status in ('active','paused')),
  -- Their standing price for the basic setup, in place of the community
  -- price. Null = the community price. Recorded and shown; how it reaches
  -- a homeowner is a decision not yet taken (help: packages).
  price_cents   integer check (price_cents is null or price_cents >= 0),
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (contact_id, package_code)
);
comment on table public.package_contractors is
  'A contractor''s standing on a package: signed up to serve it (active / paused) and, optionally, their own price for the basic setup in place of the community price. Written by expert_package_signup; read by expert_packages and admin_package. Not yet read by the offer loop.';
alter table public.package_contractors enable row level security;
revoke all on public.package_contractors from anon, authenticated;

-- What a contractor sees: every active package whose trade they hold,
-- the community price, their own standing on it, and how many others
-- serve it. "Suggested price" is the community price - what the package
-- goes out at today and what other vendors have been accepting.
create or replace function public.expert_packages()
returns jsonb
language sql stable security definer set search_path to 'public'
as $$
  with me as (
    select u.contact_id, c.company_id
      from public.app_users u join public.contacts c on c.id = u.contact_id
     where u.id = public.current_app_user_id()
  ),
  my_trades as (
    select r.trade from public.contact_trade_roles r, me where r.contact_id = me.contact_id
    union
    select r.trade from public.company_trade_roles r, me where me.company_id is not null and r.company_id = me.company_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'code', p.code, 'name', p.name, 'tile_title', p.tile_title, 'trade', p.trade,
    'availability', p.availability, 'base_price_cents', p.base_price_cents, 'config_label', p.config_label,
    'illustration', p.illustration, 'requires_permit', p.requires_permit,
    'items', coalesce((select jsonb_agg(jsonb_build_object('label', i.label, 'detail', i.detail, 'kind', i.kind) order by i.sort_order)
                        from public.blueprint_package_items i where i.package_code = p.code), '[]'::jsonb),
    'levers', coalesce((select jsonb_agg(jsonb_build_object('label', l.label,
                 'options', coalesce((select jsonb_agg(jsonb_build_object('label', o.label, 'price_delta_cents', o.price_delta_cents, 'is_default', o.is_default) order by o.sort_order)
                                       from public.blueprint_package_lever_options o where o.lever_id = l.id), '[]'::jsonb)) order by l.sort_order)
                 from public.blueprint_package_levers l where l.package_code = p.code), '[]'::jsonb),
    'mine', (select jsonb_build_object('status', pc.status, 'price_cents', pc.price_cents, 'note', pc.note, 'since', pc.created_at)
               from public.package_contractors pc, me where pc.package_code = p.code and pc.contact_id = me.contact_id),
    'others', (select count(*) from public.package_contractors pc, me
                where pc.package_code = p.code and pc.status = 'active' and pc.contact_id <> me.contact_id),
    'accepted_at', (select jsonb_build_object('n', count(*), 'low', min(b.price_cents), 'high', max(b.price_cents))
                      from public.project_bookings b where b.package_code = p.code and b.accepted_at is not null)
  ) order by p.sort_order, p.name), '[]'::jsonb)
  from public.blueprint_packages p
  where p.is_active and p.trade in (select trade from my_trades);
$$;
comment on function public.expert_packages() is
  'The packages in the calling contractor''s trades (contact and company trade roles), each with the community price, the scope and the levers, the contractor''s own standing on it (package_contractors), how many others serve it, and what accepted bookings have gone for. Empty for someone with no trades.';

create or replace function public.expert_package_signup(p_code text, p_on boolean, p_price_cents integer default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare me_c uuid := public.my_contact_id(); v_trade text; v_company uuid;
begin
  perform public.assert_own_hands();
  if me_c is null then return jsonb_build_object('ok', false, 'reason', 'Not signed in.'); end if;
  select trade into v_trade from public.blueprint_packages where code = p_code and is_active;
  if v_trade is null then return jsonb_build_object('ok', false, 'reason', 'No such package.'); end if;
  select company_id into v_company from public.contacts where id = me_c;
  -- The right trade, or no sign-up: the package only ever reaches people
  -- who carry its trade, and a sign-up must not become a side door.
  if not exists (select 1 from public.contact_trade_roles r where r.contact_id = me_c and r.trade = v_trade)
     and not exists (select 1 from public.company_trade_roles r where v_company is not null and r.company_id = v_company and r.trade = v_trade) then
    return jsonb_build_object('ok', false, 'reason', 'Add ' || v_trade || ' to your trades first.');
  end if;
  if p_price_cents is not null and p_price_cents < 0 then
    return jsonb_build_object('ok', false, 'reason', 'A price cannot be negative.');
  end if;

  insert into public.package_contractors (contact_id, package_code, status, price_cents, note)
  values (me_c, p_code, case when p_on then 'active' else 'paused' end, p_price_cents, nullif(btrim(coalesce(p_note, '')), ''))
  on conflict (contact_id, package_code) do update
    set status = excluded.status, price_cents = excluded.price_cents, note = excluded.note, updated_at = now();
  return jsonb_build_object('ok', true, 'status', case when p_on then 'active' else 'paused' end, 'price_cents', p_price_cents);
end $$;
comment on function public.expert_package_signup(text, boolean, integer, text) is
  'A contractor signs up to serve a package (p_on true) or pauses it, with an optional standing price for the basic setup and a note. Requires the package''s trade on the contact or their company. Upserts package_contractors.';

revoke all on function public.admin_packages() from public, anon;
revoke all on function public.admin_package(text) from public, anon;
revoke all on function public.admin_package_save(text, jsonb) from public, anon;
revoke all on function public.admin_package_row_save(text, uuid, text, jsonb) from public, anon;
revoke all on function public.admin_package_row_delete(text, uuid) from public, anon;
revoke all on function public.expert_packages() from public, anon;
revoke all on function public.expert_package_signup(text, boolean, integer, text) from public, anon;
grant execute on function public.admin_packages() to authenticated, service_role;
grant execute on function public.admin_package(text) to authenticated, service_role;
grant execute on function public.admin_package_save(text, jsonb) to authenticated, service_role;
grant execute on function public.admin_package_row_save(text, uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.admin_package_row_delete(text, uuid) to authenticated, service_role;
grant execute on function public.expert_packages() to authenticated, service_role;
grant execute on function public.expert_package_signup(text, boolean, integer, text) to authenticated, service_role;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
