-- ============================================================================
-- Homeowner app, part 6: THE PHOTOS COME AFTER THE BOOKING, NOT BEFORE IT.
--
-- The booking wizard would not let anyone continue without a photo. That is
-- the wrong trade: a person at work cannot photograph their own basement, and
-- the gate turns them away at the last step, after they have already agreed
-- the price. So the job posts now - the price of the day is what the whole
-- product promises - and the photos become a REQUEST that follows the owner
-- around until they are added.
--
-- The request is a row in public.actions, the one task list (rulebook: never
-- a parallel one). That single row is what the inbox draws, what the banner
-- reads, and what the owner can close by hand if they decide the contractor
-- can just come and look. Nothing else stores "photos are missing".
--
-- What is here:
--   homeowner_photos_outstanding(project)  how many are still wanted
--   homeowner_photos(project)              the slots, for the screen
--   homeowner_photo_request_settle(project) closes the request when they land
--   fn_homeowner_photo_request_close       trigger: any photo, any path
--   homeowner_photo_add(...)               upload from the app, keyed to a slot
--   homeowner_post_internal                + opens the request at posting
--   homeowner_me / homeowner_booking       + what the banner needs
--   homeowner_catalogue_tiles()            the grid's 3 kB instead of 37 kB
--
-- Additive: no table is changed, no existing row is updated or deleted, and
-- nothing outside the homeowner_* surface is touched. record_project_file()
-- is shared with the portal and is NOT modified - the trigger sits beside it.
-- ============================================================================
begin;

-- ------------------------------------------------------------ how many wanted
-- A photo counts against a slot when it carries that slot's key
-- (files.vantage_point). Photos that arrived some other way - the job folder,
-- the timeline, or the wizard before this migration - carry no key, so each
-- one still counts down the ask. Being forgiving here matters: the request
-- exists to get a price confirmed, not to police filenames.
create or replace function public.homeowner_photos_outstanding(p_project uuid)
returns integer
language plpgsql stable security definer set search_path = public as $$
declare v_code text; v_req int; v_keyed int; v_loose int;
begin
  select package_code into v_code from public.project_bookings where project_id = p_project;
  if v_code is null then return 0; end if;
  select count(*) into v_req from public.blueprint_package_photos where package_code = v_code;
  if coalesce(v_req, 0) = 0 then return 0; end if;

  select count(distinct f.vantage_point) into v_keyed
    from public.files f
   where f.project_id = p_project and f.kind = 'photo' and f.vantage_point is not null
     and exists (select 1 from public.blueprint_package_photos pp where pp.package_code = v_code and pp.key = f.vantage_point);

  select count(*) into v_loose
    from public.files f
   where f.project_id = p_project and f.kind = 'photo'
     and (f.vantage_point is null
          or not exists (select 1 from public.blueprint_package_photos pp where pp.package_code = v_code and pp.key = f.vantage_point));

  return greatest(coalesce(v_req, 0) - coalesce(v_keyed, 0) - coalesce(v_loose, 0), 0);
end $$;
comment on function public.homeowner_photos_outstanding(uuid) is 'How many of the package''s photos are still wanted on this job. A photo keyed to a slot (files.vantage_point) fills that slot; any other photo on the job counts down the ask too, so a picture added from the folder is not asked for twice. Internal - homeowner_photos() is the granted read.';

revoke all on function public.homeowner_photos_outstanding(uuid) from public, anon, authenticated;

-- --------------------------------------------------------------- the slots
create or replace function public.homeowner_photos(p_project uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_code text; v_out int;
begin
  if not public.is_project_member(p_project) then return null; end if;
  select package_code into v_code from public.project_bookings where project_id = p_project;
  if v_code is null then return null; end if;
  v_out := public.homeowner_photos_outstanding(p_project);

  return jsonb_build_object(
    'outstanding', v_out,
    'required', (select count(*) from public.blueprint_package_photos where package_code = v_code),
    'have', (select count(*) from public.files f where f.project_id = p_project and f.kind = 'photo'),
    'action_id', (select a.id from public.actions a
                   where a.project_id = p_project and a.source = 'homeowner_app' and a.scope_milestone = 'photos'
                     and a.status not in ('Completed','Cancelled','Force Cancelled','Superseded') limit 1),
    'slots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', pp.key, 'label', pp.label, 'hint', pp.hint,
        'file_id', (select f.id from public.files f
                     where f.project_id = p_project and f.kind = 'photo' and f.vantage_point = pp.key
                     order by f.created_at desc limit 1)) order by pp.sort_order)
      from public.blueprint_package_photos pp where pp.package_code = v_code), '[]'::jsonb));
end $$;
comment on function public.homeowner_photos(uuid) is 'The photo request on one job as the app draws it: each slot with the file that fills it, how many are still outstanding, and the id of the open request task (null once it is closed). Members only.';

revoke all on function public.homeowner_photos(uuid) from public, anon;
grant execute on function public.homeowner_photos(uuid) to authenticated, service_role;

-- ------------------------------------------------------- close the request
create or replace function public.homeowner_photo_request_settle(p_project uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_out int := public.homeowner_photos_outstanding(p_project);
begin
  if v_out <= 0 then
    update public.actions
       set status = 'Completed', completed_on = current_date, last_updated = now(), last_modified_by = 'system:photo-request'
     where project_id = p_project and source = 'homeowner_app' and scope_milestone = 'photos'
       and status not in ('Completed','Cancelled','Force Cancelled','Superseded');
  end if;
  return v_out;
end $$;
comment on function public.homeowner_photo_request_settle(uuid) is 'Closes the open photo request on a job once nothing is outstanding. Called by the trigger on files and by homeowner_photo_add. Internal - no grant.';

revoke all on function public.homeowner_photo_request_settle(uuid) from public, anon, authenticated;

create or replace function public.fn_homeowner_photo_request_close()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'photo' and new.project_id is not null
     and exists (select 1 from public.actions a
                  where a.project_id = new.project_id and a.source = 'homeowner_app' and a.scope_milestone = 'photos'
                    and a.status not in ('Completed','Cancelled','Force Cancelled','Superseded'))
  then
    perform public.homeowner_photo_request_settle(new.project_id);
  end if;
  return null;
end $$;
comment on function public.fn_homeowner_photo_request_close() is 'After a photo is recorded on a job - from the wizard, the job folder, or the timeline - closes the photo request if that was the last one wanted. The check is one index lookup on actions and does nothing at all for every project without an open request.';

drop trigger if exists trg_homeowner_photo_request on public.files;
create trigger trg_homeowner_photo_request
  after insert on public.files
  for each row execute function public.fn_homeowner_photo_request_close();

-- --------------------------------------------------------- add one photo
create or replace function public.homeowner_photo_add(
  p_project uuid, p_path text, p_key text, p_file_name text default null,
  p_mime text default null, p_size bigint default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_key text := nullif(btrim(p_key), ''); v_label text; v_file uuid;
begin
  perform public.assert_own_hands();
  if not public.is_project_member(p_project) then return jsonb_build_object('ok', false, 'reason', 'That job is not one of yours.'); end if;
  select pp.label into v_label
    from public.blueprint_package_photos pp
    join public.project_bookings b on b.package_code = pp.package_code
   where b.project_id = p_project and pp.key = v_key;

  v_file := public.record_project_file(p_project, p_path, p_file_name, p_mime, p_size, v_label, 'photo');
  if v_key is not null then update public.files set vantage_point = v_key where id = v_file; end if;
  perform public.homeowner_photo_request_settle(p_project);

  return jsonb_build_object('ok', true, 'file_id', v_file, 'photos', public.homeowner_photos(p_project));
end $$;
comment on function public.homeowner_photo_add(uuid, text, text, text, text, bigint) is 'Records a photo the owner added for a named slot of the package (p_key -> files.vantage_point, the slot label as the caption), then closes the photo request if that was the last one. Wraps record_project_file, which keeps the entitlement and quota checks in one place.';

revoke all on function public.homeowner_photo_add(uuid, text, text, text, text, bigint) from public, anon;
grant execute on function public.homeowner_photo_add(uuid, text, text, text, text, bigint) to authenticated, service_role;

-- ------------------------------------------------------------- the grid's read
-- The grid draws seven fields per package; homeowner_catalogue() returns the
-- whole 37 kB - items, levers, options, photos, milestones - on every view of
-- /packages, and the package page reads its one package through
-- homeowner_package() anyway. This is the same list at about a tenth of a kB
-- each. anon may call it: the grid is browsable before joining.
create or replace function public.homeowner_catalogue_tiles()
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'code', p.code, 'tile_title', p.tile_title, 'tile_line2', p.tile_line2,
    'tile_group', p.tile_group, 'availability', p.availability,
    'illustration', p.illustration, 'sort_order', p.sort_order)
    order by p.sort_order, p.name), '[]'::jsonb)
  from public.blueprint_packages p
  where p.is_active;
$$;
comment on function public.homeowner_catalogue_tiles() is 'The package grid and nothing else: the seven fields a tile draws, ~3 kB for the whole catalogue where homeowner_catalogue() is 37 kB. The package page reads its one package through homeowner_package().';

grant execute on function public.homeowner_catalogue_tiles() to anon, authenticated;

-- ============================================================================
-- The three readers that change. Bodies are carried over from 003/004/005
-- unchanged except for the marked blocks, so a fresh apply of 001-006 and an
-- apply of 006 alone leave the same functions behind.
-- ============================================================================

create or replace function public.homeowner_post_internal(p_project uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b public.project_bookings; pr public.projects; pkg public.blueprint_packages; me uuid;
  v_price integer; v_cfg text; v_reason text;
  v_pkgid uuid; v_reply timestamptz := now() + interval '24 hours';
  v_scope text; m record; v_n int := 0; c record; v_plan public.project_billing_plan;
begin
  select * into b from public.project_bookings where project_id = p_project for update;
  select * into pr from public.projects where id = p_project;
  select * into pkg from public.blueprint_packages where code = b.package_code;
  me := pr.owner_user_id;

  -- Price from the LIVE catalogue: a plan made in spring is posted at the
  -- community price of the day it is posted, never a stale one.
  select price_cents, config_label, reason into v_price, v_cfg, v_reason from public.homeowner_price(b.package_code, b.selections);
  if v_reason is not null then return jsonb_build_object('ok', false, 'reason', v_reason); end if;
  select string_agg(label || coalesce(' - ' || detail, ''), '; ' order by sort_order) into v_scope from public.blueprint_package_items where package_code = pkg.code;

  -- Milestones: money ones become payment stages, hand-marked ones become tasks.
  for m in select * from public.blueprint_package_milestones where package_code = pkg.code order by sequence_no loop
    if m.kind = 'payment' then
      insert into public.payment_stages (project_id, name, sequence_no, percent_of_contract, amount, trigger_description, status, requires_photo, created_by_user_id, notes)
      values (p_project, m.name, m.sequence_no, m.percent_of_contract, round(v_price * m.percent_of_contract / 10000.0, 2),
              m.trigger_description, 'Planned', false, me, 'Package milestone (' || pkg.code || '.' || m.key || '). Paid directly to the contractor; Green Bergen never holds the money.');
    elsif m.kind = 'task' then
      insert into public.actions (action, domain, status, priority, project_id, source, created_by, notes, depth_level, desired_outcome)
      values (m.name, 'construction', 'Not Started', 'Medium', p_project, 'homeowner_app', 'system:package-blueprint',
              coalesce(m.trigger_description, ''), 1, m.name || ' on ' || pkg.name || ' at ' || pr.address || '.');
    end if;
  end loop;

  -- The photos. They confirm the price without a site visit, but they never
  -- block the booking: someone at work cannot photograph their own basement.
  -- The ask goes on the one task list, where the inbox and the banner read it,
  -- and the trigger on files closes it the moment the last one lands.
  if public.homeowner_photos_outstanding(p_project) > 0
     and not exists (select 1 from public.actions a
                      where a.project_id = p_project and a.source = 'homeowner_app' and a.scope_milestone = 'photos')
  then
    insert into public.actions (action, domain, status, priority, project_id, source, created_by, notes, depth_level,
                                desired_outcome, scope_milestone, requires_photo_evidence, target_date)
    values ('Add photos for ' || pkg.name, 'construction', 'Not Started', 'High', p_project, 'homeowner_app', 'system:photo-request',
            'The contractor confirms the price from these instead of coming to look: ' ||
            coalesce((select string_agg(pp.label, '; ' order by pp.sort_order) from public.blueprint_package_photos pp where pp.package_code = pkg.code), 'a photo of the work area') || '.',
            1, 'Photos on file so the contractor can confirm ' || pkg.name || ' at ' || coalesce(pr.address, 'the address') || ' without a site visit.',
            'photos', true, (current_date + 2));
  end if;

  -- Billing plan: the home's, mirrored so a milestone on this job can be
  -- priced (stage_payment_quote reads the plan of the stage's own project).
  -- A home with none (a superadmin's, or one that predates plans) gets the
  -- free pilot, the same default fn_projects_auto_billing_plan applies.
  if not exists (select 1 from public.project_billing_plan where project_id = p_project and status = 'active') then
    select * into v_plan from public.project_billing_plan where project_id = b.home_project_id and status = 'active' limit 1;
    if v_plan.id is not null then
      insert into public.project_billing_plan (project_id, copied_from_plan_id, model, currency, base_amount, billing_interval, percent_rate,
        fee_bearer, fee_split_homeowner_pct, min_fee_amount, max_fee_amount, status, started_on, fee_collection_fallback, provider, payment_method_id, notes)
      values (p_project, v_plan.copied_from_plan_id, v_plan.model, v_plan.currency, v_plan.base_amount, v_plan.billing_interval, v_plan.percent_rate,
        v_plan.fee_bearer, v_plan.fee_split_homeowner_pct, v_plan.min_fee_amount, v_plan.max_fee_amount, 'active', current_date,
        v_plan.fee_collection_fallback, v_plan.provider, v_plan.payment_method_id, 'Mirrored from the home container at posting (homeowner_post_internal) so stage_payment_quote can price this job''s milestones.');
    else
      insert into public.project_billing_plan (project_id, copied_from_plan_id, model, currency, base_amount, billing_interval, percent_rate,
        fee_bearer, fee_split_homeowner_pct, min_fee_amount, max_fee_amount, status, started_on, fee_collection_fallback, provider, payment_method_id, notes)
      select p_project, bp.id, bp.model, coalesce(bp.currency, 'USD'), bp.base_amount, bp.billing_interval, bp.percent_rate,
             bp.fee_bearer, bp.fee_split_homeowner_pct, bp.min_fee_amount, bp.max_fee_amount, 'active', current_date,
             bp.fee_collection_fallback, bp.provider, bp.default_payment_method_id, 'Applied at posting (homeowner_post_internal): the home had no active plan, so the free pilot default was used.'
        from public.blueprint_pricing_plan bp where bp.code = 'free_pilot' and bp.is_active limit 1;
    end if;
  end if;

  -- The offer: one bid package, one invited bid per contractor who can act in-app.
  insert into public.bid_packages (project_id, trade, category, scope_summary, budget_amount, budget_visible, deposit_pct, reply_by, status, created_by)
  values (p_project, pkg.trade, 'Package', pkg.name || ' - ' || coalesce(v_cfg, '') || E'.\nIncluded: ' || coalesce(v_scope, ''),
          round(v_price/100.0, 2), true, pkg.permit_deposit_pct, v_reply::date, 'open', 'homeowner-app')
  returning id into v_pkgid;

  for c in
    select distinct ct.id as contact_id, ct.company_id
      from public.contacts ct
      join public.app_users u on u.contact_id = ct.id and u.is_active
     where ct.id <> coalesce((select contact_id from public.app_users where id = me), '00000000-0000-0000-0000-000000000000'::uuid)
       and (exists (select 1 from public.contact_trade_roles r where r.contact_id = ct.id and r.trade = pkg.trade)
         or exists (select 1 from public.company_trade_roles r where r.company_id = ct.company_id and r.trade = pkg.trade))
  loop
    insert into public.bids (project_id, package_id, trade, package, scope_summary, bidder_contact_id, bidder_company_id,
                             amount, amount_basis, status, round, received_on, created_by)
    values (p_project, v_pkgid, pkg.trade, 'Package', pkg.name, c.contact_id, c.company_id,
            round(v_price/100.0, 2), 'community price - accept or pass', 'invited', 1, null, 'homeowner-app');
    v_n := v_n + 1;
  end loop;

  update public.project_bookings
     set state = 'posted', posted_at = now(), reply_by = v_reply, price_cents = v_price, base_price_cents = pkg.base_price_cents,
         config_label = v_cfg, bid_package_id = v_pkgid, offered_count = v_n, target_window = null
   where id = b.id;
  update public.projects set notes = coalesce(notes, '') || E'\n\nPosted to the community''s ' || pkg.trade || ' contractors at $' || round(v_price/100.0) || ' on ' || to_char(now(), 'YYYY-MM-DD') || '.'
   where id = p_project;

  return jsonb_build_object('ok', true, 'project_id', p_project, 'home_project_id', b.home_project_id, 'booking_id', b.id,
                            'price_cents', v_price, 'reply_by', v_reply, 'offered_count', v_n, 'instant_book', pkg.instant_book);
end $$;
comment on function public.homeowner_post_internal(uuid) is 'The ORDER half of a booking, shared by homeowner_book and homeowner_booking_action(post): re-prices from the live catalogue, writes payment stages and milestone tasks, OPENS THE PHOTO REQUEST when photos are still wanted, mirrors the billing plan, opens the bid package with one invited bid per contractor with a login and the trade, and starts the 24-hour clock. Internal - no grant.';

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
        -- The photo request, for the banner: how many are still wanted and the
        -- open task that asks for them. Null action_id means nothing to nag about.
        'photos_needed', case when b.state in ('posted','accepted') then public.homeowner_photos_outstanding(b.project_id) else 0 end,
        'photos_action_id', (select a.id from public.actions a
                              where a.project_id = b.project_id and a.source = 'homeowner_app' and a.scope_milestone = 'photos'
                                and a.status not in ('Completed','Cancelled','Force Cancelled','Superseded') limit 1),
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
comment on function public.homeowner_me() is 'One round trip to render the homeowner shell: profile, every home the member owns with live/planned/done counts, the agreement''s home quota, every booking with its derived progress, unread count and outstanding photo request.';

create or replace function public.homeowner_booking(p_project uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare b public.project_bookings; pr public.projects; my_contact uuid := public.my_contact_id(); v_is_owner boolean;
begin
  if not public.is_project_member(p_project) then return null; end if;
  select * into b from public.project_bookings where project_id = p_project;
  if b.id is null then return null; end if;
  select * into pr from public.projects where id = p_project;
  v_is_owner := (pr.owner_user_id = public.current_app_user_id()) or public.is_superadmin();

  return jsonb_build_object(
    'project_id', b.project_id, 'home_project_id', b.home_project_id, 'package_code', b.package_code,
    'package', public.homeowner_package(b.package_code),
    'address', pr.address, 'unit', b.unit, 'project_status', pr.status,
    'price_cents', b.price_cents, 'base_price_cents', b.base_price_cents, 'selections', b.selections, 'config_label', b.config_label,
    'facts', case when v_is_owner then b.facts end, 'budget_band', case when v_is_owner then b.budget_band end, 'note', b.note,
    'state', b.state, 'created_at', b.created_at, 'posted_at', b.posted_at, 'target_window', b.target_window, 'reply_by', b.reply_by, 'repost_count', b.repost_count, 'offered_count', b.offered_count,
    'live_price_cents', case when b.state = 'planned' then (select price_cents from public.homeowner_price(b.package_code, b.selections)) end,
    'accepted_at', b.accepted_at, 'closed_at', b.closed_at, 'close_reason', b.close_reason, 'done_at', b.done_at,
    'no_taker', (b.state = 'posted' and b.reply_by is not null and b.reply_by < now()),
    'photos', public.homeowner_photos(p_project),
    'is_owner', v_is_owner, 'my_contact_id', my_contact,
    'share', jsonb_build_object('slug', b.share_slug, 'shared_at', b.shared_at, 'quote', b.share_quote, 'hide_address', b.share_hide_address, 'after_file_id', b.share_after_file_id),
    'owner', (select jsonb_build_object('contact_id', u.contact_id, 'name', u.full_name) from public.app_users u where u.id = pr.owner_user_id),
    'contractor', case when b.contractor_contact_id is null then null else (
       select jsonb_build_object('contact_id', c.id, 'name', coalesce(co.company_name, c.person_name, c.name),
                                 'person', coalesce(c.person_name, c.name), 'phone', coalesce(c.phone, co.main_phone),
                                 'email', c.email_a, 'license', co.license_number,
                                 'insured', exists (select 1 from public.insurance_certificates ic where (ic.contractor_id = c.id or ic.company_id = co.id) and (ic.expiry_date is null or ic.expiry_date >= current_date)),
                                 'insurance', (select jsonb_build_object('coverage', ic.coverage_type, 'limit', ic.each_occurrence_limit, 'expires', ic.expiry_date)
                                                 from public.insurance_certificates ic where (ic.contractor_id = c.id or ic.company_id = co.id) order by ic.expiry_date desc nulls last limit 1),
                                 'rating', case when co.id is null then null else public.contractor_rating(co.id) end,
                                 'jobs', (select count(*) from public.project_bookings x where x.contractor_contact_id = c.id and x.state in ('accepted','done')))
         from public.contacts c left join public.companies co on co.id = c.company_id where c.id = b.contractor_contact_id) end,
    'progress', public.homeowner_progress(p_project),
    'stages', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'sequence_no', s.sequence_no,
                 'amount_cents', (coalesce(s.amount,0)*100)::bigint, 'percent', s.percent_of_contract, 'status', s.status,
                 'settlement_status', s.settlement_status, 'paid_at', s.paid_at, 'approved_at', s.approved_at, 'trigger', s.trigger_description,
                 'evidence', coalesce((select jsonb_agg(jsonb_build_object('file_id', f.id, 'path', f.path, 'kind', f.kind))
                                        from public.file_links fl join public.files f on f.id = fl.file_id where fl.payment_stage_id = s.id), '[]'::jsonb))
                 order by s.sequence_no) from public.payment_stages s where s.project_id = p_project), '[]'::jsonb),
    'scope', coalesce((select jsonb_agg(jsonb_build_object('item', si.item, 'detail', si.owner_summary) order by si.created_at)
                        from public.project_scope_items si where si.project_id = p_project), '[]'::jsonb),
    'files', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'path', f.path, 'bucket', f.bucket, 'kind', f.kind, 'mime', f.mime_type,
                 'caption', f.caption, 'created_at', f.created_at, 'by_me', f.uploaded_by_user_id = public.current_app_user_id(),
                 'by', coalesce(u.full_name, u.email), 'role', (select fl.role from public.file_links fl where fl.file_id = f.id and fl.project_id = p_project limit 1))
                 order by f.created_at desc)
               from public.files f left join public.app_users u on u.id = f.uploaded_by_user_id
              where f.project_id = p_project and f.is_latest), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'body', m.body, 'sent_at', m.sent_at,
                 'mine', m.from_contact_id = my_contact, 'system', m.from_contact_id is null,
                 'who', coalesce((select coalesce(c.person_name, c.name) from public.contacts c where c.id = m.from_contact_id), m.sender, 'Green Bergen'),
                 'read_at', m.read_at, 'file_id', m.file_id,
                 'file', case when m.file_id is null then null else (select jsonb_build_object('path', f.path, 'kind', f.kind, 'mime', f.mime_type) from public.files f where f.id = m.file_id) end)
                 order by m.sent_at)
               from public.messages m where m.project_id = p_project and m.channel = 'in app'), '[]'::jsonb),
    'unread', (select count(*) from public.messages m where m.project_id = p_project and m.to_contact_id = my_contact and m.read_at is null),
    'open_tasks', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'action', a.action, 'status', a.status,
                 'kind', case when a.source like 'system:transaction:%' then 'payment_confirmation'
                              when a.created_by = 'system:photo-request' then 'photos'
                              when a.created_by = 'system:package-blueprint' then 'milestone' else 'other' end,
                 'pending_reason', a.pending_reason, 'created_at', a.created_at) order by a.created_at)
               from public.actions a where a.project_id = p_project
                and a.status in ('Not Started','In Progress','Parked','Pending on Others','Completed Pending Approval','Completed Pending')), '[]'::jsonb)
  );
end $$;
comment on function public.homeowner_booking(uuid) is 'One job as the app draws it: the booking, its package (homeowner_package), scope, progress, contractor, files, messages and the photo request. Members only - non-members get null, not an error.';

commit;
