-- ============================================================================
-- Homeowner app, part 3 of 3: THE FUNCTION SURFACE.
--
-- Every function is SECURITY DEFINER with a pinned search_path, revoked from
-- PUBLIC and anon, then granted back deliberately (rulebook 71). Three are
-- anon on purpose - the catalogue, a shared job card, an inviter preview -
-- all read-only and leaking only what is public by design.
-- ============================================================================
begin;

-- ---------------------------------------------------------------- catalogue
create or replace function public.homeowner_catalogue()
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
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
               from public.blueprint_package_milestones m where m.package_code = p.code), '[]'::jsonb)
  ) order by p.sort_order, p.name), '[]'::jsonb)
  from public.blueprint_packages p
  where p.is_active;
$$;
comment on function public.homeowner_catalogue() is 'The package catalogue as the homeowner app draws it, nested (items, levers with options, photos, milestones). anon may call it: the grid is browsable before joining. Read-only; templates only.';

-- ---------------------------------------------------------------- referral preview
create or replace function public.homeowner_ref_preview(p_ref uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare u public.app_users; v_line text; v_first text;
begin
  select * into u from public.app_users where id = p_ref and is_active;
  if u.id is null then return jsonb_build_object('ok', false); end if;
  v_first := split_part(coalesce(nullif(btrim(u.full_name), ''), 'A neighbor'), ' ', 1);
  select v_first || '''s ' || lower(bp.tile_title) || ' was done through the community in ' ||
         to_char(coalesce(b.done_at, b.accepted_at), 'Month') || '.'
    into v_line
    from public.project_bookings b
    join public.blueprint_packages bp on bp.code = b.package_code
    join public.projects p on p.id = b.home_project_id
   where p.owner_user_id = u.id and b.state in ('accepted','done')
   order by coalesce(b.done_at, b.accepted_at) desc limit 1;
  return jsonb_build_object('ok', true, 'first', v_first,
    'name', coalesce(nullif(btrim(u.full_name), ''), 'A neighbor'),
    'line', coalesce(btrim(regexp_replace(v_line, '\s+', ' ', 'g')), v_first || ' is already in the community.'));
end $$;
comment on function public.homeowner_ref_preview(uuid) is 'Who invited you, for the invited landing: first name and one line about their last job. anon. p_ref is the inviter''s app_users id, carried silently in the share link.';

-- ---------------------------------------------------------------- register
create or replace function public.homeowner_register(p_full_name text, p_zip text, p_town text, p_ref uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.current_app_user_id();
  v_contact uuid; v_ref_contact uuid; v_ref_name text;
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.'); end if;

  update public.app_users
     set full_name = coalesce(nullif(btrim(p_full_name), ''), full_name),
         home_zip  = coalesce(nullif(btrim(p_zip), ''), home_zip),
         home_town = coalesce(nullif(btrim(p_town), ''), home_town),
         last_modified_at = now()
   where id = me;

  v_contact := public.link_contact_for_user(me, 'Other');
  if v_contact is not null then
    update public.contacts set name = coalesce(nullif(btrim(p_full_name), ''), name),
                                person_name = coalesce(nullif(btrim(p_full_name), ''), person_name),
                                last_modified_at = now(), last_modified_by = 'homeowner-app:register'
     where id = v_contact and (name is null or name = split_part(coalesce(email_a,''), '@', 1));
  end if;

  if p_ref is not null and p_ref <> me and v_contact is not null then
    select u.contact_id, coalesce(u.full_name, u.email) into v_ref_contact, v_ref_name
      from public.app_users u where u.id = p_ref and u.is_active;
    if v_ref_contact is not null and v_ref_contact <> v_contact then
      update public.contacts c
         set referred_by_contact_id = coalesce(c.referred_by_contact_id, v_ref_contact),
             referral = coalesce(c.referral, v_ref_name),
             last_modified_at = now(), last_modified_by = 'homeowner-app:register'
       where c.id = v_contact;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'app_user_id', me, 'contact_id', v_contact);
end $$;
comment on function public.homeowner_register(text, text, text, uuid) is 'Completes the three-field registration after the email code: name, ZIP (town derived by the app) and the silent referral (contacts.referred_by_contact_id). Idempotent.';

-- ---------------------------------------------------------------- progress (derived)
create or replace function public.homeowner_progress(p_project uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  b public.project_bookings; pr public.projects;
  m record; s public.payment_stages; a public.actions;
  nodes jsonb := '[]'::jsonb; st text; at_ts timestamptz; extra jsonb;
  current_found boolean := false; done_count int := 0; total int := 0;
begin
  select * into b from public.project_bookings where project_id = p_project;
  if b.id is null then return null; end if;
  select * into pr from public.projects where id = p_project;

  for m in select * from public.blueprint_package_milestones where package_code = b.package_code order by sequence_no loop
    total := total + 1; st := 'upcoming'; at_ts := null; extra := '{}'::jsonb;
    if m.kind = 'booked' then
      if b.posted_at is not null then st := 'done'; at_ts := b.posted_at; end if;
    elsif m.kind = 'accepted' then
      if b.accepted_at is not null then st := 'done'; at_ts := b.accepted_at; end if;
    elsif m.kind = 'payment' then
      select * into s from public.payment_stages where project_id = p_project and name = m.name order by created_at limit 1;
      if s.id is not null then
        extra := jsonb_build_object('stage_id', s.id, 'amount_cents', (coalesce(s.amount,0)*100)::bigint,
                                    'stage_status', s.status, 'settlement_status', s.settlement_status, 'paid_at', s.paid_at,
                                    'settled', (s.status = 'Paid' or s.settlement_status = 'paid'));
        if s.status = 'Paid' or s.settlement_status = 'paid' then st := 'done'; at_ts := coalesce(s.paid_at, s.last_modified_at);
        elsif s.status = 'Approved' then st := 'done'; at_ts := s.approved_at; extra := extra || jsonb_build_object('unsettled', true);
        end if;
      end if;
    elsif m.kind = 'task' then
      select * into a from public.actions where project_id = p_project and action = m.name and created_by = 'system:package-blueprint' order by created_at limit 1;
      if a.id is not null then
        extra := jsonb_build_object('action_id', a.id, 'action_status', a.status);
        if a.status in ('Completed','Completed Pending Approval') then st := 'done'; at_ts := coalesce(a.completed_on::timestamptz, a.last_updated); end if;
      end if;
    elsif m.kind = 'done' then
      if pr.status like 'Closed%' then st := 'done'; at_ts := b.done_at; end if;
    end if;
    if st = 'upcoming' and not current_found and b.state not in ('closed', 'planned') then st := 'current'; current_found := true; end if;
    if st = 'done' then done_count := done_count + 1; end if;
    nodes := nodes || (jsonb_build_object('key', m.key, 'kind', m.kind, 'name', m.name, 'sequence_no', m.sequence_no,
               'percent_of_contract', m.percent_of_contract, 'typical_range', m.typical_range,
               'trigger_description', m.trigger_description, 'status', st, 'at', at_ts) || extra);
  end loop;
  return jsonb_build_object('nodes', nodes, 'done_count', done_count, 'total', total,
    'current', (select n from jsonb_array_elements(nodes) n where n->>'status' = 'current' limit 1));
end $$;
comment on function public.homeowner_progress(uuid) is 'The progress line of a booking, DERIVED (rulebook 34): booked from posted_at, accepted from the contract, payment nodes from payment_stages, task nodes from actions, done from the project status. Never a stored stage.';

-- ---------------------------------------------------------------- me
create or replace function public.homeowner_me()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.current_app_user_id(); u public.app_users; v_home public.projects;
begin
  if me is null then return jsonb_build_object('signed_in', false); end if;
  select * into u from public.app_users where id = me;
  select * into v_home from public.projects p
   where p.owner_user_id = me and p.parent_project_id is null and coalesce(p.is_template,false) = false
     and p.trashed_at is null and p.address is not null
   order by p.created_at limit 1;

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
      where h.owner_user_id = me and h.parent_project_id is null and coalesce(h.is_template,false) = false and h.trashed_at is null and h.address is not null), '[]'::jsonb),
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

-- ---------------------------------------------------------------- book / plan
-- Two halves. homeowner_book() makes the HOME (if needed), the JOB project,
-- the scope and the project_bookings row - as a plan (nothing sent) or as an
-- order. homeowner_post_internal() is the ORDER half: stages, tasks, billing
-- plan, the offer to contractors, the clock. A plan reaches it later through
-- homeowner_booking_action('post'). Not granted to anyone: internal.
create or replace function public.homeowner_price(p_code text, p_selections jsonb, out price_cents integer, out config_label text, out reason text)
language plpgsql stable security definer set search_path = public as $$
declare pkg public.blueprint_packages; lv record; opt record; v_sel text; v_cfg text[] := '{}';
begin
  select * into pkg from public.blueprint_packages where code = p_code and is_active;
  if pkg.code is null or pkg.availability <> 'priced' or pkg.base_price_cents is null then
    reason := 'That package cannot be booked yet.'; return;
  end if;
  price_cents := pkg.base_price_cents;
  for lv in select * from public.blueprint_package_levers where package_code = pkg.code order by sort_order loop
    v_sel := coalesce(p_selections->>lv.key, (select o.key from public.blueprint_package_lever_options o where o.lever_id = lv.id and o.is_default limit 1));
    select * into opt from public.blueprint_package_lever_options o where o.lever_id = lv.id and o.key = v_sel;
    if opt.id is null then reason := 'Unknown choice for ' || lv.label || '.'; return; end if;
    price_cents := price_cents + opt.price_delta_cents;
    if not opt.is_default then v_cfg := v_cfg || opt.label::text; end if;
  end loop;
  config_label := coalesce(nullif(array_to_string(v_cfg, ' · '), ''), pkg.config_label);
end $$;
comment on function public.homeowner_price(text, jsonb) is 'The community price of a package with the chosen levers, computed on the server from blueprint_packages - the browser only ever proposes selections, never a number.';

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
comment on function public.homeowner_post_internal(uuid) is 'The ORDER half of a booking, shared by homeowner_book and homeowner_booking_action(post): re-prices from the live catalogue, writes payment stages and milestone tasks, mirrors the billing plan, opens the bid package with one invited bid per contractor with a login and the trade, and starts the 24-hour clock. Internal - no grant.';

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
     where p.id = p_home_project_id and p.owner_user_id = me and p.parent_project_id is null and p.trashed_at is null;
    if v_home.id is null then return jsonb_build_object('ok', false, 'reason', 'That home is not one of yours.'); end if;
    v_addr := coalesce(v_addr, v_home.address);
  else
    if v_addr is null then return jsonb_build_object('ok', false, 'reason', 'We need the address for the price and the permit.'); end if;
    select * into v_home from public.projects p
     where p.owner_user_id = me and p.parent_project_id is null and coalesce(p.is_template,false) = false
       and p.trashed_at is null and p.address is not null and lower(p.address) = lower(v_addr)
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

create or replace function public.homeowner_plan_update(p_project uuid, p_target_window text, p_note text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare b public.project_bookings; pr public.projects;
begin
  perform public.assert_own_hands();
  select * into b from public.project_bookings where project_id = p_project for update;
  if b.id is null then return jsonb_build_object('ok', false, 'reason', 'No such plan.'); end if;
  select * into pr from public.projects where id = p_project;
  if pr.owner_user_id <> public.current_app_user_id() and not public.is_superadmin() then
    return jsonb_build_object('ok', false, 'reason', 'Only the homeowner can do that.');
  end if;
  if b.state <> 'planned' then return jsonb_build_object('ok', false, 'reason', 'This job is already ordered.'); end if;
  update public.project_bookings set target_window = coalesce(nullif(p_target_window, ''), target_window), note = coalesce(nullif(btrim(p_note), ''), note) where id = b.id;
  return jsonb_build_object('ok', true);
end $$;
comment on function public.homeowner_plan_update(uuid, text, text) is 'Changes when a PLANNED job is meant for (target_window) and the owner''s note. Ordered jobs are not touched here.';

create or replace function public.homeowner_home_add(p_address text, p_name text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_addr text := nullif(btrim(p_address), '');
begin
  if v_addr is null then return jsonb_build_object('ok', false, 'reason', 'We need the address.'); end if;
  if exists (select 1 from public.projects p where p.owner_user_id = public.current_app_user_id() and p.parent_project_id is null
              and p.trashed_at is null and lower(p.address) = lower(v_addr)) then
    return jsonb_build_object('ok', false, 'reason', 'That home is already on your account.');
  end if;
  return public.create_home_asset(coalesce(nullif(btrim(p_name), ''), split_part(v_addr, ',', 1)), v_addr,
                                  nullif(btrim(split_part(v_addr, ',', 2)), ''), 'Added through the homeowner app.');
end $$;
comment on function public.homeowner_home_add(text, text) is 'Claims another home without ordering anything: create_home_asset under the customer agreement''s quota, with a duplicate-address guard. The old portal''s "claim your address", kept.';

-- ---------------------------------------------------------------- booking detail
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
    'package', (select x from jsonb_array_elements(public.homeowner_catalogue()) x where x->>'code' = b.package_code),
    'address', pr.address, 'unit', b.unit, 'project_status', pr.status,
    'price_cents', b.price_cents, 'base_price_cents', b.base_price_cents, 'selections', b.selections, 'config_label', b.config_label,
    'facts', case when v_is_owner then b.facts end, 'budget_band', case when v_is_owner then b.budget_band end, 'note', b.note,
    'state', b.state, 'created_at', b.created_at, 'posted_at', b.posted_at, 'target_window', b.target_window, 'reply_by', b.reply_by, 'repost_count', b.repost_count, 'offered_count', b.offered_count,
    'live_price_cents', case when b.state = 'planned' then (select price_cents from public.homeowner_price(b.package_code, b.selections)) end,
    'accepted_at', b.accepted_at, 'closed_at', b.closed_at, 'close_reason', b.close_reason, 'done_at', b.done_at,
    'no_taker', (b.state = 'posted' and b.reply_by is not null and b.reply_by < now()),
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
                              when a.created_by = 'system:package-blueprint' then 'milestone' else 'other' end,
                 'pending_reason', a.pending_reason, 'created_at', a.created_at) order by a.created_at)
               from public.actions a where a.project_id = p_project
                and a.status in ('Not Started','In Progress','Parked','Pending on Others','Completed Pending Approval','Completed Pending')), '[]'::jsonb)
  );
end $$;
comment on function public.homeowner_booking(uuid) is 'Everything the project view, folder and timeline need for one booking, in one call. budget_band and facts are returned only to the owner.';

-- ---------------------------------------------------------------- matching actions
create or replace function public.homeowner_booking_action(p_project uuid, p_action text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare b public.project_bookings; pr public.projects; v_new integer; v_pkg uuid; pk public.bid_packages; v_reply timestamptz;
begin
  perform public.assert_own_hands();
  select * into b from public.project_bookings where project_id = p_project for update;
  if b.id is null then return jsonb_build_object('ok', false, 'reason', 'No such booking.'); end if;
  select * into pr from public.projects where id = p_project;
  if pr.owner_user_id <> public.current_app_user_id() and not public.is_superadmin() then
    return jsonb_build_object('ok', false, 'reason', 'Only the homeowner can do that.');
  end if;
  if b.state = 'accepted' or b.state = 'done' then
    return jsonb_build_object('ok', false, 'reason', 'A contractor already has this job.');
  end if;

  -- A plan can be posted (it becomes an order at today's price) or removed.
  if p_action = 'post' then
    if b.state <> 'planned' then return jsonb_build_object('ok', false, 'reason', 'This job is already posted.'); end if;
    return public.homeowner_post_internal(p_project);
  elsif p_action = 'remove' then
    if b.state <> 'planned' then return jsonb_build_object('ok', false, 'reason', 'Only a plan can be removed; a posted job is closed instead.'); end if;
    update public.projects set trashed_at = now(), notes = coalesce(notes, '') || E'\n\nPlan removed by the owner on ' || to_char(now(), 'YYYY-MM-DD') || '.' where id = p_project;
    return jsonb_build_object('ok', true);
  elsif b.state = 'planned' then
    return jsonb_build_object('ok', false, 'reason', 'This job is only planned - post it first.');
  end if;

  if p_action in ('bump', 'reopen') then
    v_new := (ceil((b.price_cents * 1.09) / 1000.0) * 1000)::integer;
    v_reply := now() + interval '24 hours';
    select * into pk from public.bid_packages where id = b.bid_package_id;
    update public.bid_packages set status = 'closed', last_modified_at = now(), last_modified_by = 'homeowner-app:repost' where id = b.bid_package_id;
    update public.bids set status = 'expired', last_modified_at = now(), last_modified_by = 'homeowner-app:repost'
     where package_id = b.bid_package_id and status in ('invited','received');
    insert into public.bid_packages (project_id, trade, category, scope_summary, budget_amount, budget_visible, deposit_pct, reply_by, status, supersedes_id, created_by)
    values (pr.id, pk.trade, pk.category, pk.scope_summary, round(v_new/100.0, 2), true, pk.deposit_pct, v_reply::date, 'open', pk.id, 'homeowner-app:repost')
    returning id into v_pkg;
    insert into public.bids (project_id, package_id, trade, package, scope_summary, bidder_contact_id, bidder_company_id, amount, amount_basis, status, round, created_by)
    select pr.id, v_pkg, x.trade, x.package, x.scope_summary, x.bidder_contact_id, x.bidder_company_id, round(v_new/100.0, 2), 'community price - reposted', 'invited', coalesce(x.round,1) + 1, 'homeowner-app:repost'
      from public.bids x where x.package_id = b.bid_package_id;
    update public.project_bookings set price_cents = v_new, reply_by = v_reply, repost_count = repost_count + 1, state = 'posted',
           closed_at = null, close_reason = null, bid_package_id = v_pkg where id = b.id;
    update public.payment_stages set amount = round(v_new * percent_of_contract / 10000.0, 2) where project_id = pr.id and percent_of_contract is not null and status = 'Planned';
    return jsonb_build_object('ok', true, 'price_cents', v_new, 'reply_by', v_reply);
  elsif p_action = 'wait' then
    v_reply := now() + interval '48 hours';
    update public.project_bookings set reply_by = v_reply where id = b.id;
    update public.bid_packages set reply_by = v_reply::date where id = b.bid_package_id;
    return jsonb_build_object('ok', true, 'reply_by', v_reply);
  elsif p_action = 'close' then
    update public.bid_packages set status = 'closed', last_modified_at = now(), last_modified_by = 'homeowner-app:close' where id = b.bid_package_id;
    update public.bids set status = 'expired', last_modified_at = now(), last_modified_by = 'homeowner-app:close'
     where package_id = b.bid_package_id and status in ('invited','received');
    update public.project_bookings set state = 'closed', closed_at = now(), close_reason = 'Closed by the homeowner' where id = b.id;
    return jsonb_build_object('ok', true);
  end if;
  return jsonb_build_object('ok', false, 'reason', 'Unknown action.');
end $$;
comment on function public.homeowner_booking_action(uuid, text) is 'post (a plan becomes an order at today''s price), remove (a plan is trashed, never deleted). The no-taker moment: bump (repost at +9 %, rounded up to $10, a new bid package superseding the old, same bidders, fresh 24 h), wait (+48 h), close (graceful; nothing charged, nothing shared). reopen = bump.';

-- ---------------------------------------------------------------- contractor side
create or replace function public.homeowner_offers()
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'project_id', b.project_id, 'bid_id', bd.id, 'package', bp.name, 'trade', bp.trade, 'price_cents', b.price_cents,
    'config_label', b.config_label, 'town', btrim(split_part(p.address, ',', 2)), 'posted_at', b.posted_at, 'reply_by', b.reply_by,
    'scope', (select jsonb_agg(si.item order by si.created_at) from public.project_scope_items si where si.project_id = b.project_id),
    'photos', (select count(*) from public.files f where f.project_id = b.project_id and f.kind = 'photo'),
    'status', bd.status) order by b.posted_at desc), '[]'::jsonb)
  from public.bids bd
  join public.project_bookings b on b.bid_package_id = bd.package_id
  join public.blueprint_packages bp on bp.code = b.package_code
  join public.projects p on p.id = b.project_id
  where bd.bidder_contact_id = public.my_contact_id()
    and bd.status in ('invited','received')
    and b.state = 'posted';
$$;
comment on function public.homeowner_offers() is 'Open package offers for the signed-in contractor: scope, price, town, photo count - no name, no address until they accept. Feeds the (future) contractor app.';

create or replace function public.homeowner_offer_accept(p_project uuid, p_contact uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b public.project_bookings; pr public.projects; pkg public.blueprint_packages; bd public.bids;
  v_contact uuid; v_owner_contact uuid; v_contract uuid; v_login uuid; v_name text; v_company uuid; v_scope text;
begin
  perform public.assert_own_hands();
  v_contact := case when public.is_superadmin() and p_contact is not null then p_contact else public.my_contact_id() end;
  if v_contact is null then return jsonb_build_object('ok', false, 'reason', 'Your account has no contact record.'); end if;

  select * into b from public.project_bookings where project_id = p_project for update;
  if b.id is null then return jsonb_build_object('ok', false, 'reason', 'No such job.'); end if;
  if b.state <> 'posted' then return jsonb_build_object('ok', false, 'code', 'TAKEN', 'reason', 'This job is no longer open.'); end if;
  select * into bd from public.bids where package_id = b.bid_package_id and bidder_contact_id = v_contact and status in ('invited','received') limit 1;
  if bd.id is null and not public.is_superadmin() then
    return jsonb_build_object('ok', false, 'reason', 'This job was not offered to you.');
  end if;
  select * into pr from public.projects where id = p_project;
  select * into pkg from public.blueprint_packages where code = b.package_code;
  select u.contact_id into v_owner_contact from public.app_users u where u.id = pr.owner_user_id;
  if v_owner_contact is null then
    return jsonb_build_object('ok', false, 'reason', 'The homeowner has no contact record yet - ask an administrator.');
  end if;
  select c.company_id, coalesce(c.person_name, c.name) into v_company, v_name from public.contacts c where c.id = v_contact;
  select u.id into v_login from public.app_users u where u.contact_id = v_contact and u.is_active limit 1;
  select string_agg(si.item, '; ' order by si.created_at) into v_scope from public.project_scope_items si where si.project_id = p_project;

  insert into public.contracts (title, contract_type, status, direction, project_id, trade, amount, currency, contractor_id,
                                counterparty_contact_id, signer_contact_id, awarded_date, deposit_pct, retainage_pct,
                                consumables_by, finish_material_by, scope, bid_package_id, created_by, notes)
  values (pkg.name || ' - ' || coalesce(pr.address, ''), 'construction trade contract', 'awarded', 'payable', p_project, pkg.trade,
          round(b.price_cents/100.0, 2), 'USD', v_contact, v_contact, v_owner_contact, current_date, pkg.permit_deposit_pct, 0,
          'subcontractor', 'subcontractor', v_scope, b.bid_package_id, 'homeowner-app:accept',
          'Community package accepted at the stated price through the homeowner app. No counter-offer; the price is the package price. Paid directly by the homeowner to the contractor.')
  returning id into v_contract;

  update public.payment_stages set contract_id = v_contract where project_id = p_project and contract_id is null;

  insert into public.project_members (project_id, app_user_id, contact_id, role, project_role, contract_id, status, accepted_at, invited_by_user_id, notes)
  values (p_project, v_login, case when v_login is null then v_contact else null end, 'collaborator', 'contractor', v_contract, 'active', now(), pr.owner_user_id,
          'Seated by accepting the package offer.')
  on conflict do nothing;
  -- A person carries contact_id, app_user_id or both; keep the contact on the seat too.
  update public.project_members set contact_id = v_contact where project_id = p_project and contract_id = v_contract and app_user_id = v_login and contact_id is null;

  if bd.id is not null then
    update public.bids set status = 'awarded', won = true, received_on = current_date, last_modified_at = now(), last_modified_by = 'homeowner-app:accept' where id = bd.id;
  end if;
  update public.bids set status = 'not awarded', won = false, not_awarded_reason = 'Another contractor accepted first', last_modified_at = now(), last_modified_by = 'homeowner-app:accept'
   where package_id = b.bid_package_id and id is distinct from bd.id and status in ('invited','received');
  update public.bid_packages set status = 'awarded', awarded_bid_id = bd.id, contract_id = v_contract, last_modified_at = now(), last_modified_by = 'homeowner-app:accept'
   where id = b.bid_package_id;

  update public.project_bookings set state = 'accepted', accepted_at = now(), contractor_contact_id = v_contact, contract_id = v_contract where id = b.id;

  insert into public.messages (body, direction, channel, status, sent_at, project_id, from_contact_id, to_contact_id, contractor_id, created_by)
  values (coalesce(v_name, 'Your contractor') || ' accepted the job at $' || round(b.price_cents/100.0) || '. You now have each other''s contact details - say hi here whenever you like.',
          'inbound', 'in app', 'new', now(), p_project, v_contact, v_owner_contact, v_contact, 'system:package-accept');

  return jsonb_build_object('ok', true, 'contract_id', v_contract, 'contractor', v_name);
end $$;
comment on function public.homeowner_offer_accept(uuid, uuid) is 'A contractor takes a posted job at the stated price: first accept wins (row locked). Writes the awarded contract, binds the payment stages, seats the contractor (bounded by the contract), settles the other bids and tells the homeowner on the timeline. A superadmin may accept on a named contact''s behalf (demo / phone acceptance).';

create or replace function public.homeowner_offer_decline(p_project uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare b public.project_bookings;
begin
  perform public.assert_own_hands();
  select * into b from public.project_bookings where project_id = p_project;
  if b.id is null then return jsonb_build_object('ok', false, 'reason', 'No such job.'); end if;
  update public.bids set status = 'declined', last_modified_at = now(), last_modified_by = 'homeowner-app:decline'
   where package_id = b.bid_package_id and bidder_contact_id = public.my_contact_id() and status in ('invited','received');
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------- timeline
create or replace function public.homeowner_message_send(p_project uuid, p_body text, p_file_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare b public.project_bookings; pr public.projects; me_c uuid := public.my_contact_id(); v_to uuid; v_owner_contact uuid; v_id uuid;
begin
  perform public.assert_own_hands();
  if me_c is null then return jsonb_build_object('ok', false, 'reason', 'Your account has no contact record yet.'); end if;
  if coalesce(btrim(p_body), '') = '' and p_file_id is null then return jsonb_build_object('ok', false, 'reason', 'Write something, or attach a photo.'); end if;
  if not public.is_project_member(p_project) then return jsonb_build_object('ok', false, 'reason', 'You are not on this job.'); end if;
  select * into b from public.project_bookings where project_id = p_project;
  select * into pr from public.projects where id = p_project;
  select u.contact_id into v_owner_contact from public.app_users u where u.id = pr.owner_user_id;
  v_to := case when me_c = v_owner_contact then b.contractor_contact_id else v_owner_contact end;
  if v_to is null then return jsonb_build_object('ok', false, 'code', 'NO_COUNTERPART', 'reason', 'There is nobody on the other side yet - the timeline opens once a contractor accepts.'); end if;
  if p_file_id is not null and not public.can_see_file(p_file_id) then return jsonb_build_object('ok', false, 'reason', 'That file is not yours.'); end if;

  insert into public.messages (body, direction, channel, status, sent_at, project_id, from_contact_id, to_contact_id, file_id, created_by)
  values (coalesce(nullif(btrim(p_body), ''), case when p_file_id is not null then '(photo)' end), 'inbound', 'in app', 'new', now(), p_project, me_c, v_to, p_file_id, 'homeowner-app')
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
comment on function public.homeowner_message_send(uuid, text, uuid) is 'One timeline message from the signed-in party to the other party on the job, with at most one attachment already recorded in files. Permanent: the timeline is the record.';

create or replace function public.homeowner_messages_seen(p_project uuid)
returns void
language sql security definer set search_path = public as $$
  update public.messages set read_at = now(), status = case when status = 'new' then 'read' else status end
   where project_id = p_project and to_contact_id = public.my_contact_id() and read_at is null and public.is_project_member(p_project);
$$;

-- ---------------------------------------------------------------- milestones
create or replace function public.homeowner_milestone_mark(p_project uuid, p_key text, p_how text, p_reference text, p_file_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.current_app_user_id(); b public.project_bookings; pr public.projects; m public.blueprint_package_milestones;
  s public.payment_stages; a public.actions; v_method uuid; v_open int; v_unpaid int;
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.'); end if;
  select * into b from public.project_bookings where project_id = p_project;
  if b.id is null then return jsonb_build_object('ok', false, 'reason', 'No such job.'); end if;
  select * into pr from public.projects where id = p_project;
  if not public.is_project_member(p_project) then return jsonb_build_object('ok', false, 'reason', 'You are not on this job.'); end if;
  select * into m from public.blueprint_package_milestones where package_code = b.package_code and key = p_key;
  if m.id is null then return jsonb_build_object('ok', false, 'reason', 'No such milestone.'); end if;

  if m.kind = 'task' then
    select * into a from public.actions where project_id = p_project and action = m.name and created_by = 'system:package-blueprint' order by created_at limit 1;
    if a.id is null then return jsonb_build_object('ok', false, 'reason', 'This milestone has no task behind it.'); end if;
    if a.status not in ('Completed','Completed Pending Approval') then
      perform public.close_action(a.id, false, 'portal:homeowner-app', 'Completed', true);
    end if;
    return jsonb_build_object('ok', true, 'kind', 'task');

  elsif m.kind = 'payment' then
    if pr.owner_user_id <> me and not public.is_superadmin() then
      return jsonb_build_object('ok', false, 'reason', 'Only the homeowner confirms a payment milestone.');
    end if;
    select * into s from public.payment_stages where project_id = p_project and name = m.name order by created_at limit 1;
    if s.id is null then return jsonb_build_object('ok', false, 'reason', 'This milestone has no payment stage behind it.'); end if;
    if b.state = 'posted' then return jsonb_build_object('ok', false, 'reason', 'Wait for a contractor to accept first.'); end if;

    if s.status in ('Planned','Ready','Requested') then
      update public.payment_stages set status = 'Approved', approved_by_user_id = me, approved_at = now() where id = s.id;
    end if;
    if p_file_id is not null then
      if not public.can_see_file(p_file_id) then return jsonb_build_object('ok', false, 'reason', 'That file is not yours.'); end if;
      insert into public.file_links (file_id, payment_stage_id, role, created_by_user_id) values (p_file_id, s.id, 'evidence', me);
    end if;

    if p_how in ('check','cash','zelle','venmo') then
      select id into v_method from public.payment_methods
       where is_active and lower(name) = case p_how when 'check' then 'check' when 'cash' then 'cash' when 'zelle' then 'zelle' else 'venmo' end limit 1;
      begin
        perform public.record_manual_payment(s.id, v_method, nullif(btrim(p_reference), ''), null, current_date, true, null,
                  'Recorded by the homeowner in the homeowner app' || case when p_file_id is not null then ' with a photo of the ' || p_how else '' end || '.');
      exception when others then
        return jsonb_build_object('ok', false, 'code', 'PAYMENT_NOT_RECORDED', 'reason', sqlerrm, 'milestone_logged', true);
      end;
      return jsonb_build_object('ok', true, 'kind', 'payment', 'paid', true);
    elsif p_how = 'card' then
      return jsonb_build_object('ok', true, 'kind', 'payment', 'paid', false, 'code', 'CARD_NOT_AVAILABLE',
        'reason', 'Card payments in the app are not switched on yet. The milestone is logged; pay the contractor directly and photograph the check or receipt.');
    else
      return jsonb_build_object('ok', true, 'kind', 'payment', 'paid', false);
    end if;

  elsif m.kind = 'done' then
    if pr.owner_user_id <> me and not public.is_superadmin() then return jsonb_build_object('ok', false, 'reason', 'Only the homeowner closes the job.'); end if;
    select count(*) into v_open from public.actions x where x.project_id = p_project
       and x.status in ('Not Started','In Progress','Parked','Pending on Others','Completed Pending Approval','Completed Pending');
    if v_open > 0 then
      return jsonb_build_object('ok', false, 'code', 'OPEN_TASKS',
        'reason', 'Something is still open on this job - a step on the line, or a payment the contractor has not confirmed yet. Close those first.',
        'open', (select jsonb_agg(jsonb_build_object('id', x.id, 'action', x.action)) from public.actions x where x.project_id = p_project
                   and x.status in ('Not Started','In Progress','Parked','Pending on Others','Completed Pending Approval','Completed Pending')));
    end if;
    select count(*) into v_unpaid from public.payment_stages x where x.project_id = p_project and x.status not in ('Paid','Cancelled') and x.settlement_status <> 'paid';
    if v_unpaid > 0 then return jsonb_build_object('ok', false, 'code', 'UNPAID', 'reason', 'A payment to the contractor is still recorded as unsettled. Record it, then close.'); end if;
    update public.projects set status = 'Closed - Completed', last_modified_by = 'homeowner-app' where id = p_project;
    update public.project_bookings set state = 'done', done_at = now() where id = b.id;
    return jsonb_build_object('ok', true, 'kind', 'done');
  end if;
  return jsonb_build_object('ok', false, 'reason', 'That milestone marks itself.');
end $$;
comment on function public.homeowner_milestone_mark(uuid, text, text, text, uuid) is 'The homeowner (or contractor, for task steps) marks a milestone. task -> close_action; payment -> stage Approved, then record_manual_payment for check / cash / Zelle / Venmo (card is not wired and says so), evidence photo linked to the stage; done -> project Closed - Completed once every step is closed and every payment settled.';

-- ---------------------------------------------------------------- closing a task on the job
create or replace function public.homeowner_task_close(p_project uuid, p_action_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.actions;
begin
  perform public.assert_own_hands();
  if not public.is_project_member(p_project) then return jsonb_build_object('ok', false, 'reason', 'You are not on this job.'); end if;
  select * into a from public.actions where id = p_action_id and project_id = p_project;
  if a.id is null then return jsonb_build_object('ok', false, 'reason', 'No such task on this job.'); end if;
  if a.status in ('Completed','Cancelled','Force Cancelled') then return jsonb_build_object('ok', true, 'already', true); end if;
  perform public.close_action(a.id, false, 'portal:homeowner-app', 'Completed', true);
  return jsonb_build_object('ok', true);
end $$;
comment on function public.homeowner_task_close(uuid, uuid) is 'A member of the job closes one of its open tasks through close_action - typically the payment-confirmation task fn_transactions_notify_task raises after a payment (closing it files the receipt), or a milestone task. Never a direct status UPDATE.';

-- ---------------------------------------------------------------- share
create or replace function public.homeowner_share_publish(p_project uuid, p_quote text, p_hide_address boolean, p_after_file_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare b public.project_bookings; pr public.projects; v_slug text;
begin
  perform public.assert_own_hands();
  select * into b from public.project_bookings where project_id = p_project;
  select * into pr from public.projects where id = p_project;
  if b.id is null or (pr.owner_user_id <> public.current_app_user_id() and not public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'reason', 'Only the homeowner shares a job.');
  end if;
  if b.state not in ('accepted','done') then return jsonb_build_object('ok', false, 'reason', 'Share it once the work is done.'); end if;
  v_slug := coalesce(b.share_slug, lower(substr(md5(gen_random_uuid()::text), 1, 8)));
  update public.project_bookings
     set share_slug = v_slug, shared_at = coalesce(shared_at, now()), share_quote = nullif(btrim(p_quote), ''),
         share_hide_address = coalesce(p_hide_address, true), share_after_file_id = p_after_file_id
   where id = b.id;
  return jsonb_build_object('ok', true, 'slug', v_slug);
end $$;

create or replace function public.homeowner_share(p_slug text)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'slug', b.share_slug, 'package', bp.name, 'tile_title', bp.tile_title, 'illustration', bp.illustration,
    'town', btrim(regexp_replace(split_part(p.address, ',', 2), '\s+NJ.*$', '')),
    'address', case when b.share_hide_address then null else p.address end,
    'quote', b.share_quote, 'posted_at', b.posted_at, 'accepted_at', b.accepted_at, 'done_at', b.done_at, 'price_cents', b.price_cents,
    'shared_by', (select u.full_name from public.app_users u where u.id = p.owner_user_id),
    'ref', p.owner_user_id,
    'contractor', (select jsonb_build_object('name', coalesce(co.company_name, c.person_name, c.name),
                     'jobs', (select count(*) from public.project_bookings x where x.contractor_contact_id = c.id and x.state in ('accepted','done')),
                     'rating', case when co.id is null then null else public.contractor_rating(co.id) end)
                     from public.contacts c left join public.companies co on co.id = c.company_id where c.id = b.contractor_contact_id))
  from public.project_bookings b
  join public.blueprint_packages bp on bp.code = b.package_code
  join public.projects p on p.id = b.project_id
  where b.share_slug = p_slug and b.shared_at is not null;
$$;
comment on function public.homeowner_share(text) is 'A shared job card, anon: package, town, dates, community price, the contractor''s name and rating, the owner''s short name and their referral id. No photos (project-media is private), no address unless the owner chose to show it.';

-- ---------------------------------------------------------------- quote track / something else / community service interest
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
  select p.id into v_home from public.projects p
   where p.owner_user_id = me and p.parent_project_id is null and coalesce(p.is_template,false) = false and p.trashed_at is null
   order by p.created_at limit 1;
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

-- ---------------------------------------------------------------- grants (rulebook 71)
do $$
declare f text;
begin
  foreach f in array array[
    'homeowner_catalogue()', 'homeowner_ref_preview(uuid)', 'homeowner_register(text,text,text,uuid)', 'homeowner_progress(uuid)',
    'homeowner_me()', 'homeowner_book(text,jsonb,text,text,jsonb,text,text,uuid,text,text)', 'homeowner_booking(uuid)', 'homeowner_booking_action(uuid,text)',
    'homeowner_price(text,jsonb)', 'homeowner_plan_update(uuid,text,text)', 'homeowner_home_add(text,text)',
    'homeowner_offers()', 'homeowner_offer_accept(uuid,uuid)', 'homeowner_offer_decline(uuid)', 'homeowner_message_send(uuid,text,uuid)',
    'homeowner_messages_seen(uuid)', 'homeowner_milestone_mark(uuid,text,text,text,uuid)', 'homeowner_share_publish(uuid,text,boolean,uuid)', 'homeowner_share(text)',
    'homeowner_quote_request(text,text,text)', 'homeowner_task_close(uuid,uuid)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  -- Internal: the order half runs only inside homeowner_book / homeowner_booking_action.
  revoke all on function public.homeowner_post_internal(uuid) from public, anon, authenticated;
  -- Deliberately anon: read-only, public by design.
  grant execute on function public.homeowner_catalogue() to anon;
  grant execute on function public.homeowner_share(text) to anon;
  grant execute on function public.homeowner_ref_preview(uuid) to anon;
end $$;

commit;
