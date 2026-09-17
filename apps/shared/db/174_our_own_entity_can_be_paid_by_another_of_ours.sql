-- 174: OUR OWN ENTITY CAN BE PAID BY ANOTHER OF OURS.
--
-- Shahar (2026-09-17), awarding General Contractor on New build to himself:
-- "I tried to award the bid of GC to myself, and got error. I think this is
-- wrong, as the Owner of 55 Walnut needs to pay Shahar @ Net Positive LLC
-- for ongoing GC management fees. So Shahar can be the owner, as well as be
-- paid to his service company for the services rendered to the project."
--
-- He is right. The award refused anyone on our own side of the book (111),
-- on the theory that we never write a payable contract to ourselves. But
-- "ourselves" is three entities: NP 55 Walnut DR, Tenafly LLC owns and pays
-- for the job; Net Positive LLC runs it for a fee; Green Bergen Development
-- is the brand. A management fee from the first to the second is real money
-- and has to be on the books like any other contract - and it is exactly
-- what contract_touches_our_side already exists to flag.
--
-- THE RULE NOW: a party may be awarded and paid unless (a) it IS the entity
-- that pays for this job - nobody pays themselves - or (b) it is a person
-- on our side with no company to be paid through. A person is paid through
-- their company: the placeholder names the company as counterparty and the
-- person as contractor, which is how every real contract is spelled (154).
--
-- Also: the award looked for "any seat this person holds" to decide whether
-- to reuse one, and found Shahar's owner seat, which never carries a
-- contract - so even with the rule fixed it would have reported UNBOUNDED.
-- It now looks only at seats that need a contract.

create or replace function public.party_not_payable(p_project uuid, p_contact uuid, p_company uuid default null)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_company uuid := coalesce(p_company, (select ct.company_id from public.contacts ct where ct.id = p_contact));
  v_signing uuid := public.project_signing_entity(p_project);
  v_name text := coalesce(
    (select co.company_name from public.companies co where co.id = v_company),
    (select coalesce(ct.person_name, ct.name) from public.contacts ct where ct.id = p_contact),
    'This party');
  v_ours boolean;
begin
  if v_company is not null and v_signing is not null and v_company = v_signing then
    return v_name || ' is the entity that pays for this job. It cannot be paid by itself - award the work to the '
        || 'company doing it (your service company, for a management fee), and the job pays that company.';
  end if;
  v_ours := exists (select 1 from public.party_class_links l
                     where l.class_code in ('our_entity', 'customer')
                       and (l.contact_id = p_contact or (v_company is not null and l.company_id = v_company)));
  if v_ours and v_company is null then
    return v_name || ' is on our own side of the book - a customer, or one of us - with no company to be paid '
        || 'through. Put their LLC on their contact card and award to that: the contract then names the company, '
        || 'and the job pays it like any other.';
  end if;
  return null;
end $$;
comment on function public.party_not_payable(uuid, uuid, uuid) is
  'Why a party cannot be awarded and paid on a job, or null when it can. Only two reasons: it is the job''s own paying entity, or it is one of us with no company to be paid through (migration 174).';

-- ---------------------------------------------------------------------------
-- The award asks the new question, and only reuses a seat that needs a contract.
do $patch$
declare src text; out_ text;
begin
  src := pg_get_functiondef('public.portal_award_trade(uuid, uuid, text, text, uuid, boolean)'::regprocedure);
  out_ := src;

  out_ := replace(out_, 'v_existing jsonb;', 'v_existing jsonb; v_why text;');

  out_ := replace(out_,
    E'  if exists (select 1 from public.party_class_links l\n'
 || E'              where l.class_code in (''our_entity'',''customer'')\n'
 || E'                and (l.contact_id = v_contact\n'
 || E'                  or (v_company is not null and l.company_id = v_company))) then\n'
 || E'    return jsonb_build_object(''ok'', false, ''code'', ''OWN_SIDE'', ''who'', v_name, ''reason'',\n'
 || E'      v_name || '' is on our own side of the book - a customer, or our own entity - so no payable ''\n'
 || E'      || ''contract can be written to them, and a contractor seat with nothing behind it is the one ''\n'
 || E'      || ''thing this refuses to create. Awarding is for the people you pay. Somebody on our side who ''\n'
 || E'      || ''is running the job belongs on it as a site project manager instead.'');\n'
 || E'  end if;',
    E'  v_why := public.party_not_payable(p_project, v_contact, v_company);\n'
 || E'  if v_why is not null then\n'
 || E'    return jsonb_build_object(''ok'', false, ''code'', ''OWN_SIDE'', ''who'', v_name, ''reason'', v_why);\n'
 || E'  end if;');

  out_ := replace(out_,
    E'   where project_id = p_project and contact_id = v_contact and status <> ''removed''\n   limit 1;',
    E'   where project_id = p_project and contact_id = v_contact and status <> ''removed''\n     and public.seat_needs_contract(project_role)\n   limit 1;');
  out_ := replace(out_,
    E'     where project_id = p_project and contact_id = v_contact and status = ''removed''\n     order by created_at desc limit 1;',
    E'     where project_id = p_project and contact_id = v_contact and status = ''removed''\n       and public.seat_needs_contract(project_role)\n     order by created_at desc limit 1;');

  if out_ = src or position('party_not_payable' in out_) = 0 or position('seat_needs_contract(project_role)' in out_) = 0 then
    raise exception 'portal_award_trade has drifted - a block to patch was not found';
  end if;
  execute out_;
end $patch$;

-- ---------------------------------------------------------------------------
-- The seat trigger writes the placeholder for our own side too, and names
-- the person's company as the party paid.
do $patch$
declare src text; out_ text;
begin
  src := pg_get_functiondef('public.fn_members_ensure_contract()'::regprocedure);
  out_ := src;

  out_ := replace(out_,
    E'  if exists (select 1 from public.party_class_links l\n'
 || E'              where l.class_code in (''our_entity'',''customer'')\n'
 || E'                and (l.contact_id = new.contact_id or l.company_id = new.company_id)) then\n'
 || E'    return new;\n'
 || E'  end if;',
    E'  if public.party_not_payable(new.project_id, new.contact_id, new.company_id) is not null then\n'
 || E'    return new;\n'
 || E'  end if;');

  out_ := replace(out_,
    E'        left join public.companies co on co.id = new.company_id\n',
    E'        left join public.companies co on co.id = coalesce(new.company_id, (select ct2.company_id from public.contacts ct2 where ct2.id = new.contact_id))\n');

  out_ := replace(out_,
    E'         signer_company_id, counterparty_company_id, counterparty_contact_id,\n'
 || E'         created_by, notes)\n',
    E'         signer_company_id, counterparty_company_id, counterparty_contact_id, contractor_id,\n'
 || E'         created_by, notes)\n');
  out_ := replace(out_,
    E'        v_entity, new.company_id, new.contact_id,\n',
    E'        v_entity, coalesce(new.company_id, (select ct3.company_id from public.contacts ct3 where ct3.id = new.contact_id)), new.contact_id, new.contact_id,\n');

  if out_ = src or position('party_not_payable' in out_) = 0 or position('contractor_id,' in out_) = 0
     or position('ct3.company_id' in out_) = 0 or position('ct2.company_id' in out_) = 0 then
    raise exception 'fn_members_ensure_contract has drifted - a block to patch was not found';
  end if;
  execute out_;
end $patch$;

-- ---------------------------------------------------------------------------
insert into public.help (topic, title, content, applies_to, doc_type)
select 'contracts',
       'Paying one of our own entities - allowed between two of ours, never to the job''s own payer',
       'Shahar (2026-09-17): the owner of 55 Walnut (NP 55 Walnut DR, Tenafly LLC) pays Net Positive LLC for GC management fees, and Shahar is both the owner and the person doing the work. Migration 174 settled it: a party can be awarded and paid unless it IS the job''s paying entity (project_signing_entity) or it is a person on our side with no company to be paid through. A person is paid through their company - the placeholder names the company as counterparty and the person as contractor_id. The test is party_not_payable(project, contact, company): null means payable, otherwise the reason in words. contract_touches_our_side still flags every such contract as intercompany for reporting. Do not reintroduce the blanket "our_entity or customer" refusal; that was migration 111''s theory and it was wrong for a builder who owns the house.',
       'contracts, project_members, portal_award_trade, fn_members_ensure_contract',
       'gotcha'
where not exists (select 1 from public.help h where h.title like 'Paying one of our own entities%');

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
