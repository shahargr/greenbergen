-- 050 - the trade hears about every job (v219, v219b, v219c).
--
-- NOT WRITTEN IN THIS REPO. These three migrations were applied straight to
-- the database by the chat session on the night of 2026-09-10, between this
-- repo's 046 and 049, as v219 / v219b / v219c. They are kept here verbatim
-- so the migration folder is the whole record (rulebook: the database is the
-- truth; the repo mirrors it). The one change from the applied text: the
-- block that set config.schema_version = 219 is removed, because the
-- counter follows this repo's numbering (Shahar, 2026-09-10) - 051 bumps it.
--
-- Audit against the work before them (051 has the one repair):
--   contractor_readiness   new: one definition of papers-complete.
--   contractor_me          same shape, documents read from it, 'missing' added.
--   homeowner_notify_trade new: the nudge to trade holders not offered the job.
--   portal_my_messages     kept mine/self/Me from 043; added system:% kind
--                          and no counterparty on a system message; CHANGED
--                          the pending rule and dropped STABLE -> repaired in 051.
--   homeowner_post_internal kept first refusal from 046 whole; calls the nudge.
--   fn_bids_notify         kept the first-refusal line from 046; adds why the
--                          Accept button will be grey.

-- =====================================================================
-- v219 - Posting a job reaches every contractor in the trade, ready or not (Shahar, 2026-09-10).
--
-- Before: homeowner_invite_eligible offered the job to approved contractors only, so a
-- plumber whose insurance certificate was never uploaded heard NOTHING - the one moment
-- when finishing the paperwork is obviously worth it passed him silently.
-- After: the ready are offered the job exactly as before; everyone else in the trade gets
-- the same news as a nudge naming what is missing. No bids row for them, so the gate on
-- ACCEPTING is untouched - only the silence is.

-- ONE DEFINITION OF "PAPERS COMPLETE". It lived inside contractor_me, which reads the
-- caller's own row and so could not answer the question for anybody else. Lifted out
-- whole: contractor_me now calls this, and so does the nudge, which is the only way the
-- two can never disagree about who is ready (rulebook 51 - have the rule read the fact,
-- not a copy of the fact).
create or replace function public.contractor_readiness(p_contact uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_company uuid; v_status text;
  v_needs_licence boolean; v_gl boolean; v_wc boolean; v_w9 boolean; v_lic boolean;
  v_missing text[] := '{}';
begin
  if p_contact is null then return null; end if;
  select company_id into v_company from public.contacts where id = p_contact;
  select coalesce(status, 'browsing') into v_status from public.contractor_approvals where contact_id = p_contact;
  v_status := coalesce(v_status, 'browsing');

  -- Expiry counts: a certificate that lapsed is not on file, whatever the column says.
  v_gl := exists (select 1 from public.insurance_certificates ic
                   where (ic.company_id = v_company or ic.contractor_id = p_contact)
                     and ic.coverage_type ilike '%liability%'
                     and (ic.expiry_date is null or ic.expiry_date >= current_date));
  v_wc := exists (select 1 from public.insurance_certificates ic
                   where (ic.company_id = v_company or ic.contractor_id = p_contact)
                     and ic.coverage_type ilike '%comp%'
                     and (ic.expiry_date is null or ic.expiry_date >= current_date));
  select coalesce(c.w9_on_file, false), nullif(btrim(coalesce(c.license_number, '')), '') is not null
    into v_w9, v_lic from public.companies c where c.id = v_company;
  v_needs_licence := exists (
    select 1 from public.company_trade_roles r join public.trades t on t.trade = r.trade
     where r.company_id = v_company and t.requires_documentation
    union all
    select 1 from public.contact_trade_roles r join public.trades t on t.trade = r.trade
     where r.contact_id = p_contact and t.requires_documentation);

  if not v_gl then v_missing := v_missing || 'a general liability certificate'::text; end if;
  if not v_wc then v_missing := v_missing || 'a workers compensation certificate'::text; end if;
  if not coalesce(v_w9, false) then v_missing := v_missing || 'a signed W-9'::text; end if;
  if coalesce(v_needs_licence, false) and not coalesce(v_lic, false) then
    v_missing := v_missing || 'your trade licence number'::text;
  end if;

  return jsonb_build_object(
    'contact_id', p_contact,
    'approval_status', v_status,
    'documents', jsonb_build_object(
      'licence', jsonb_build_object('needed', coalesce(v_needs_licence, false), 'on_file', coalesce(v_lic, false)),
      'liability', jsonb_build_object('needed', true, 'on_file', v_gl),
      'workers_comp', jsonb_build_object('needed', true, 'on_file', v_wc),
      'w9', jsonb_build_object('needed', true, 'on_file', coalesce(v_w9, false)),
      'expiring', coalesce((select jsonb_agg(jsonb_build_object('coverage', ic.coverage_type, 'expires', ic.expiry_date))
                             from public.insurance_certificates ic
                            where (ic.company_id = v_company or ic.contractor_id = p_contact)
                              and ic.expiry_date is not null and ic.expiry_date < current_date + 30), '[]'::jsonb)),
    'missing', to_jsonb(v_missing),
    'papers_complete', v_gl and v_wc and coalesce(v_w9, false)
                       and (not coalesce(v_needs_licence, false) or coalesce(v_lic, false)),
    'can_accept', v_status = 'approved' and v_gl and v_wc and coalesce(v_w9, false)
                  and (not coalesce(v_needs_licence, false) or coalesce(v_lic, false)));
end
$fn$;

comment on function public.contractor_readiness(uuid) is
'THE definition of whether a contractor may take work: approval plus liability, workers comp, W-9 and (where the trade requires documentation) a licence number, each unexpired. Returns the same documents object contractor_me has always returned, plus missing (what to upload, in words) and papers_complete (the documents alone, ignoring approval). contractor_me and the job-posting nudge both read it, so neither can drift from the other.';

revoke all on function public.contractor_readiness(uuid) from public, anon;
grant execute on function public.contractor_readiness(uuid) to authenticated, service_role;

-- contractor_me keeps its shape exactly; only the source of the document facts moves.
create or replace function public.contractor_me()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  me uuid := public.current_app_user_id(); u public.app_users;
  v_contact uuid; v_company uuid; ap public.contractor_approvals; r jsonb;
begin
  if me is null then return jsonb_build_object('signed_in', false); end if;
  select * into u from public.app_users where id = me;
  v_contact := u.contact_id;
  select company_id into v_company from public.contacts where id = v_contact;
  select * into ap from public.contractor_approvals where contact_id = v_contact;
  r := public.contractor_readiness(v_contact);

  return jsonb_build_object(
    'signed_in', true,
    'profile', jsonb_build_object('app_user_id', u.id, 'full_name', u.full_name, 'email', u.email,
                                  'contact_id', v_contact, 'is_superadmin', u.is_superadmin),
    'company', case when v_company is null then null else (
      select jsonb_build_object('id', c.id, 'name', c.company_name, 'legal_name', c.legal_name, 'dba', c.dba,
                                'phone', c.main_phone, 'email', c.main_email, 'website', c.website,
                                'address', c.address, 'ein', c.ein, 'license_number', c.license_number,
                                'service_zip', c.service_zip, 'service_radius_miles', c.service_radius_miles,
                                'serves_adjacent_states', coalesce(c.serves_adjacent_states, false),
                                'rating', public.contractor_rating(c.id))
        from public.companies c where c.id = v_company) end,
    'trades', coalesce((
      select jsonb_agg(distinct jsonb_build_object('trade', x.trade, 'licence', t.license_label,
                                                   'needs_docs', t.requires_documentation, 'stage', t.stage))
        from (select r2.trade from public.company_trade_roles r2 where r2.company_id = v_company
              union select r2.trade from public.contact_trade_roles r2 where r2.contact_id = v_contact) x
        join public.trades t on t.trade = x.trade), '[]'::jsonb),
    'documents', coalesce(r->'documents', '{}'::jsonb),
    'missing', coalesce(r->'missing', '[]'::jsonb),
    'approval', jsonb_build_object(
      'status', coalesce(ap.status, 'browsing'), 'submitted_at', ap.submitted_at,
      'decided_at', ap.decided_at, 'reason', ap.reason),
    'can_accept', coalesce((r->>'can_accept')::boolean, false),
    'counts', jsonb_build_object(
      'open_offers', (select count(*) from public.bids b
                       where b.bidder_contact_id = v_contact and b.status in ('invited','received')),
      'live_jobs', (select count(*) from public.project_bookings pb
                     where pb.contractor_contact_id = v_contact and pb.state = 'accepted'),
      'done_jobs', (select count(*) from public.project_bookings pb
                     where pb.contractor_contact_id = v_contact and pb.state = 'done')));
end
$fn$;

-- THE NUDGE. Everyone in the trade who did NOT get an offer hears about the job anyway,
-- with the reason they cannot take it and the one screen that fixes it.
create or replace function public.homeowner_notify_trade(p_project uuid, p_pkgid uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  b public.project_bookings; pr public.projects; pkg public.blueprint_packages;
  c record; r jsonb; v_missing text; v_body text; v_lead text;
  v_owner_contact uuid; v_town text; v_price text;
  v_n int := 0; v_no_login int := 0;
begin
  select * into b from public.project_bookings where project_id = p_project;
  select * into pr from public.projects where id = p_project;
  select * into pkg from public.blueprint_packages where code = b.package_code;
  if pkg.trade is null then return jsonb_build_object('nudged', 0, 'no_login', 0); end if;

  v_owner_contact := (select contact_id from public.app_users where id = pr.owner_user_id);
  v_town := public.project_town(p_project);
  v_price := case when b.price_cents is not null then '$' || to_char(round(b.price_cents/100.0), 'FM999G999') end;

  -- Trade holders with no login at all: counted, never emailed from here. Reaching them
  -- is outbound contact with people who never joined, which is a decision of its own.
  select count(distinct ct.id) into v_no_login
    from public.contacts ct
   where not exists (select 1 from public.app_users u where u.contact_id = ct.id and u.is_active)
     and (exists (select 1 from public.contact_trade_roles r where r.contact_id = ct.id and r.trade = pkg.trade)
       or exists (select 1 from public.company_trade_roles r where r.company_id = ct.company_id and r.trade = pkg.trade));

  for c in
    select distinct ct.id as contact_id
      from public.contacts ct
      join public.app_users u on u.contact_id = ct.id and u.is_active
     where ct.id is distinct from v_owner_contact
       and (exists (select 1 from public.contact_trade_roles r where r.contact_id = ct.id and r.trade = pkg.trade)
         or exists (select 1 from public.company_trade_roles r where r.company_id = ct.company_id and r.trade = pkg.trade))
       -- Already offered the job: their inbox gets the offer itself from fn_bids_notify,
       -- and telling the same person twice about one job is noise, not reach.
       and not exists (select 1 from public.bids bi where bi.package_id = p_pkgid and bi.bidder_contact_id = ct.id)
       -- One nudge per package. A re-post must not re-nudge the same people.
       and not exists (select 1 from public.messages m
                        where m.to_contact_id = ct.id and m.project_id = p_project
                          and m.created_by = 'system:trade-nudge')
  loop
    r := public.contractor_readiness(c.contact_id);
    -- Ready and simply not invited yet (a first-refusal window is running): they get the
    -- offer when it opens. Telling them their papers are short would be false.
    if coalesce((r->>'can_accept')::boolean, false) then continue; end if;

    select string_agg(x, ', ') into v_missing
      from jsonb_array_elements_text(coalesce(r->'missing', '[]'::jsonb)) x;

    v_lead := 'A ' || pkg.trade || ' job' || coalesce(' in ' || v_town, '') || ' just opened'
              || coalesce(' - ' || v_price, '') || ', and you cannot take it yet.';

    v_body := v_lead
      || chr(10) || pkg.name || coalesce(' - ' || b.config_label, '') || '.'
      || chr(10)
      || case when v_missing is not null
              then chr(10) || 'Still needed: ' || v_missing || '.'
              else '' end
      || case when coalesce(r->>'approval_status', 'browsing') <> 'approved'
              then chr(10) || case coalesce(r->>'approval_status', 'browsing')
                                when 'browsing' then 'You have not applied to take work in the community yet.'
                                when 'pending' then 'Your application is with us - we will come back to you.'
                                when 'rejected' then 'Your application was not accepted. Get in touch if that is wrong.'
                                else 'Your application is ' || (r->>'approval_status') || '.' end
              else '' end
      || chr(10) || chr(10)
      || 'Put your papers on file under Business, Documents. Once they are in, this job - and every '
      || pkg.trade || ' job posted after it - is yours to accept on the spot.'
      || chr(10) || 'The address is only shared when a job is awarded.';

    insert into public.messages (body, direction, channel, status, sent_at, sender,
                                 project_id, from_contact_id, to_contact_id, contractor_id, created_by)
    values (v_body, 'inbound', 'in app', 'new', now(), 'Green Bergen',
            p_project, null, c.contact_id, c.contact_id, 'system:trade-nudge');
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('nudged', v_n, 'no_login', coalesce(v_no_login, 0));
end
$fn$;

comment on function public.homeowner_notify_trade(uuid, uuid) is
'Posting a job tells the WHOLE trade, not just the contractors who can accept it. Writes one inbox message to every trade holder with a login who was not offered this package and is not ready to be - naming the job, the town, the price, what is missing and where to fix it. No bids row, so ACCEPTING stays gated on contractor_readiness; only the silence is removed. One nudge per person per package. Contacts with no login are counted and not contacted: cold outbound is a separate decision.';

revoke all on function public.homeowner_notify_trade(uuid, uuid) from public, anon;
grant execute on function public.homeowner_notify_trade(uuid, uuid) to authenticated, service_role;

-- portal_my_messages as v219 applied it is NOT repeated here: 051 carries the
-- merged definition (v219's system:% handling on top of 043's pending rule).

-- =====================================================================
-- v219b - post_internal calls the trade nudge. Identical to 046's
-- homeowner_post_internal plus the nudge call and its two return fields.
create or replace function public.homeowner_post_internal(p_project uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  b public.project_bookings; pr public.projects; pkg public.blueprint_packages; me uuid;
  v_price integer; v_cfg text; v_reason text;
  v_pkgid uuid;
  v_scope text; m record; v_n int := 0; v_plan public.project_billing_plan;
  v_holders uuid[]; v_until timestamptz; v_hours int;
  v_nudge jsonb;
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

  insert into public.bid_packages (project_id, trade, category, scope_summary, budget_amount, budget_visible, deposit_pct, reply_by, status, created_by)
  values (p_project, pkg.trade, 'Package', pkg.name || ' - ' || coalesce(v_cfg, '') || E'.\nIncluded: ' || coalesce(v_scope, ''),
          round(v_price/100.0, 2), true, pkg.permit_deposit_pct, null, 'open', 'homeowner-app')
  returning id into v_pkgid;

  v_holders := public.homeowner_first_refusal_holders(p_project);
  if coalesce(array_length(v_holders, 1), 0) > 0 then
    select first_refusal_hours into v_hours from public.config limit 1;
    v_until := now() + make_interval(hours => coalesce(v_hours, 12));
    update public.bid_packages set first_refusal_until = v_until where id = v_pkgid;
    perform set_config('sgr.first_refusal_until', v_until::text, true);
    v_n := public.homeowner_invite_eligible(p_project, v_pkgid, v_holders);
    perform set_config('sgr.first_refusal_until', '', true);
  else
    v_n := public.homeowner_invite_eligible(p_project, v_pkgid, null);
  end if;

  -- v219: the rest of the trade hears about it too. Whoever could not be offered the job
  -- gets the news plus the reason, because the moment a job is on the table is the moment
  -- finishing the paperwork is obviously worth doing.
  v_nudge := public.homeowner_notify_trade(p_project, v_pkgid);

  update public.project_bookings
     set state = 'posted', posted_at = now(), reply_by = null, price_guaranteed_until = now() + interval '7 days', price_cents = v_price, base_price_cents = pkg.base_price_cents,
         config_label = v_cfg, bid_package_id = v_pkgid, offered_count = v_n, target_window = null
   where id = b.id;
  update public.projects set notes = coalesce(notes, '') || E'\n\nPosted to the community''s ' || pkg.trade || ' contractors at $' || round(v_price/100.0) || ' on ' || to_char(now(), 'YYYY-MM-DD') ||
    case when v_n = 0 then ' - NOBODY was eligible: no approved ' || pkg.trade || ' contractor on the platform yet.'
         when v_until is not null then ' (' || v_n || ' with first refusal until ' || to_char(v_until, 'YYYY-MM-DD HH24:MI') || ', then the trade).'
         else ' (' || v_n || ' offered).' end ||
    case when coalesce((v_nudge->>'nudged')::int, 0) > 0
         then ' ' || (v_nudge->>'nudged') || ' more in the trade were told and nudged to finish their papers.'
         else '' end
   where id = p_project;

  return jsonb_build_object('ok', true, 'project_id', p_project, 'home_project_id', b.home_project_id, 'booking_id', b.id,
                            'price_cents', v_price, 'reply_by', null, 'offered_count', v_n, 'instant_book', pkg.instant_book,
                            'first_refusal_until', v_until,
                            'nudged', coalesce((v_nudge->>'nudged')::int, 0),
                            'trade_no_login', coalesce((v_nudge->>'no_login')::int, 0));
end
$fn$;

-- =====================================================================
-- v219c - An offer that lands with someone whose papers are short now says so in the
-- same message. Approval and documents are separate gates: homeowner_invite_eligible
-- offers on APPROVAL alone, so an approved contractor with no certificate on file got
-- the offer and then a grey Accept button with the explanation two screens away.
-- One message per job, carrying the reason when there is one.
create or replace function public.fn_bids_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare v_project text; v_real text; v_body text; v_from uuid; v_fr text; r jsonb; v_missing text;
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
    v_fr := nullif(current_setting('sgr.first_refusal_until', true), '');
    if v_fr is not null then
      v_body := v_body || chr(10) || 'You have first refusal until ' || to_char(v_fr::timestamptz, 'FMDay HH24:MI')
                || ' - you called the lowest price for this package''s basic setup. After that it opens to every '
                || coalesce(new.trade, 'contractor') || ' contractor in the community.';
    end if;

    -- v219c: why the Accept button will be grey, said here rather than found there.
    if new.bidder_contact_id is not null then
      r := public.contractor_readiness(new.bidder_contact_id);
      if not coalesce((r->>'can_accept')::boolean, false) then
        select string_agg(x, ', ') into v_missing
          from jsonb_array_elements_text(coalesce(r->'missing', '[]'::jsonb)) x;
        v_body := v_body || chr(10) || chr(10) || 'Before you can accept this one:'
          || case when v_missing is not null then chr(10) || 'Still needed: ' || v_missing || '.' else '' end
          || case when coalesce(r->>'approval_status', 'browsing') <> 'approved'
                  then chr(10) || 'Your application to take work is ' || coalesce(r->>'approval_status', 'not sent yet') || '.'
                  else '' end
          || chr(10) || 'Business, Documents is where that gets fixed.';
      end if;
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
end
$fn$;
