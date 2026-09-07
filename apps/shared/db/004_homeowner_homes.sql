-- ============================================================================
-- Homeowner app, part 4: WHICH PROJECTS ARE HOMES (v217, same day).
-- Applied after 001-003 had gone live. The first cut said a home is a
-- top-level project with an address; Shahar's three homes sit under his
-- "Green Bergen Development" container and vanished. A home is now the
-- top-most project of a property asset the member owns (homeowner_home_ids),
-- and every homeowner_* function reads homes through that one rule.
-- 003 carries the same definitions, so a fresh apply of 001-003 is complete;
-- this file is the delta that was run on the live project.
-- ============================================================================
begin;

-- ---------------------------------------------------------------- which projects are HOMES
-- A home is the top-most project of a property asset the member owns: it
-- carries an address and an asset_id, and its parent (if any) is not on the
-- same asset. A home may therefore sit under a business container - Shahar's
-- three sit under "Green Bergen Development" - and a job (same asset as its
-- parent) never counts. One rule, used by every homeowner_* function.
create or replace function public.homeowner_home_ids(p_user uuid default public.current_app_user_id())
returns setof uuid
language sql stable security definer set search_path = public as $$
  select p.id
    from public.projects p
    left join public.projects par on par.id = p.parent_project_id
   where p.owner_user_id = p_user
     and p.trashed_at is null
     and coalesce(p.is_template, false) = false
     and p.address is not null
     and (p.parent_project_id is null
          or (p.asset_id is not null and par.asset_id is distinct from p.asset_id));
$$;
comment on function public.homeowner_home_ids(uuid) is 'The member''s HOMES: the top-most project of each property asset they own (address + asset_id, parent not on the same asset). A home may sit under a business container; a job on the same asset never counts. Every homeowner_* function reads homes through this, never through parent_project_id is null.';

create or replace function public.homeowner_me()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.current_app_user_id(); u public.app_users; v_home public.projects;
begin
  if me is null then return jsonb_build_object('signed_in', false); end if;
  select * into u from public.app_users where id = me;
  select * into v_home from public.projects p
   where p.id in (select public.homeowner_home_ids(me))
   order by (select count(*) from public.project_bookings b where b.home_project_id = p.id and b.state in ('posted','accepted')) desc, p.created_at limit 1;

  return jsonb_build_object(
    'signed_in', true,
    'profile', jsonb_build_object('app_user_id', u.id, 'full_name', u.full_name, 'email', u.email,
                                  'home_zip', u.home_zip, 'home_town', u.home_town, 'contact_id', u.contact_id,
                                  'is_superadmin', u.is_superadmin),
    'home', case when v_home.id is null then null else jsonb_build_object(
              'project_id', v_home.id, 'address', v_home.address, 'name', v_home.project_name,
              'facts', (select b.facts from public.project_bookings b where b.home_project_id = v_home.id and b.facts is not null order by b.created_at desc limit 1)) end,
    -- Every home the member owns, with what is happening on each. Order:
    -- the one with live work first, then oldest first.
    'homes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'project_id', h.id, 'address', h.address, 'name', h.project_name, 'town', nullif(btrim(split_part(h.address, ',', 2)), ''), 'created_at', h.created_at,
        'facts', (select b.facts from public.project_bookings b where b.home_project_id = h.id and b.facts is not null order by b.created_at desc limit 1),
        'live', (select count(*) from public.project_bookings b join public.projects j on j.id = b.project_id where b.home_project_id = h.id and j.trashed_at is null and b.state in ('posted','accepted')),
        'planned', (select count(*) from public.project_bookings b join public.projects j on j.id = b.project_id where b.home_project_id = h.id and j.trashed_at is null and b.state = 'planned'),
        'done', (select count(*) from public.project_bookings b join public.projects j on j.id = b.project_id where b.home_project_id = h.id and j.trashed_at is null and b.state = 'done')
      ) order by (select count(*) from public.project_bookings b where b.home_project_id = h.id and b.state in ('posted','accepted')) desc, h.created_at)
      from public.projects h
      where h.id in (select public.homeowner_home_ids(me))), '[]'::jsonb),
    'home_quota', (
      select jsonb_build_object('allowed', c.assets_allowed,
        'have', (select count(*) from public.projects p where p.owner_user_id = me and p.parent_project_id is null and coalesce(p.is_template,false) = false),
        'can_add', public.may_create_asset())
        from public.contracts c where c.id = public.live_customer_agreement(me)),
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'project_id', b.project_id, 'package_code', b.package_code, 'name', bp.name, 'tile_title', bp.tile_title,
        'illustration', bp.illustration, 'requires_permit', bp.requires_permit, 'instant_book', bp.instant_book,
        'address', p.address, 'home_project_id', b.home_project_id, 'price_cents', b.price_cents, 'config_label', b.config_label,
        'state', b.state, 'created_at', b.created_at, 'posted_at', b.posted_at, 'target_window', b.target_window, 'reply_by', b.reply_by, 'accepted_at', b.accepted_at,
        'closed_at', b.closed_at, 'done_at', b.done_at, 'repost_count', b.repost_count, 'offered_count', b.offered_count,
        'no_taker', (b.state = 'posted' and b.reply_by is not null and b.reply_by < now()),
        'share_slug', case when b.shared_at is not null then b.share_slug end,
        'contractor', case when b.contractor_contact_id is null then null else (
           select jsonb_build_object('contact_id', c.id, 'name', coalesce(co.company_name, c.person_name, c.name),
                                     'person', coalesce(c.person_name, c.name), 'phone', coalesce(c.phone, co.main_phone))
             from public.contacts c left join public.companies co on co.id = c.company_id where c.id = b.contractor_contact_id) end,
        'progress', public.homeowner_progress(b.project_id),
        'unread', (select count(*) from public.messages m where m.project_id = b.project_id and m.to_contact_id = u.contact_id and m.read_at is null),
        'last_message', (select jsonb_build_object('body', left(m.body, 140), 'sent_at', m.sent_at, 'mine', m.from_contact_id = u.contact_id,
                                                   'who', coalesce((select coalesce(c.person_name, c.name) from public.contacts c where c.id = m.from_contact_id), m.sender, 'Green Bergen'))
                           from public.messages m where m.project_id = b.project_id and m.channel = 'in app' order by m.sent_at desc limit 1)
      ) order by (b.state = 'closed'), (b.state = 'done'), (b.state = 'planned'), b.created_at desc)
      from public.project_bookings b
      join public.blueprint_packages bp on bp.code = b.package_code
      join public.projects p on p.id = b.project_id
      where p.trashed_at is null and public.is_project_member(b.project_id)), '[]'::jsonb)
  );
end $$;
comment on function public.homeowner_me() is 'One round trip to render the homeowner shell: profile, every home the member owns with live/planned/done counts, the agreement''s home quota, every booking with its derived progress and unread count.';

create or replace function public.homeowner_book(
  p_code text, p_selections jsonb, p_address text, p_unit text, p_facts jsonb, p_budget_band text, p_note text,
  p_home_project_id uuid default null, p_mode text default 'book', p_target_window text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
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

  -- The job: a child project of the home.
  insert into public.projects (id, project_name, address, status, domain, owner_user_id, parent_project_id, asset_id, created_by, notes)
  values (v_project, pkg.name, v_addr, 'In Progress', 'construction', me, v_home.id, v_home.asset_id, 'homeowner-app',
          case when v_plan then 'Planned through the homeowner app: ' else 'Booked through the homeowner app: ' end || pkg.name ||
          ' at the community price of $' || round(v_price/100.0) || ' (' || coalesce(v_cfg, 'most common setup') || ').' ||
          coalesce(E'\n\nOwner note: ' || nullif(btrim(p_note), ''), ''));

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
end $$;
comment on function public.homeowner_book(text, jsonb, text, text, jsonb, text, text, uuid, text, text) is 'Books OR plans a package on one of the owner''s homes (p_home_project_id), the home matching the address, or a new home (create_home_asset, agreement quota). Writes the job as a child project, the scope copied down and the project_bookings row. p_mode book then posts it (homeowner_post_internal); p_mode plan stops there with state planned and p_target_window. Price is computed here from the levers, never trusted from the browser.';

create or replace function public.homeowner_home_add(p_address text, p_name text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_addr text := nullif(btrim(p_address), '');
begin
  if v_addr is null then return jsonb_build_object('ok', false, 'reason', 'We need the address.'); end if;
  if exists (select 1 from public.projects p where p.id in (select public.homeowner_home_ids()) and lower(p.address) = lower(v_addr)) then
    return jsonb_build_object('ok', false, 'reason', 'That home is already on your account.');
  end if;
  return public.create_home_asset(coalesce(nullif(btrim(p_name), ''), split_part(v_addr, ',', 1)), v_addr,
                                  nullif(btrim(split_part(v_addr, ',', 2)), ''), 'Added through the homeowner app.');
end $$;
comment on function public.homeowner_home_add(text, text) is 'Claims another home without ordering anything: create_home_asset under the customer agreement''s quota, with a duplicate-address guard. The old portal''s "claim your address", kept.';

create or replace function public.homeowner_quote_request(p_code text, p_note text, p_address text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.current_app_user_id(); u public.app_users; v_label text; v_home uuid; v_persona uuid; v_id uuid;
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.'); end if;
  if coalesce(btrim(p_note), '') = '' then return jsonb_build_object('ok', false, 'reason', 'Tell us in a sentence what you have in mind.'); end if;
  select * into u from public.app_users where id = me;
  select coalesce(bp.name, initcap(replace(p_code, '_', ' '))) into v_label from public.blueprint_packages bp where bp.code = p_code;
  v_label := coalesce(v_label, initcap(replace(coalesce(p_code, 'request'), '_', ' ')));
  -- The request sits on the requester's home when they have one, else on
  -- the Master Template project (rulebook: every action has a project).
  select p.id into v_home from public.projects p where p.id in (select public.homeowner_home_ids(me)) order by p.created_at limit 1;
  if v_home is null then select id into v_home from public.projects where project_name = 'Master Template' limit 1; end if;
  select id into v_persona from public.personas where name = 'Bobby';

  insert into public.actions (action, domain, status, priority, project_id, source, created_by, assigned_to, assigned_to_persona_id, depth_level, notes, desired_outcome)
  values ('Quote request from the homeowner app: ' || v_label || ' - ' || coalesce(u.full_name, u.email, 'a member'),
          'construction', 'Not Started', 'Medium', v_home, 'homeowner_app', 'homeowner-app', 'Bobby', v_persona, 2,
          'Requested in the homeowner app (' || coalesce(p_code, '?') || ').' ||
          E'\nMember: ' || coalesce(u.full_name, '?') || ' <' || coalesce(u.email, '?') || '>' || coalesce(' · ZIP ' || u.home_zip, '') ||
          coalesce(E'\nAddress: ' || nullif(btrim(p_address), ''), '') ||
          E'\n\nIn their words:\n' || btrim(p_note),
          'The member has a quote (or a clear next step) for ' || v_label || ' and knows who is coming back to them.')
  returning id into v_id;
  return jsonb_build_object('ok', true, 'action_id', v_id);
end $$;
comment on function public.homeowner_quote_request(text, text, text) is 'The get-a-quote track, the "something else" tile and community-service interest all land as ONE task in actions (domain construction, Bobby), on the member''s home or the Master Template - never a parallel inbox.';

revoke all on function public.homeowner_home_ids(uuid) from public, anon, authenticated;
grant execute on function public.homeowner_home_ids(uuid) to authenticated, service_role;

commit;
