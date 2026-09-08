-- ============================================================================
-- 009: THE CONTRACTOR APP, PART 1 - WHO THEY ARE AND WHETHER THEY MAY WORK.
--
-- Step 1 of apps/contractor/BUILD.md: a contractor can sign in, say who they
-- are, and see honestly where their application stands. Nothing here lets
-- anyone accept a job yet - that is step 3, and it is gated on the approval
-- this migration introduces.
--
-- Almost nothing new is needed, which is the point. contacts, companies,
-- trades (with an NJ licence label per trade), contact_trade_roles,
-- company_trade_roles, insurance_certificates and contractor_settings all
-- exist and are already what the portal uses. The one genuinely missing
-- thing is an APPLICATION: companies.needs_review is a flag, not a workflow
-- with a reviewer, a reason and a history.
--
--   contractor_approvals        the application and its decision
--   contractor_register(...)    link the login to a contact and a company
--   contractor_me()             one round trip for the whole shell
--
-- Additive: no table changed, no row touched.
-- ============================================================================
begin;

-- -------------------------------------------------------- the application
create table if not exists public.contractor_approvals (
  id            uuid primary key default gen_random_uuid(),
  contact_id    uuid not null references public.contacts(id) on delete cascade,
  company_id    uuid references public.companies(id) on delete set null,
  status        text not null default 'browsing'
                  constraint chk_contractor_approvals_status
                  check (status in ('browsing','submitted','approved','more needed','suspended')),
  submitted_at  timestamptz,
  decided_at    timestamptz,
  decided_by    uuid references public.app_users(id),
  reason        text,
  notes         text,
  created_at    timestamptz not null default now(),
  last_updated  timestamptz not null default now(),
  unique (contact_id)
);
comment on table public.contractor_approvals is
'A contractor''s application to take work in the community, and the decision on it. Browsing is free (they see the offer feed, town-only); this row is what gates ACCEPTING. companies.needs_review is a flag - this is the workflow: who decided, when, and why.';

alter table public.contractor_approvals enable row level security;

-- The applicant reads their own row and nothing else; only a superadmin
-- decides. Every write from the app goes through a function, never a policy.
create policy contractor_approvals_own on public.contractor_approvals
  for select to authenticated
  using (contact_id = public.my_contact_id() or public.is_superadmin());
create policy contractor_approvals_admin on public.contractor_approvals
  for all to authenticated
  using (public.is_superadmin()) with check (public.is_superadmin());

create index if not exists idx_contractor_approvals_status
  on public.contractor_approvals (status, submitted_at desc);

-- ------------------------------------------------------------- registering
-- Signup already made the app_users row (handle_new_auth_user). This links
-- it to a contact, puts a company behind it, and opens the application at
-- 'browsing' - which is exactly what it says: look all you like.
create or replace function public.contractor_register(
  p_full_name text, p_company_name text default null, p_phone text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.current_app_user_id();
  v_contact uuid; v_company uuid; v_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_co text := nullif(btrim(coalesce(p_company_name, '')), '');
  v_email text;
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.'); end if;

  select email into v_email from public.app_users where id = me;
  if v_name is not null then
    update public.app_users set full_name = v_name where id = me and coalesce(btrim(full_name), '') = '';
  end if;

  -- The portal's own linker: finds or makes the contact behind this login.
  v_contact := public.link_contact_for_user(me, 'contractor');
  if v_contact is null then return jsonb_build_object('ok', false, 'reason', 'We could not set up your contact record.'); end if;
  update public.contacts
     set person_name = coalesce(nullif(btrim(person_name), ''), v_name),
         phone = coalesce(nullif(btrim(phone), ''), nullif(btrim(coalesce(p_phone, '')), '')),
         email_a = coalesce(nullif(btrim(email_a), ''), v_email)
   where id = v_contact;

  -- The business. A sole operator still gets one - documents, trades and
  -- insurance all hang off a company, and they will not want to redo this
  -- the day they hire someone.
  select company_id into v_company from public.contacts where id = v_contact;
  if v_company is null and v_co is not null then
    insert into public.companies (company_name, main_phone, main_email, owner_user_id, source, created_by, needs_review)
    values (v_co, nullif(btrim(coalesce(p_phone, '')), ''), v_email, me, 'contractor-app', 'contractor-app', true)
    returning id into v_company;
    update public.contacts set company_id = v_company where id = v_contact;
  elsif v_company is not null and v_co is not null then
    update public.companies set company_name = v_co
     where id = v_company and coalesce(btrim(company_name), '') = '';
  end if;

  insert into public.contractor_approvals (contact_id, company_id, status)
  values (v_contact, v_company, 'browsing')
  on conflict (contact_id) do update set company_id = coalesce(excluded.company_id, public.contractor_approvals.company_id),
                                         last_updated = now();

  return jsonb_build_object('ok', true, 'contact_id', v_contact, 'company_id', v_company);
end $$;
comment on function public.contractor_register(text, text, text) is 'Links a freshly signed-in login to its contact (link_contact_for_user) and a company, and opens the application at browsing. Idempotent - a person who is already a contact keeps it, and a homeowner who also works a trade keeps one login and one app_users row.';

revoke all on function public.contractor_register(text, text, text) from public, anon;
grant execute on function public.contractor_register(text, text, text) to authenticated, service_role;

-- ------------------------------------------------------------ the shell
-- One round trip for every screen of the app: who they are, the business,
-- the trades, what documents are on file and when they lapse, where the
-- application stands, and what they may do about it.
create or replace function public.contractor_me()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  me uuid := public.current_app_user_id(); u public.app_users;
  v_contact uuid; v_company uuid; ap public.contractor_approvals;
  v_needs_licence boolean; v_gl boolean; v_wc boolean; v_w9 boolean; v_lic boolean;
begin
  if me is null then return jsonb_build_object('signed_in', false); end if;
  select * into u from public.app_users where id = me;
  v_contact := u.contact_id;
  select company_id into v_company from public.contacts where id = v_contact;
  select * into ap from public.contractor_approvals where contact_id = v_contact;

  -- Documents, as booleans the screen can act on. Expiry counts: a
  -- certificate that lapsed is not on file, whatever the column says.
  v_gl := exists (select 1 from public.insurance_certificates ic
                   where (ic.company_id = v_company or ic.contractor_id = v_contact)
                     and ic.coverage_type ilike '%liability%'
                     and (ic.expiry_date is null or ic.expiry_date >= current_date));
  v_wc := exists (select 1 from public.insurance_certificates ic
                   where (ic.company_id = v_company or ic.contractor_id = v_contact)
                     and ic.coverage_type ilike '%comp%'
                     and (ic.expiry_date is null or ic.expiry_date >= current_date));
  select coalesce(c.w9_on_file, false), nullif(btrim(coalesce(c.license_number, '')), '') is not null
    into v_w9, v_lic from public.companies c where c.id = v_company;
  v_needs_licence := exists (
    select 1 from public.company_trade_roles r join public.trades t on t.trade = r.trade
     where r.company_id = v_company and t.requires_documentation
    union all
    select 1 from public.contact_trade_roles r join public.trades t on t.trade = r.trade
     where r.contact_id = v_contact and t.requires_documentation);

  return jsonb_build_object(
    'signed_in', true,
    'profile', jsonb_build_object('app_user_id', u.id, 'full_name', u.full_name, 'email', u.email,
                                  'contact_id', v_contact, 'is_superadmin', u.is_superadmin),
    'company', case when v_company is null then null else (
      select jsonb_build_object('id', c.id, 'name', c.company_name, 'legal_name', c.legal_name, 'dba', c.dba,
                                'phone', c.main_phone, 'email', c.main_email, 'website', c.website,
                                'address', c.address, 'ein', c.ein, 'license_number', c.license_number,
                                'service_zip', c.service_zip, 'service_radius_miles', c.service_radius_miles,
                                'rating', public.contractor_rating(c.id))
        from public.companies c where c.id = v_company) end,
    -- Trades from the company and the person alike; the screen shows one list.
    'trades', coalesce((
      select jsonb_agg(distinct jsonb_build_object('trade', x.trade, 'licence', t.license_label,
                                                   'needs_docs', t.requires_documentation, 'stage', t.stage))
        from (select r.trade from public.company_trade_roles r where r.company_id = v_company
              union select r.trade from public.contact_trade_roles r where r.contact_id = v_contact) x
        join public.trades t on t.trade = x.trade), '[]'::jsonb),
    'documents', jsonb_build_object(
      'licence', jsonb_build_object('needed', coalesce(v_needs_licence, false), 'on_file', coalesce(v_lic, false)),
      'liability', jsonb_build_object('needed', true, 'on_file', v_gl),
      'workers_comp', jsonb_build_object('needed', true, 'on_file', v_wc),
      'w9', jsonb_build_object('needed', true, 'on_file', coalesce(v_w9, false)),
      'expiring', coalesce((select jsonb_agg(jsonb_build_object('coverage', ic.coverage_type, 'expires', ic.expiry_date))
                             from public.insurance_certificates ic
                            where (ic.company_id = v_company or ic.contractor_id = v_contact)
                              and ic.expiry_date is not null and ic.expiry_date < current_date + 30), '[]'::jsonb)),
    'approval', jsonb_build_object(
      'status', coalesce(ap.status, 'browsing'), 'submitted_at', ap.submitted_at,
      'decided_at', ap.decided_at, 'reason', ap.reason),
    -- The one derived answer every screen asks: may this person take work?
    'can_accept', coalesce(ap.status, 'browsing') = 'approved'
                  and v_gl and v_wc and coalesce(v_w9, false)
                  and (not coalesce(v_needs_licence, false) or coalesce(v_lic, false)),
    'counts', jsonb_build_object(
      'open_offers', (select count(*) from public.bids b
                       where b.bidder_contact_id = v_contact and b.status in ('invited','received')),
      'live_jobs', (select count(*) from public.project_bookings pb
                     where pb.contractor_contact_id = v_contact and pb.state = 'accepted'),
      'done_jobs', (select count(*) from public.project_bookings pb
                     where pb.contractor_contact_id = v_contact and pb.state = 'done')));
end $$;
comment on function public.contractor_me() is 'One round trip to render the contractor shell: profile, company with its rating, trades with the NJ licence each one needs, which documents are on file and which lapse inside 30 days, where the application stands, and the single derived can_accept the whole app gates on.';

revoke all on function public.contractor_me() from public, anon;
grant execute on function public.contractor_me() to authenticated, service_role;

-- ---------------------------------------------------------- admin decision
create or replace function public.contractor_approve(p_contact uuid, p_approve boolean, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.current_app_user_id();
begin
  perform public.assert_own_hands();
  if not public.is_superadmin() then return jsonb_build_object('ok', false, 'reason', 'Only Green Bergen can decide an application.'); end if;
  update public.contractor_approvals
     set status = case when p_approve then 'approved' else 'more needed' end,
         decided_at = now(), decided_by = me, reason = nullif(btrim(coalesce(p_reason, '')), ''), last_updated = now()
   where contact_id = p_contact;
  if not found then return jsonb_build_object('ok', false, 'reason', 'No application for that contact.'); end if;
  return jsonb_build_object('ok', true, 'status', case when p_approve then 'approved' else 'more needed' end);
end $$;
comment on function public.contractor_approve(uuid, boolean, text) is 'Green Bergen decides an application. Superadmin only; the decision, its author and its reason are kept on the row.';

revoke all on function public.contractor_approve(uuid, boolean, text) from public, anon;
grant execute on function public.contractor_approve(uuid, boolean, text) to authenticated, service_role;

commit;

-- ============================================================================
-- The two writes the onboarding screens need. Kept here rather than in a
-- later migration because they are the same subject: who this contractor is.
-- ============================================================================
begin;

create or replace function public.contractor_business_save(
  p_name text, p_legal_name text default null, p_phone text default null, p_email text default null,
  p_website text default null, p_address text default null, p_ein text default null,
  p_license_number text default null, p_service_zip text default null, p_service_radius_miles integer default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_contact uuid := public.my_contact_id(); v_company uuid; v_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  perform public.assert_own_hands();
  if v_contact is null then return jsonb_build_object('ok', false, 'reason', 'Finish signing up first.'); end if;
  if v_name is null then return jsonb_build_object('ok', false, 'reason', 'A business name, even if it is your own.'); end if;
  select company_id into v_company from public.contacts where id = v_contact;

  if v_company is null then
    insert into public.companies (company_name, source, created_by, owner_user_id, needs_review)
    values (v_name, 'contractor-app', 'contractor-app', public.current_app_user_id(), true)
    returning id into v_company;
    update public.contacts set company_id = v_company where id = v_contact;
    update public.contractor_approvals set company_id = v_company, last_updated = now() where contact_id = v_contact;
  end if;

  update public.companies
     set company_name = v_name,
         legal_name = coalesce(nullif(btrim(coalesce(p_legal_name, '')), ''), legal_name),
         main_phone = coalesce(nullif(btrim(coalesce(p_phone, '')), ''), main_phone),
         main_email = coalesce(nullif(btrim(coalesce(p_email, '')), ''), main_email),
         website = coalesce(nullif(btrim(coalesce(p_website, '')), ''), website),
         address = coalesce(nullif(btrim(coalesce(p_address, '')), ''), address),
         ein = coalesce(nullif(btrim(coalesce(p_ein, '')), ''), ein),
         license_number = coalesce(nullif(btrim(coalesce(p_license_number, '')), ''), license_number),
         service_zip = coalesce(nullif(btrim(coalesce(p_service_zip, '')), ''), service_zip),
         service_radius_miles = coalesce(p_service_radius_miles, service_radius_miles),
         last_modified_at = now(), last_modified_by = 'contractor-app'
   where id = v_company;

  return jsonb_build_object('ok', true, 'company_id', v_company);
end $$;
comment on function public.contractor_business_save(text, text, text, text, text, text, text, text, text, integer) is 'The contractor edits their own business record. Only their own: the company is found through their contact, never passed in. Blank fields leave what is already there alone, so a half-filled form never wipes a value.';

revoke all on function public.contractor_business_save(text, text, text, text, text, text, text, text, text, integer) from public, anon;
grant execute on function public.contractor_business_save(text, text, text, text, text, text, text, text, text, integer) to authenticated, service_role;

create or replace function public.contractor_trades_set(p_trades text[])
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_contact uuid := public.my_contact_id(); v_company uuid; t text; v_n int := 0;
begin
  perform public.assert_own_hands();
  if v_contact is null then return jsonb_build_object('ok', false, 'reason', 'Finish signing up first.'); end if;
  select company_id into v_company from public.contacts where id = v_contact;

  -- Only trades the vocabulary knows. A typo must not invent a trade, and
  -- homeowner_post_internal matches bidders on exactly this column.
  if exists (select 1 from unnest(coalesce(p_trades, '{}')) x where not exists (select 1 from public.trades t2 where t2.trade = x)) then
    return jsonb_build_object('ok', false, 'reason', 'One of those trades is not one we know.');
  end if;

  delete from public.contact_trade_roles r
   where r.contact_id = v_contact and r.trade <> all (coalesce(p_trades, '{}'));
  if v_company is not null then
    delete from public.company_trade_roles r
     where r.company_id = v_company and r.trade <> all (coalesce(p_trades, '{}'));
  end if;

  foreach t in array coalesce(p_trades, '{}') loop
    insert into public.contact_trade_roles (contact_id, trade, domain, created_by)
    select v_contact, t, 'construction', 'contractor-app'
     where not exists (select 1 from public.contact_trade_roles r where r.contact_id = v_contact and r.trade = t);
    if v_company is not null then
      insert into public.company_trade_roles (company_id, trade, domain, created_by)
      select v_company, t, 'construction', 'contractor-app'
       where not exists (select 1 from public.company_trade_roles r where r.company_id = v_company and r.trade = t);
    end if;
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('ok', true, 'trades', v_n);
end $$;
comment on function public.contractor_trades_set(text[]) is 'Replaces the trades this contractor works, on the person and on the company together. Values are checked against the trades table because homeowner_post_internal matches bidders on exactly this column - a typo here is a contractor who never sees a job.';

revoke all on function public.contractor_trades_set(text[]) from public, anon;
grant execute on function public.contractor_trades_set(text[]) to authenticated, service_role;

-- The vocabulary itself, for the picker. Templates, readable by any member.
create or replace function public.contractor_trade_catalogue()
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'trade', t.trade, 'stage', t.stage, 'licence', t.license_label, 'needs_docs', t.requires_documentation)
    order by t.sort_order, t.trade), '[]'::jsonb)
  from public.trades t where t.is_construction or t.is_service;
$$;
comment on function public.contractor_trade_catalogue() is 'The trades a contractor may pick from, with the NJ licence each one needs. Template data - drives the onboarding picker so no trade list is ever hardcoded in an app.';

revoke all on function public.contractor_trade_catalogue() from public, anon;
grant execute on function public.contractor_trade_catalogue() to authenticated, service_role;

commit;
