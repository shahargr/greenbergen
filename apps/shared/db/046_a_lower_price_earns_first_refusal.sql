-- 046 - a lower called price earns first refusal.
--
-- Shahar chose option 2 (2026-09-09): the community price stays what the
-- homeowner pays and what the contract is written for; a contractor who
-- has signed up to a package and called a LOWER price for its basic setup
-- gets the job first. Nobody sees a second number, nobody counter-offers,
-- and the price on the tile is still the price.
--
-- HOW FIRST REFUSAL WORKS:
--   When a job is posted, the eligible contractors (approved, active login,
--   the package's trade, not the owner) are found as before. If any of them
--   holds an active package_contractors row on this package with a price
--   below the community price, the LOWEST such price wins first refusal:
--   only that contractor (or those, on a tie) is invited now. The offer is
--   marked first_refusal_until = now() + config.first_refusal_hours.
--   Everyone else is invited when the window closes - by the scheduled
--   opener every five minutes - or the moment the holder passes, whichever
--   comes first. A holder who accepts in the window takes the job at the
--   community price like anyone else (homeowner_offer_accept unchanged).
--
-- WHY STAGED INVITATIONS AND NOT HIDDEN ROWS: a bids row is what tells a
-- contractor about a job (trg_bids_notify writes the inbox message on
-- insert). Inserting everyone's row and hiding some would mean messages
-- dated in the future and every reader learning to ignore them. Inserting
-- the row when the invitation is real keeps one truth: a row means you
-- were asked. The opener is the one piece of machinery this adds, and it
-- is idempotent - a contractor already invited is never invited twice.

alter table public.config
  add column if not exists first_refusal_hours integer not null default 12
  check (first_refusal_hours between 1 and 168);
comment on column public.config.first_refusal_hours is
  'How long the lowest called price on a package holds a new job before it opens to every contractor in the trade (migration 046).';

alter table public.bid_packages
  add column if not exists first_refusal_until timestamptz,
  add column if not exists first_refusal_opened_at timestamptz;
comment on column public.bid_packages.first_refusal_until is
  'While set and in the future, only the contractor(s) with the lowest called price on the package have been invited. Null = no first refusal on this offer.';
comment on column public.bid_packages.first_refusal_opened_at is
  'When the offer was opened to the rest of the trade after a first-refusal window (by the opener or by the holder passing).';

-- ---------------------------------------------------------------------
-- 1. Inviting is one function, used at posting and at opening.
-- ---------------------------------------------------------------------
create or replace function public.homeowner_invite_eligible(p_project uuid, p_pkgid uuid, p_only uuid[] default null)
returns integer
language plpgsql security definer set search_path to 'public'
as $$
declare
  b public.project_bookings; pr public.projects; pkg public.blueprint_packages; c record; v_n int := 0;
begin
  select * into b from public.project_bookings where project_id = p_project;
  select * into pr from public.projects where id = p_project;
  select * into pkg from public.blueprint_packages where code = b.package_code;
  for c in
    select distinct ct.id as contact_id, ct.company_id
      from public.contacts ct
      join public.app_users u on u.contact_id = ct.id and u.is_active
      join public.contractor_approvals ca on ca.contact_id = ct.id and ca.status = 'approved'
     where ct.id <> coalesce((select contact_id from public.app_users where id = pr.owner_user_id), '00000000-0000-0000-0000-000000000000'::uuid)
       and (p_only is null or ct.id = any(p_only))
       and (exists (select 1 from public.contact_trade_roles r where r.contact_id = ct.id and r.trade = pkg.trade)
         or exists (select 1 from public.company_trade_roles r where r.company_id = ct.company_id and r.trade = pkg.trade))
       -- Never twice: a row means you were asked.
       and not exists (select 1 from public.bids bi where bi.package_id = p_pkgid and bi.bidder_contact_id = ct.id)
  loop
    insert into public.bids (project_id, package_id, trade, package, scope_summary, bidder_contact_id, bidder_company_id,
                             amount, amount_basis, status, round, received_on, created_by)
    values (p_project, p_pkgid, pkg.trade, 'Package', pkg.name, c.contact_id, c.company_id,
            round(b.price_cents/100.0, 2), 'community price - accept or pass', 'invited', 1, null, 'homeowner-app');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.homeowner_invite_eligible(uuid, uuid, uuid[]) from public, anon, authenticated;

-- Who holds first refusal on a package: the active sign-ups whose called
-- price is below the community price, at the lowest such price. Only
-- those who could be invited at all count.
create or replace function public.homeowner_first_refusal_holders(p_project uuid)
returns uuid[]
language sql stable security definer set search_path to 'public'
as $$
  with b as (select * from public.project_bookings where project_id = p_project),
       pkg as (select bp.* from public.blueprint_packages bp, b where bp.code = b.package_code),
       pr as (select * from public.projects where id = p_project),
       eligible as (
         -- pkg and pr first, then the JOIN chain binds to pc (a JOIN after a
         -- comma list binds to the last item - learned the hard way in 034).
         select pc.contact_id, pc.price_cents
           from pkg, pr,
                public.package_contractors pc
                join public.contacts ct on ct.id = pc.contact_id
                join public.app_users u on u.contact_id = ct.id and u.is_active
                join public.contractor_approvals ca on ca.contact_id = ct.id and ca.status = 'approved'
          where pc.package_code = pkg.code and pc.status = 'active'
            and pc.price_cents is not null and pkg.base_price_cents is not null and pc.price_cents < pkg.base_price_cents
            and ct.id <> coalesce((select contact_id from public.app_users where id = pr.owner_user_id), '00000000-0000-0000-0000-000000000000'::uuid)
            and (exists (select 1 from public.contact_trade_roles r where r.contact_id = ct.id and r.trade = pkg.trade)
              or exists (select 1 from public.company_trade_roles r where r.company_id = ct.company_id and r.trade = pkg.trade)))
  select coalesce(array_agg(contact_id), '{}'::uuid[]) from eligible where price_cents = (select min(price_cents) from eligible);
$$;
revoke all on function public.homeowner_first_refusal_holders(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Posting: the holder first, or everyone.
-- ---------------------------------------------------------------------
create or replace function public.homeowner_post_internal(p_project uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  b public.project_bookings; pr public.projects; pkg public.blueprint_packages; me uuid;
  v_price integer; v_cfg text; v_reason text;
  v_pkgid uuid;
  v_scope text; m record; v_n int := 0; v_plan public.project_billing_plan;
  v_holders uuid[]; v_until timestamptz; v_hours int;
begin
  select * into b from public.project_bookings where project_id = p_project for update;
  select * into pr from public.projects where id = p_project;
  select * into pkg from public.blueprint_packages where code = b.package_code;
  me := pr.owner_user_id;

  select price_cents, config_label, reason into v_price, v_cfg, v_reason from public.homeowner_price(b.package_code, b.selections);
  if v_reason is not null then return jsonb_build_object('ok', false, 'reason', v_reason); end if;
  select string_agg(label || coalesce(' - ' || detail, ''), '; ' order by sort_order) into v_scope from public.blueprint_package_items where package_code = pkg.code;

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

  -- The offer. No reply_by: nothing expires.
  insert into public.bid_packages (project_id, trade, category, scope_summary, budget_amount, budget_visible, deposit_pct, reply_by, status, created_by)
  values (p_project, pkg.trade, 'Package', pkg.name || ' - ' || coalesce(v_cfg, '') || E'.\nIncluded: ' || coalesce(v_scope, ''),
          round(v_price/100.0, 2), true, pkg.permit_deposit_pct, null, 'open', 'homeowner-app')
  returning id into v_pkgid;

  -- FIRST REFUSAL (migration 046): the lowest called price below the
  -- community price is invited alone for the window; everyone else when it
  -- closes or the holder passes. No holder - everyone, as before.
  v_holders := public.homeowner_first_refusal_holders(p_project);
  if coalesce(array_length(v_holders, 1), 0) > 0 then
    select first_refusal_hours into v_hours from public.config limit 1;
    v_until := now() + make_interval(hours => coalesce(v_hours, 12));
    update public.bid_packages set first_refusal_until = v_until where id = v_pkgid;
    -- The notify trigger reads this to tell the holder what they hold.
    perform set_config('sgr.first_refusal_until', v_until::text, true);
    v_n := public.homeowner_invite_eligible(p_project, v_pkgid, v_holders);
    perform set_config('sgr.first_refusal_until', '', true);
  else
    v_n := public.homeowner_invite_eligible(p_project, v_pkgid, null);
  end if;

  update public.project_bookings
     set state = 'posted', posted_at = now(), reply_by = null, price_guaranteed_until = now() + interval '7 days', price_cents = v_price, base_price_cents = pkg.base_price_cents,
         config_label = v_cfg, bid_package_id = v_pkgid, offered_count = v_n, target_window = null
   where id = b.id;
  update public.projects set notes = coalesce(notes, '') || E'\n\nPosted to the community''s ' || pkg.trade || ' contractors at $' || round(v_price/100.0) || ' on ' || to_char(now(), 'YYYY-MM-DD') ||
    case when v_n = 0 then ' - NOBODY was eligible: no approved ' || pkg.trade || ' contractor on the platform yet.'
         when v_until is not null then ' (' || v_n || ' with first refusal until ' || to_char(v_until, 'YYYY-MM-DD HH24:MI') || ', then the trade).'
         else ' (' || v_n || ' offered).' end
   where id = p_project;

  return jsonb_build_object('ok', true, 'project_id', p_project, 'home_project_id', b.home_project_id, 'booking_id', b.id,
                            'price_cents', v_price, 'reply_by', null, 'offered_count', v_n, 'instant_book', pkg.instant_book,
                            'first_refusal_until', v_until);
end $function$;

-- ---------------------------------------------------------------------
-- 3. Opening: when the window closes, or the holder passes.
-- ---------------------------------------------------------------------
create or replace function public.homeowner_open_first_refusals(p_package uuid default null)
returns integer
language plpgsql security definer set search_path to 'public'
as $$
declare bp record; n int; total int := 0;
begin
  for bp in
    select x.id, x.project_id from public.bid_packages x
     where x.status = 'open' and x.first_refusal_until is not null and x.first_refusal_opened_at is null
       and (p_package is not null and x.id = p_package or p_package is null and x.first_refusal_until <= now())
       and exists (select 1 from public.project_bookings b where b.bid_package_id = x.id and b.state = 'posted')
    for update skip locked
  loop
    n := public.homeowner_invite_eligible(bp.project_id, bp.id, null);
    update public.bid_packages set first_refusal_opened_at = now(), last_modified_at = now(), last_modified_by = 'system:first-refusal' where id = bp.id;
    update public.project_bookings set offered_count = coalesce(offered_count, 0) + n where bid_package_id = bp.id;
    total := total + n;
  end loop;
  return total;
end $$;
comment on function public.homeowner_open_first_refusals(uuid) is
  'Opens first-refusal offers to the rest of the trade: every open offer whose window has passed (scheduled every five minutes), or the one named (when its holder passes). Invites only those not yet invited; bumps the booking''s offered_count.';
revoke all on function public.homeowner_open_first_refusals(uuid) from public, anon, authenticated;

-- A pass by the holder ends the window at once.
create or replace function public.homeowner_offer_decline(p_project uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare b public.project_bookings; bp public.bid_packages;
begin
  perform public.assert_own_hands();
  select * into b from public.project_bookings where project_id = p_project;
  if b.id is null then return jsonb_build_object('ok', false, 'reason', 'No such job.'); end if;
  update public.bids set status = 'declined', last_modified_at = now(), last_modified_by = 'homeowner-app:decline'
   where package_id = b.bid_package_id and bidder_contact_id = public.my_contact_id() and status in ('invited','received');
  select * into bp from public.bid_packages where id = b.bid_package_id;
  if bp.first_refusal_until is not null and bp.first_refusal_opened_at is null
     and not exists (select 1 from public.bids bi where bi.package_id = bp.id and bi.status in ('invited','received')) then
    update public.bid_packages set first_refusal_until = now() where id = bp.id;
    perform public.homeowner_open_first_refusals(bp.id);
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- 4. The holder is told what they hold; the feed shows it.
-- ---------------------------------------------------------------------
create or replace function public.fn_bids_notify()
returns trigger
language plpgsql security definer set search_path to 'public'
as $function$
declare v_project text; v_real text; v_body text; v_from uuid; v_fr text;
begin
  select public.project_label_no_address(new.project_id) into v_project;
  select p.project_name into v_real from projects p where p.id = new.project_id;
  select ct.id into v_from from contacts ct
    join app_users u on u.contact_id = ct.id
   where u.id = (select owner_user_id from projects where id = new.project_id);

  if tg_op = 'INSERT' and new.status = 'invited' then
    v_body := 'You are invited to bid on ' || coalesce(v_project, 'a project')
              || coalesce(' in ' || public.project_town(new.project_id), '')
              || coalesce(' - ' || nullif(new.trade, ''), '') || '.'
              || coalesce(chr(10) || new.scope_summary, '')
              || chr(10) || 'The address is shared if the job is awarded to you.';
    -- Set by homeowner_post_internal while it invites the first-refusal
    -- holder (migration 046); empty for everyone else.
    v_fr := nullif(current_setting('sgr.first_refusal_until', true), '');
    if v_fr is not null then
      v_body := v_body || chr(10) || 'You have first refusal until ' || to_char(v_fr::timestamptz, 'FMDay HH24:MI')
                || ' - you called the lowest price for this package''s basic setup. After that it opens to every '
                || coalesce(new.trade, 'contractor') || ' contractor in the community.';
    end if;
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status = 'awarded' or new.won then
      v_body := 'Your bid on ' || coalesce(v_real, 'a project') || ' was awarded. Congratulations.';
    elsif new.status = 'not awarded' then
      v_body := 'Your bid on ' || coalesce(v_project, 'a project') || ' was not awarded this time.';
    elsif new.status = 'under negotiation' then
      v_body := 'Your bid on ' || coalesce(v_project, 'a project') || ' is being negotiated - check the package.';
    else
      return new;
    end if;
  else
    return new;
  end if;

  if new.bidder_contact_id is not null then
    insert into messages (body, direction, channel, status, sent_at,
                          project_id, from_contact_id, to_contact_id, contractor_id, created_by)
    values (v_body, 'inbound', 'in app', 'new', now(),
            new.project_id, v_from, new.bidder_contact_id, new.bidder_contact_id, 'trigger:bids');
  end if;
  return new;
end $function$;

create or replace function public.homeowner_offers()
returns jsonb
language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'project_id', b.project_id, 'bid_id', bd.id, 'package', bp.name, 'trade', bp.trade, 'price_cents', b.price_cents,
    'config_label', b.config_label, 'town', btrim(split_part(p.address, ',', 2)), 'posted_at', b.posted_at, 'reply_by', b.reply_by,
    'scope', (select jsonb_agg(si.item order by si.created_at) from public.project_scope_items si where si.project_id = b.project_id),
    'photos', (select count(*) from public.files f where f.project_id = b.project_id and f.kind = 'photo'),
    'status', bd.status,
    -- Set only while this bidder holds the job alone (migration 046).
    'first_refusal_until', case when pk.first_refusal_until > now() and pk.first_refusal_opened_at is null then pk.first_refusal_until end
  ) order by b.posted_at desc), '[]'::jsonb)
  from public.bids bd
  join public.project_bookings b on b.bid_package_id = bd.package_id
  join public.bid_packages pk on pk.id = bd.package_id
  join public.blueprint_packages bp on bp.code = b.package_code
  join public.projects p on p.id = b.project_id
  where bd.bidder_contact_id = public.my_contact_id()
    and bd.status in ('invited','received')
    and b.state = 'posted';
$function$;

-- ---------------------------------------------------------------------
-- 5. The clock.
-- ---------------------------------------------------------------------
select cron.schedule('open-first-refusals', '*/5 * * * *', $cron$select public.homeowner_open_first_refusals()$cron$)
 where not exists (select 1 from cron.job where jobname = 'open-first-refusals');

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
