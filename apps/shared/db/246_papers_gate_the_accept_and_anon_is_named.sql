-- 246 PAPERS GATE THE ACCEPT, AND ANON IS NAMED
--
-- Two follow-ups from the 2026-09-30 security review, after 245 took PUBLIC
-- off the function surface.
--
-- 1. DOCUMENTS GATE THE FIRST ACCEPT - IN THE DATABASE. apps/contractor/BUILD.md
--    settled it: browsing is free, taking a job is not, and the papers (COI,
--    workers' comp, W-9, a licence where the trade needs one) must be on file.
--    Until now the only thing enforcing that was the disabled Accept button:
--    homeowner_offer_accept checked that the bid was invited and never asked
--    contractor_readiness. An old tab, or a form posted by hand, took the job
--    with a lapsed COI. The rule now lives where every other rule lives.
--    A superadmin keeps the bypass the function already gave them.
--
-- 2. ANON IS AN EXPLICIT LIST. 245 stripped the PUBLIC grants; 127 SECURITY
--    DEFINER functions still carried an EXPLICIT grant to anon that nobody
--    could account for - portal_bid_award, set_user_plan, delete_own_project,
--    user_entitlement and the rest of the signed-in surface. Every one of
--    them refuses a stranger on its own (current_app_user_id() is null), so
--    this changes no behaviour; it changes the shape of the surface to the
--    one rulebook 71 asks for: revoked by default, granted by name. What anon
--    keeps is what a public page or a token-gated page reads, plus the RLS
--    helpers that a policy evaluates as anon (revoking those would turn a
--    "no rows" into an error), plus book_deal / cancel_deal_booking so a
--    signed-out tap on /deals still gets the function's own "sign in" answer.
--    Trigger functions are left alone, as in 245.

-- ---------------------------------------------------------------------------
-- 1. homeowner_offer_accept asks contractor_readiness before it does anything.
-- ---------------------------------------------------------------------------
create or replace function public.homeowner_offer_accept(p_project uuid, p_contact uuid default null::uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  b public.project_bookings; pr public.projects; pkg public.blueprint_packages; bd public.bids;
  v_contact uuid; v_owner_contact uuid; v_contract uuid; v_login uuid; v_name text; v_company uuid; v_scope text;
  v_town text; l record;
begin
  perform public.assert_own_hands();
  v_contact := case when public.is_superadmin() and p_contact is not null then p_contact else public.my_contact_id() end;
  if v_contact is null then return jsonb_build_object('ok', false, 'reason', 'Your account has no contact record.'); end if;
  if exists (select 1 from public.companies co join public.contacts c on c.company_id = co.id
              where c.id = v_contact and co.disabled_at is not null) then
    return jsonb_build_object('ok', false, 'code', 'RETIRED',
      'reason', 'Your company is no longer active on Green Bergen, so this job cannot be accepted. Get in touch if that is wrong.');
  end if;

  -- Documents gate the first accept (apps/contractor/BUILD.md). The button
  -- used to be the only guard; the rule belongs here, next to the others.
  if not public.is_superadmin()
     and not coalesce((public.contractor_readiness(v_contact) ->> 'can_accept')::boolean, false) then
    return jsonb_build_object('ok', false, 'code', 'PAPERS',
      'reason', 'Your documents need to be on file before you can accept. Upload them under Business > Documents and this job is yours to take.');
  end if;

  select * into b from public.project_bookings where project_id = p_project for update;
  if b.id is null then return jsonb_build_object('ok', false, 'reason', 'No such job.'); end if;
  if b.state <> 'posted' then return jsonb_build_object('ok', false, 'code', 'TAKEN', 'reason', 'This job is no longer open.'); end if;
  if public.stage_collected_by(p_project) = 'green_bergen' and exists (
       select 1 from public.payment_stages x where x.project_id = p_project and x.status <> 'Cancelled' and x.settlement_status <> 'paid') then
    return jsonb_build_object('ok', false, 'code', 'NOT_PAID_YET',
      'reason', 'The homeowner pays Green Bergen upfront on this job, and that payment is not in yet. It opens to accept as soon as it is.');
  end if;
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
          'Community package accepted at the stated price through the homeowner app. No counter-offer; the price is the package price. ' ||
          case when public.stage_collected_by(p_project) = 'green_bergen'
               then 'The homeowner pays Green Bergen each milestone; Green Bergen keeps its mark-up and pays the contractor this price.'
               else 'The homeowner pays the contractor each milestone with Green Bergen''s mark-up on top; the contractor owes Green Bergen the mark-up for the lead.' end)
  returning id into v_contract;

  update public.payment_stages set contract_id = v_contract where project_id = p_project and contract_id is null;

  insert into public.project_members (project_id, app_user_id, contact_id, role, project_role, contract_id, status, accepted_at, invited_by_user_id, notes)
  values (p_project, v_login, case when v_login is null then v_contact else null end, 'collaborator', 'contractor', v_contract, 'active', now(), pr.owner_user_id,
          'Seated by accepting the package offer.')
  on conflict do nothing;
  update public.project_members set contact_id = v_contact where project_id = p_project and contract_id = v_contract and app_user_id = v_login and contact_id is null;

  if bd.id is not null then
    update public.bids set status = 'awarded', won = true, received_on = current_date, last_modified_at = now(), last_modified_by = 'homeowner-app:accept' where id = bd.id;
  end if;

  -- Tell the people who did not get it, before their rows change. The town,
  -- never the address; never who took it.
  v_town := public.project_town(p_project);
  for l in
    select bi.bidder_contact_id from public.bids bi
     where bi.package_id = b.bid_package_id and bi.id is distinct from bd.id
       and bi.status in ('invited','received') and bi.bidder_contact_id is not null
  loop
    insert into public.messages (body, direction, channel, status, sent_at, project_id, from_contact_id, to_contact_id, created_by)
    values (pkg.name || coalesce(' in ' || v_town, '') || ' has been taken - another contractor accepted it first. Nothing needed from you.',
            'inbound', 'in app', 'new', now(), p_project, v_owner_contact, l.bidder_contact_id, 'system:package-taken');
  end loop;

  update public.bids set status = 'not awarded', won = false, not_awarded_reason = 'Another contractor accepted first', last_modified_at = now(), last_modified_by = 'homeowner-app:accept'
   where package_id = b.bid_package_id and id is distinct from bd.id and status in ('invited','received');
  update public.bid_packages set status = 'awarded', awarded_bid_id = bd.id, contract_id = v_contract, last_modified_at = now(), last_modified_by = 'homeowner-app:accept'
   where id = b.bid_package_id;

  update public.project_bookings set state = 'accepted', accepted_at = now(), contractor_contact_id = v_contact, contract_id = v_contract where id = b.id;

  insert into public.messages (body, direction, channel, status, sent_at, project_id, from_contact_id, to_contact_id, contractor_id, created_by)
  values (coalesce(v_name, 'Your contractor') || ' accepted the job. You now have each other''s contact details - say hi here whenever you like.',
          'inbound', 'in app', 'new', now(), p_project, v_contact, v_owner_contact, v_contact, 'system:package-accept');

  return jsonb_build_object('ok', true, 'contract_id', v_contract, 'contractor', v_name);
end $function$;

-- ---------------------------------------------------------------------------
-- 2. anon keeps a named list; every other explicit anon grant goes.
-- ---------------------------------------------------------------------------
do $function$
declare
  f record;
  keep text[] := array[
    -- public pages and token-gated pages
    'about_inquire','about_page','bid_by_token','bid_reply_by_token','checkin_context','checkin_history','checkin_submit',
    'deal_track','homeowner_catalogue','homeowner_catalogue_sections','homeowner_catalogue_tiles','homeowner_diy_list',
    'homeowner_package','homeowner_package_process','homeowner_package_products','homeowner_ref_preview','homeowner_share',
    'homeowner_trade_covered','house_page','invitation_preview','project_is_public','public_banner','public_company',
    'public_deals','public_settings','public_showcase','submit_survey','survey_by_token',
    'vendor_register','vendor_request_code_public','vendor_trades','vendor_update_profile','vendor_verify_code',
    -- /deals is public; a signed-out tap should get the function's own answer
    'book_deal','cancel_deal_booking',
    -- RLS helpers a policy may evaluate as anon
    'bid_can_manage','bid_is_bidder_on','bid_my_contact','can_see_credentials','can_touch_message',
    'contract_touches_our_side','i_am_contract_party'
  ];
begin
  for f in
    select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prokind = 'f'
      and p.prosecdef
      and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
      and has_function_privilege('anon', p.oid, 'EXECUTE')
      and not (p.proname = any(keep))
  loop
    execute format('revoke execute on function public.%I(%s) from anon', f.proname, f.args);
  end loop;
end
$function$;

update public.config set schema_version = schema_version + 1, schema_updated_at = current_date;
