-- 071 - a job of a known type wears that type's picture.
--
-- Shahar (2026-09-11), looking at "Emergency generator" under 55 Walnut
-- wearing the house: "if someone creates a package, DIY or Fully managed,
-- the job image should be the one that is on the job type. this one for
-- example should show the generator."
--
-- He is right, and the reason it did not is that nothing on the PROJECT said
-- what kind of job it is. The booking knew (project_bookings.package_code),
-- but only for work booked through the homeowner app; a job started from the
-- portal knew nothing at all. So:
--
-- 1. projects.package_code - the JOB TYPE, one of the catalogue's packages.
--    Backfilled from the bookings, set by homeowner_book (DIY and turn-key
--    alike - both write a booking, both are a package), and accepted by
--    create_home_project so the portal's "Start a project" can carry it too.
--
-- 2. project_face_url(project) - the catalogue photo for that type. It is a
--    PUBLIC url (public-media/packages/...), not a file in the project's
--    private bucket, because it belongs to the type and not to this job:
--    twenty generator jobs share one picture and none of them should carry a
--    copy of it.
--
-- The order a face is now chosen in:
--
--    1. the project's own chosen cover        someone decided
--    2. its job type's catalogue photo        a generator looks like a generator
--    3. the nearest ancestor's cover          the house it is at (063)
--    4. its newest photo that is not money    (062)
--
-- Choosing a photo still wins over everything, so a real photograph of THIS
-- generator going in replaces the stock one the moment somebody picks it.

alter table public.projects
  add column if not exists package_code text references public.blueprint_packages(code);

comment on column public.projects.package_code is
  'The catalogue package this project IS, when it is one - the job type. Set by homeowner_book for anything booked or planned through the homeowner app, and optionally by create_home_project. It gives the job its face (project_face_url) and says what kind of work it is without reading the booking.';

-- What the bookings already knew.
update public.projects p
   set package_code = b.package_code
  from public.project_bookings b
 where b.project_id = p.id
   and p.package_code is null
   and b.package_code is not null;

-- And the four jobs started from the portal, before there was anywhere to
-- record the type. Named by id, not matched on their titles - these were read
-- one at a time and each one is unmistakably the thing it is called.
update public.projects set package_code = 'generator'
 where id in ('3ed03ad0-0390-4a2e-b7dc-9ae201284eb0',   -- Emergency generator, 55 Walnut Drive
              'b5a6bc27-4b88-43f7-a4fe-cbd7664a246a')   -- Ran: Emergency generator, 8 Jason Woods Rd
   and package_code is null;
update public.projects set package_code = 'ev_charger'
 where id in ('34555360-0c2b-451d-bba8-a8e374493c09',   -- EV charger installation, Home
              'd6ce5fb0-b50a-4d8c-9da6-87aaeaf6389b')   -- EV charger installation, 52 Ryerson
   and package_code is null;

-- ---------------------------------------------------------------------------
-- THE FACE OF A JOB TYPE.
create or replace function public.project_face_url(p_project uuid)
returns text
language sql stable security definer set search_path to 'public'
as $$
  select nullif(btrim(bp.photo_url), '')
    from public.projects p
    join public.blueprint_packages bp on bp.code = p.package_code
   where p.id = p_project
     -- A chosen photo outranks the catalogue: this job's own generator beats
     -- the picture of a generator.
     and p.cover_file_id is null
$$;
revoke all on function public.project_face_url(uuid) from public, anon;
grant execute on function public.project_face_url(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- CREATING A JOB CAN SAY WHAT KIND IT IS.
--
-- The old signature is dropped rather than left beside this one: a default
-- argument would make every existing named call ambiguous.
drop function if exists public.create_home_project(text, text, text, text, text[], date, uuid);

create or replace function public.create_home_project(
  p_name text,
  p_address text default null,
  p_town text default null,
  p_description text default null,
  p_trades text[] default null,
  p_target_date date default null,
  p_parent_project_id uuid default null,
  p_package_code text default null
) returns jsonb
language plpgsql set search_path to 'public'
as $function$
declare
  me uuid := public.current_app_user_id();
  v_name text := nullif(btrim(p_name), '');
  v_addr text := nullif(btrim(p_address), '');
  v_town text := nullif(btrim(p_town), '');
  v_id uuid := gen_random_uuid();
  v_parent public.projects;
  v_asset uuid;
  v_domain text := 'construction';
  v_notes text; v_have int;
  v_pkg text;
  c public.contracts;
begin
  perform public.assert_own_hands();
  if me is null then
    return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.');
  end if;
  if v_name is null then
    return jsonb_build_object('ok', false, 'reason', 'Give the project a name.');
  end if;

  -- The job type, when one was named. Unknown is refused rather than dropped
  -- quietly - a typo that silently loses the type would show the wrong face
  -- with nothing to say why.
  v_pkg := nullif(btrim(p_package_code), '');
  if v_pkg is not null then
    if not exists (select 1 from public.blueprint_packages bp where bp.code = v_pkg and bp.is_active) then
      return jsonb_build_object('ok', false, 'reason', 'We do not have a job type called "' || v_pkg || '".');
    end if;
  end if;

  if p_parent_project_id is not null then
    select * into v_parent from public.projects where id = p_parent_project_id;
    if v_parent.id is null or not public.can_edit_project(v_parent.id) then
      return jsonb_build_object('ok', false, 'code', 'PARENT_NOT_YOURS',
        'reason', 'That home is not one you can add work to.');
    end if;
    v_addr   := coalesce(v_addr, v_parent.address);
    v_asset  := v_parent.asset_id;
    v_domain := coalesce(v_parent.domain, 'construction');
  end if;

  if v_addr is null then
    return jsonb_build_object('ok', false, 'reason', 'We need the address of the property.');
  end if;
  if v_town is null then
    v_town := nullif(btrim(split_part(v_addr, ',', 2)), '');
  end if;

  v_notes := 'Created by the homeowner through the portal.' ||
             coalesce(E'\n\nWhat they want done:\n' || nullif(btrim(p_description), ''), '') ||
             coalesce(E'\n\nTrades of interest: ' || array_to_string(p_trades, ', '), '') ||
             coalesce(E'\nHoped-for start: ' || p_target_date::text, '');

  begin
    insert into public.projects
      (id, project_name, address, status, domain, owner_user_id,
       parent_project_id, asset_id, created_by, notes, package_code)
    values (v_id, v_name, v_addr, 'In Progress', v_domain, me,
            p_parent_project_id, v_asset, 'portal:homeowner', v_notes, v_pkg);
  exception
    when insufficient_privilege then
      select * into c from public.contracts where id = public.live_customer_agreement(me);
      if c.id is null then
        return jsonb_build_object('ok', false, 'code', 'NOT_ALLOWED',
          'reason', 'Your account has no active agreement with us yet. Ask for an invitation.');
      end if;
      if not coalesce((c.capabilities->>'create_projects')::boolean, false) then
        return jsonb_build_object('ok', false, 'code', 'NOT_ALLOWED',
          'reason', 'Your agreement does not include creating projects. Ask us to extend it.');
      end if;
      select count(*) into v_have from public.projects p
       where p.owner_user_id = me and p.parent_project_id is null
         and coalesce(p.is_template, false) = false;
      return jsonb_build_object('ok', false, 'code', 'QUOTA_REACHED',
        'quota', c.assets_allowed, 'have', v_have,
        'reason', 'Your agreement covers ' || c.assets_allowed || ' home' ||
                  case when c.assets_allowed = 1 then '' else 's' end ||
                  '. Add this work under one of your homes, or ask us to extend the agreement.');
    when others then
      return jsonb_build_object('ok', false, 'code', sqlstate, 'reason', sqlerrm);
  end;

  if v_town is not null and p_parent_project_id is null then
    perform public.set_home_town(v_town);
  end if;
  return jsonb_build_object('ok', true, 'project_id', v_id, 'name', v_name, 'town', v_town,
                            'package_code', v_pkg,
                            'parent_project_id', p_parent_project_id);
end $function$;

-- ---------------------------------------------------------------------------
-- BOOKED OR PLANNED, THE JOB KNOWS ITS TYPE.
--
-- DIY (p_mode = 'plan') and turn-key (p_mode = 'book') take the same road
-- through here, which is why one line covers both of Shahar's cases.
CREATE OR REPLACE FUNCTION public.homeowner_book(p_code text, p_selections jsonb, p_address text, p_unit text, p_facts jsonb, p_budget_band text, p_note text, p_home_project_id uuid DEFAULT NULL::uuid, p_mode text DEFAULT 'book'::text, p_target_window text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  me uuid := public.current_app_user_id();
  pkg public.blueprint_packages;
  v_addr text := nullif(btrim(p_address), '');
  v_town text; v_home public.projects; v_made jsonb;
  v_price integer; v_cfg text; v_reason text;
  v_project uuid := gen_random_uuid(); v_booking uuid; it record; v_plan boolean := (p_mode = 'plan');
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.'); end if;
  if p_mode not in ('book', 'plan') then return jsonb_build_object('ok', false, 'reason', 'Unknown mode.'); end if;
  select * into pkg from public.blueprint_packages where code = p_code and is_active;
  select price_cents, config_label, reason into v_price, v_cfg, v_reason from public.homeowner_price(p_code, coalesce(p_selections, '{}'::jsonb));
  if v_reason is not null then return jsonb_build_object('ok', false, 'reason', v_reason); end if;

  -- WHICH HOME. A chosen one of the owner's, else the one matching the
  -- address, else a new one (governed by the agreement's quota).
  if p_home_project_id is not null then
    select * into v_home from public.projects p
     where p.id = p_home_project_id and p.id in (select public.homeowner_home_ids(me));
    if v_home.id is null then return jsonb_build_object('ok', false, 'reason', 'That home is not one of yours.'); end if;
    v_addr := coalesce(v_addr, v_home.address);
  else
    if v_addr is null then return jsonb_build_object('ok', false, 'reason', 'We need the address for the price and the permit.'); end if;
    select * into v_home from public.projects p
     where p.id in (select public.homeowner_home_ids(me)) and lower(p.address) = lower(v_addr)
     order by p.created_at limit 1;
    if v_home.id is null then
      v_town := nullif(btrim(split_part(v_addr, ',', 2)), '');
      v_made := public.create_home_asset(coalesce(split_part(v_addr, ',', 1), 'My home'), v_addr, v_town,
                  'Added through the homeowner app when ' || case when v_plan then 'planning ' else 'booking ' end || pkg.name || '.');
      if not coalesce((v_made->>'ok')::boolean, false) then return v_made; end if;
      select * into v_home from public.projects where id = (v_made->>'project_id')::uuid;
    end if;
  end if;

  -- The job: a child project of the home. It carries the package code, which
  -- is what gives it the catalogue's photo (071).
  insert into public.projects (id, project_name, address, status, domain, owner_user_id, parent_project_id, asset_id, created_by, notes, package_code)
  values (v_project, pkg.name, v_addr, 'In Progress', 'construction', me, v_home.id, v_home.asset_id, 'homeowner-app',
          case when v_plan then 'Planned through the homeowner app: ' else 'Booked through the homeowner app: ' end || pkg.name ||
          ' at the community price of $' || round(v_price/100.0) || ' (' || coalesce(v_cfg, 'most common setup') || ').' ||
          coalesce(E'\n\nOwner note: ' || nullif(btrim(p_note), ''), ''),
          pkg.code);

  -- Scope, copied down (rulebook 41) - for a plan too, so the owner reads
  -- exactly what they are planning for.
  for it in select * from public.blueprint_package_items where package_code = pkg.code order by sort_order loop
    insert into public.project_scope_items (project_id, trade, item, category, source, is_required, add_to_contract, add_to_checklist,
                                            origin, notes, created_by, authority, owner_summary, audience)
    values (v_project, pkg.trade, it.label, 'Package: ' || pkg.name, 'blueprint_packages.' || pkg.code, true, true, true,
            'blueprint copy', it.detail, 'homeowner-app', 'unassigned', it.detail, 'both');
  end loop;

  insert into public.project_bookings (project_id, home_project_id, package_code, price_cents, base_price_cents, selections, config_label,
                                       unit, facts, budget_band, note, state, posted_at, target_window, created_by)
  values (v_project, v_home.id, pkg.code, v_price, pkg.base_price_cents, coalesce(p_selections, '{}'::jsonb), v_cfg,
          nullif(btrim(p_unit), ''), p_facts, nullif(btrim(p_budget_band), ''), nullif(btrim(p_note), ''),
          'planned', null, case when v_plan then coalesce(nullif(p_target_window, ''), 'someday') end, 'homeowner-app')
  returning id into v_booking;

  if v_plan then
    return jsonb_build_object('ok', true, 'planned', true, 'project_id', v_project, 'home_project_id', v_home.id, 'booking_id', v_booking,
                              'price_cents', v_price, 'target_window', coalesce(nullif(p_target_window, ''), 'someday'));
  end if;
  return public.homeowner_post_internal(v_project);
end $function$;

-- ---------------------------------------------------------------------------
-- THE BOARD CARRIES BOTH KINDS OF FACE.
--
-- 'cover' is a PRIVATE storage path the app signs; 'cover_url' is a public
-- one it uses as it stands. Exactly one of them is ever worth showing, and
-- cover_url wins when it is there, because a chosen cover suppresses it in
-- project_face_url.
CREATE OR REPLACE FUNCTION public.portal_my_work()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with me as (
    select u.id as app_user_id, u.contact_id
      from app_users u where u.id = public.current_app_user_id()
  ),
  seats as (
    select pm.project_id,
           max(coalesce(pr.authority_rank, 0)) as rank,
           (array_agg(coalesce(pm.project_role, pm.role) order by coalesce(pr.authority_rank, 0) desc))[1] as seat
      from me, project_members pm
      left join project_roles pr on pr.role = pm.project_role
     where pm.status = 'active'
       and (pm.app_user_id = me.app_user_id
            or (pm.app_user_id is null and pm.contact_id = me.contact_id))
     group by pm.project_id
  ),
  bidstate as (
    select b.project_id,
           bool_or(b.won or b.status = 'awarded') as awarded,
           bool_or(b.status = 'invited') as invited,
           bool_or(b.status in ('received','under negotiation')) as submitted,
           max(b.amount) as amount,
           (array_agg(b.id order by b.created_at desc))[1] as latest_bid_id
      from bids b, me where b.bidder_contact_id = me.contact_id group by b.project_id
  ),
  owed as (
    select t.project_id, sum(coalesce(t.amount, 0)) as amount, count(*) as n
      from transactions t, me
     where t.direction = 'out' and t.contractor_id = me.contact_id
       and coalesce(t.status,'') not in ('paid','paid - receipt filed','paid - pending confirmation','settled','cancelled','void')
     group by t.project_id
  ),
  ids as (
    select project_id from seats
    union select project_id from bidstate
    union select project_id from owed
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'project_id', p.id,
    'project_name', p.project_name,
    'address', p.address,
    'status', p.status,
    'stage', p.stage,
    'domain', p.domain,
    'parent_project_id', p.parent_project_id,
    'parent_name', (select pp.project_name from projects pp where pp.id = p.parent_project_id),
    -- A standing household project (insurance, mortgage, taxes...) - the
    -- owner's, not the site's. The Professionals board leaves these out.
    'household', p.home_blueprint_code is not null,
    'seat', s.seat,
    'rank', coalesce(s.rank, 0),
    -- The face: the chosen cover, else the house's, else the newest photo
    -- that is not money evidence (project_face_photo_id, 062/063).
    'cover', (select f.path from files f where f.id = public.project_face_photo_id(p.id)),
    -- ...and whether it is this project's own choice.
    'cover_own', p.cover_file_id is not null,
    -- The job type's picture, when this job is one of the catalogue's and
    -- nobody has chosen a photo of its own (071). A public url, already
    -- usable - the app shows it instead of signing 'cover'.
    'cover_url', public.project_face_url(p.id),
    'package_code', p.package_code,
    'my_open_tasks', (select count(*) from actions a, me
                       where a.project_id = p.id and a.assigned_to_contact_id = me.contact_id
                         and a.status not in ('Completed','Cancelled','Force Cancelled','Superseded')),
    'bid_amount', b.amount,
    'latest_bid_id', b.latest_bid_id,
    'owed', coalesce(o.amount, 0),
    'owed_count', coalesce(o.n, 0),
    'buckets', (
      select coalesce(jsonb_agg(q.x), '[]'::jsonb) from (
        select 'done'::text as x where p.status like 'Closed%'
        union all
        select 'active' where p.status = 'In Progress'
          and (s.project_id is not null or coalesce(b.awarded, false))
        union all
        select 'lead' where p.status = 'In Progress' and coalesce(b.invited, false)
        union all
        select 'decision' where coalesce(b.submitted, false)
        union all
        select 'payment' where coalesce(o.n, 0) > 0
      ) q)
  ) order by p.project_name), '[]'::jsonb)
  from ids
  join projects p on p.id = ids.project_id and p.trashed_at is null and not p.is_template
                 and p.disabled_at is null
  left join seats s on s.project_id = p.id
  left join bidstate b on b.project_id = p.id
  left join owed o on o.project_id = p.id;
$function$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
