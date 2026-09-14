-- 111. AN AWARD NAMES ONE PERSON, AND TELLS THE TRUTH ABOUT WHAT IT DID.
--
-- Shahar (2026-09-14): "i awarded a PM job to shahar.greenberg@gmail.com,
-- but this is what was done and presented - sg.other..."
--
-- Two separate faults, both mine, both from 106/108.
--
-- ONE: THE PHONE OUTRANKED THE EMAIL, SILENTLY.
--
-- 108 identifies somebody by phone, then email, then name, because contacts
-- holds a unique index on each - which was the right reading of the schema
-- and the wrong reading of the person. These two records exist:
--
--   Shahar Greenberg   347 948 4484   shahar.greenberg@gmail.com
--   sg.other+2         347 948 4488   sg.other+2@gmail.com
--
-- One digit apart. Give the function an email naming the first and a phone
-- naming the second and it took the phone, announced "that number is already
-- sg.other+2 - awarded to them", and awarded the work to a different human
-- being. The note was honest and the behaviour was not: two identifiers that
-- disagree are not a match to be resolved by precedence, they are a question
-- only the person typing can answer. So now it refuses and names both.
--
-- The email leads when only one has to. It is what an account is claimed
-- with here; a phone can be an office line three people answer.
--
-- TWO: AN UNBOUNDED SEAT, REPORTED AS A CONTRACT.
--
-- The same award seated sg.other+2 with contract_id null, and the screen
-- said "the contract is a placeholder until you agree the terms". There was
-- no contract. fn_members_ensure_contract declines to write a payable
-- contract to anyone carrying party_class_links 'our_entity' or 'customer' -
-- you do not invoice yourself, and sg.other+2 is classed a customer - and it
-- swallows the decision quietly, leaving the seat unbounded.
--
-- The trigger's rule is right. 106 not knowing about it was wrong, twice
-- over: it created the one thing this system refuses to have (a contractor
-- seat with no contract behind it) and then described terms that did not
-- exist. So the award now asks the same question the trigger asks, before
-- it seats anybody, and stands down with the reason - and, as a backstop,
-- re-reads the contract afterwards and undoes its own seat rather than
-- leave one hanging.

-- ---------------------------------------------------------------------------
create or replace function public.portal_award_trade(
  p_project uuid,
  p_contact uuid,
  p_trade text default null,
  p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_member uuid; v_contract uuid; v_company uuid; v_name text;
  v_trade text := nullif(btrim(coalesce(p_trade, '')), '');
  v_made boolean := false;
begin
  perform public.assert_own_hands();
  if public.current_app_user_id() is null then
    return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.');
  end if;
  if p_project is null or p_contact is null then
    return jsonb_build_object('ok', false, 'reason', 'Say which job and who is taking it.');
  end if;
  -- Handing out work on a job is the GC's to do, and can_edit_project is the
  -- one place that decides who that is.
  if not public.can_edit_project(p_project) then
    return jsonb_build_object('ok', false, 'reason', 'Awarding work on this job is not yours to do.');
  end if;
  if not public.portal_task_takes_tasks(p_project) then
    return jsonb_build_object('ok', false, 'reason',
      'Work is awarded on a project, not on the property itself. Pick the job under it.');
  end if;

  select coalesce(c.person_name, c.name), c.company_id into v_name, v_company
    from public.contacts c where c.id = p_contact and c.disabled_at is null;
  if v_name is null then
    return jsonb_build_object('ok', false, 'reason', 'That person is not on file.');
  end if;
  if v_trade is not null and not exists (select 1 from public.trades t where t.trade = v_trade) then
    return jsonb_build_object('ok', false, 'reason', format('"%s" is not a trade on file.', v_trade));
  end if;

  -- OUR OWN SIDE OF THE BOOK. Exactly the test fn_members_ensure_contract
  -- makes before it writes the placeholder contract - asked here, out loud,
  -- so the two can never disagree about what happened.
  if exists (select 1 from public.party_class_links l
              where l.class_code in ('our_entity','customer')
                and (l.contact_id = p_contact
                  or (v_company is not null and l.company_id = v_company))) then
    return jsonb_build_object('ok', false, 'code', 'OWN_SIDE', 'who', v_name, 'reason',
      v_name || ' is on our own side of the book - a customer, or our own entity - so no payable '
      || 'contract can be written to them, and a contractor seat with nothing behind it is the one '
      || 'thing this refuses to create. Awarding is for the people you pay. Somebody on our side who '
      || 'is running the job belongs on it as a site project manager instead.');
  end if;

  -- The trade is a fact about them, not about this job, so it is recorded
  -- where their trades live - and it is what the seat's contract will be
  -- typed from.
  if v_trade is not null and not exists (
      select 1 from public.contact_trade_roles r where r.contact_id = p_contact and r.trade = v_trade) then
    insert into public.contact_trade_roles (contact_id, trade) values (p_contact, v_trade)
    on conflict do nothing;
  end if;

  -- The seat. Already seated is not an error - awarding a second trade to
  -- somebody already on the job is an ordinary thing to do.
  select id, contract_id into v_member, v_contract
    from public.project_members
   where project_id = p_project and contact_id = p_contact and status <> 'removed'
   limit 1;

  if v_member is null then
    -- chk_project_members_one_party: the contact OR the company, never both.
    insert into public.project_members
      (project_id, contact_id, role, project_role, status, joined_on, notes)
    values (p_project, p_contact, 'collaborator', 'contractor', 'active', current_date,
            coalesce(nullif(btrim(p_note), ''),
                     'Awarded' || coalesce(' the ' || lower(v_trade), '') || ' directly - no bid round.'))
    returning id, contract_id into v_member, v_contract;
    v_made := true;
  else
    update public.project_members
       set status = 'active', left_on = null
     where id = v_member and status <> 'active';
  end if;

  -- fn_members_ensure_contract fills contract_id in on its own, after this
  -- statement's RETURNING has already been taken, so read it back.
  if v_contract is null then
    select contract_id into v_contract from public.project_members where id = v_member;
  end if;

  -- Still nothing: the trigger declined or failed, and its reason is in
  -- system_trigger_errors. Undo our own seat rather than leave an unbounded
  -- one, and say so - never report terms that were not written.
  if v_contract is null then
    if v_made then delete from public.project_members where id = v_member; end if;
    return jsonb_build_object('ok', false, 'code', 'UNBOUNDED', 'who', v_name, 'reason',
      v_name || ' could not be given a contract, so the seat was '
      || case when v_made then 'not created' else 'left as it was' end
      || '. Nothing is awarded without one.'
      || coalesce(' The reason recorded was: ' ||
           (select e.message from public.system_trigger_errors e
             where e.trigger_fn = 'fn_members_ensure_contract' and e.row_id = v_member
             order by e.at desc limit 1), ''));
  end if;

  -- Name the trade on the contract when the trigger could not - it takes the
  -- first trade it finds, and the one we were handed is the one that matters.
  if v_contract is not null and v_trade is not null then
    update public.contracts
       set trade = coalesce(trade, v_trade),
           contract_type = case when contract_type = 'service agreement'
                                then 'construction trade contract' else contract_type end
     where id = v_contract;
  end if;

  return jsonb_build_object('ok', true, 'seated', v_made, 'member_id', v_member,
                            'contract_id', v_contract, 'bounded', v_contract is not null,
                            'who', v_name, 'trade', v_trade);
end $fn$;

comment on function public.portal_award_trade(uuid, uuid, text, text) is
  'Hands a trade the work on one job, with no bid round: seats them as a contractor and returns the contract the seat is bounded by, for the terms to be filled in. Refuses anyone on our own side of the book, and undoes its own seat rather than leave one without a contract. The GC test is can_edit_project.';

-- ---------------------------------------------------------------------------
create or replace function public.portal_award_add_trade(
  p_project uuid,
  p_name text,
  p_trade text default null,
  p_company text default null,
  p_phone text default null,
  p_email text default null,
  p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_name  text := nullif(btrim(coalesce(p_name, '')), '');
  v_co    text := nullif(btrim(coalesce(p_company, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
  v_contact uuid; v_company uuid; v_matched text; v_found text; r jsonb;
  v_by_email uuid; v_by_phone uuid; v_email_name text; v_phone_name text;
begin
  perform public.assert_own_hands();
  if public.current_app_user_id() is null then
    return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.');
  end if;
  if not public.can_edit_project(p_project) then
    return jsonb_build_object('ok', false, 'reason', 'Awarding work on this job is not yours to do.');
  end if;
  if v_name is null then
    return jsonb_build_object('ok', false, 'reason', 'Give them a name.');
  end if;

  -- WHO IS THIS. Both identifiers are looked up before either is believed,
  -- because the only dangerous case is the one where they disagree.
  if v_email is not null then
    select c.id, coalesce(c.person_name, c.name) into v_by_email, v_email_name
      from public.contacts c
     where c.disabled_at is null and lower(c.email_a) = lower(v_email)
     limit 1;
  end if;
  if v_phone is not null then
    select c.id, coalesce(c.person_name, c.name) into v_by_phone, v_phone_name
      from public.contacts c
     where c.disabled_at is null and public.phone_key(c.phone) = public.phone_key(v_phone)
     limit 1;
  end if;

  if v_by_email is not null and v_by_phone is not null and v_by_email <> v_by_phone then
    -- Two people. Picking one would award somebody's work to a stranger.
    return jsonb_build_object('ok', false, 'code', 'CONFLICT', 'reason',
      'That email is ' || v_email_name || ' and that number is ' || v_phone_name
      || ' - two different people on file. Leave whichever one is wrong blank, or pick them from the list.');
  end if;

  -- The email leads: it is what an account here is claimed with, and a phone
  -- can be an office line that three people answer.
  if v_by_email is not null then
    v_contact := v_by_email; v_found := v_email_name; v_matched := 'email';
  elsif v_by_phone is not null then
    v_contact := v_by_phone; v_found := v_phone_name; v_matched := 'phone';
  else
    select c.id, coalesce(c.person_name, c.name) into v_contact, v_found
      from public.contacts c
     where c.disabled_at is null
       and lower(btrim(coalesce(c.person_name, c.name))) = lower(v_name)
     limit 1;
    if v_contact is not null then v_matched := 'name'; end if;
  end if;

  if v_contact is null then
    -- The company, by the same tests. A company nobody has is made; one whose
    -- number we already hold is the one we already hold.
    if v_co is not null then
      if v_email is not null then
        select id into v_company from public.companies
         where lower(main_email) = lower(v_email) limit 1;
      end if;
      if v_company is null and v_phone is not null then
        select id into v_company from public.companies
         where public.phone_key(main_phone) = public.phone_key(v_phone) limit 1;
      end if;
      if v_company is null then
        select id into v_company from public.companies
         where lower(btrim(company_name)) = lower(v_co) limit 1;
      end if;
      if v_company is null then
        begin
          insert into public.companies (company_name, main_phone, main_email, source, created_by, needs_review)
          values (v_co, v_phone, v_email, 'pro-app:award', 'pro-app:award', true)
          returning id into v_company;
        exception when unique_violation then
          -- Somebody else got there between the look and the leap. Take
          -- theirs; a second company for the same number would be the bug.
          select id into v_company from public.companies
           where public.phone_key(main_phone) = public.phone_key(v_phone)
              or lower(main_email) = lower(v_email)
              or lower(btrim(company_name)) = lower(v_co)
           limit 1;
        end;
      end if;
    end if;

    begin
      insert into public.contacts (name, person_name, phone, email_a, company_id, source, created_by)
      values (v_name, v_name, v_phone, v_email, v_company, 'pro-app:award', 'pro-app:award')
      returning id into v_contact;
      v_matched := 'new';
    exception when unique_violation then
      -- Somebody claimed this identity between the look and the leap.
      select c.id, coalesce(c.person_name, c.name),
             case when v_email is not null and lower(c.email_a) = lower(v_email) then 'email' else 'phone' end
        into v_contact, v_found, v_matched
        from public.contacts c
       where (v_email is not null and lower(c.email_a) = lower(v_email))
          or (v_phone is not null and public.phone_key(c.phone) = public.phone_key(v_phone))
       limit 1;
      if v_contact is null then
        return jsonb_build_object('ok', false, 'reason',
          'That phone or email is already on somebody else''s record. Check it, or pick them from the list.');
      end if;
    end;
  end if;

  r := public.portal_award_trade(p_project, v_contact, p_trade, p_note);
  if coalesce((r->>'ok')::boolean, false) and v_matched is not null and v_matched <> 'new' then
    -- Say so out loud when the person awarded is not the name he typed.
    r := r || jsonb_build_object('matched', v_matched,
      'matched_note', case when lower(coalesce(v_found, '')) = lower(v_name) then null
        else case v_matched
          when 'email' then 'That email is already ' || v_found || ' — awarded to them.'
          when 'phone' then 'That number is already ' || v_found || ' — awarded to them.'
          else null end end);
  end if;
  return r;
end $fn$;

comment on function public.portal_award_add_trade(uuid, text, text, text, text, text, text) is
  'Awards a trade to somebody not on file yet. Identifies them by email, then phone, then name - and refuses when the email and the phone name two different people rather than picking one. Says how it matched.';

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
