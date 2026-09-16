-- 154. AN AWARD CAN LAND ON A CONTRACT THAT ALREADY EXISTS.
--
-- Shahar (2026-09-16): "i believe previous design allowed me to award to an
-- existing contract, or open a new contract if necessary. if this is not
-- built this way, please add this capability so i can document few closed
-- contracts, including pest control."
--
-- He is right about the design and wrong about what it did. The intention
-- has been there since migration 106: seating somebody fires
-- fn_members_ensure_contract, which LOOKS for a contract with that party on
-- that job before writing a placeholder. It looked in the wrong place. A real
-- contract on 55 Walnut names the COMPANY as counterparty and the person as
-- contractor_id - "Masonry - Valdez D&H Construction LLC (David Valdez)" -
-- while the seat the award screen writes is a PERSON seat. The trigger
-- compared counterparty_contact_id with the seat's contact and never matched,
-- so every award opened a fresh placeholder next to the signed contract it
-- should have found. Eleven of them on New build today: David Valdez sits on
-- "David Valdez - Masonry (placeholder)" with the $52,000 Masonry contract
-- two rows away, and the board reports "terms not agreed yet" about a man
-- whose terms were signed in August.
--
-- Three things, then:
--
-- 1. THE AWARD SCREEN CAN NAME THE CONTRACT. portal_award_trade takes a
--    p_contract. When given, the seat is bound to that contract and no
--    placeholder is opened; the person may be left out and is read off the
--    contract; the trade is written onto the contract when it has none
--    ("Pest control - 55 Walnut" has no trade, which is why the Pest Control
--    tile does not know about it); and a person, a trade or a job that
--    contradicts the contract is refused with the contradiction spelled out.
--    A seat already sitting on a placeholder is MOVED to the named contract,
--    because that is the exact repair the eleven duplicates need.
--
-- 2. THE TRIGGER LOOKS WHERE THE CONTRACTS ARE. contractor_id, and the
--    counterparty company the seat's contact works for, count as a match. A
--    closed contract (Complete, Cancelled) is never bound to automatically -
--    new work on a finished agreement is a new agreement, and only an explicit
--    pick may say otherwise. Live beats placeholder; a base contract beats
--    its change orders.
--
-- 3. DONE IS A STATE. A trade whose only contract is Complete and which has
--    nothing open was reading as "not started", which is the opposite of
--    the truth. The spine now says "done" and the trade screen stops offering
--    to appoint somebody for work that was finished in May.
--
-- portal_award_board returns the job's contracts so the screen has something
-- to pick from.
--
-- OVERLOAD RULE (BUILD.md §16): portal_award_trade gains a parameter, so the
-- old four-argument signature is dropped here, in the same migration.
--
-- Applied three times: "an_award_can_land_on_a_contract_that_already_exists",
-- then "..._b" carrying the two fixes the probe found (the NULL in the party
-- check; the taken-off seat), then "..._c" renaming the spine flag to
-- 'finished' because 'done' was already the closed-task count. This file is
-- the corrected whole; the live definition is the record.

-- ---------------------------------------------------------------------------
-- 1. portal_award_trade: an existing contract as the target.
-- ---------------------------------------------------------------------------
drop function if exists public.portal_award_trade(uuid, uuid, text, text);

create or replace function public.portal_award_trade(
  p_project uuid, p_contact uuid, p_trade text default null, p_note text default null,
  p_contract uuid default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_member uuid; v_contract uuid; v_company uuid; v_name text;
  v_trade text := nullif(btrim(coalesce(p_trade, '')), '');
  v_made boolean := false;
  v_contact uuid := p_contact;
  c public.contracts%rowtype;   -- the contract named, when one was
  v_known text;                 -- that contract's trade as the catalogue spells it
  v_seat_contract uuid;         -- what an existing seat was bound to
  v_rebound_from uuid;          -- the placeholder a seat was moved off
  v_party text;
  v_old uuid; v_old_notes text; v_old_joined date;   -- a seat taken off earlier
begin
  perform public.assert_own_hands();
  if public.current_app_user_id() is null then
    return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.');
  end if;
  if p_project is null or (p_contact is null and p_contract is null) then
    return jsonb_build_object('ok', false, 'reason', 'Say which job and who is taking it.');
  end if;
  if not public.can_edit_project(p_project) then
    return jsonb_build_object('ok', false, 'reason', 'Awarding work on this job is not yours to do.');
  end if;
  if not public.portal_task_takes_tasks(p_project) then
    return jsonb_build_object('ok', false, 'reason',
      'Work is awarded on a project, not on the property itself. Pick the job under it.');
  end if;

  -- THE CONTRACT THAT ALREADY EXISTS. Checked before the person, because the
  -- person may be read off it.
  if p_contract is not null then
    select * into c from public.contracts where id = p_contract;
    if c.id is null then
      return jsonb_build_object('ok', false, 'reason', 'That contract is not on file.');
    end if;
    if c.project_id is distinct from p_project then
      return jsonb_build_object('ok', false, 'reason',
        format('"%s" belongs to another job. Award from that job, or open a new contract here.', c.title));
    end if;
    if c.direction <> 'payable' then
      return jsonb_build_object('ok', false, 'reason',
        format('"%s" is money coming in, not work going out.', c.title));
    end if;
    if c.status = 'Cancelled' then
      return jsonb_build_object('ok', false, 'reason',
        format('"%s" was cancelled. Nothing is awarded on a cancelled contract.', c.title));
    end if;

    v_party := coalesce(
      (select co.company_name from public.companies co where co.id = c.counterparty_company_id),
      (select coalesce(ct.person_name, ct.name) from public.contacts ct
        where ct.id = coalesce(c.contractor_id, c.counterparty_contact_id)));

    if v_contact is null then
      v_contact := coalesce(c.contractor_id, c.counterparty_contact_id);
      if v_contact is null and c.counterparty_company_id is not null then
        select ct.id into v_contact from public.contacts ct
         where ct.company_id = c.counterparty_company_id and ct.disabled_at is null
         order by ct.created_at limit 1;
      end if;
      if v_contact is null then
        return jsonb_build_object('ok', false, 'code', 'WHO', 'reason',
          format('"%s" names nobody yet. Say who is taking it.', c.title));
      end if;
    end if;
  end if;

  select coalesce(ct.person_name, ct.name), ct.company_id into v_name, v_company
    from public.contacts ct where ct.id = v_contact and ct.disabled_at is null;
  if v_name is null then
    return jsonb_build_object('ok', false, 'reason', 'That person is not on file.');
  end if;

  if p_contract is not null then
    -- THE PERSON MUST BE THE CONTRACT'S OWN PARTY - themselves, or somebody
    -- at the company it is with. A placeholder with nobody on it yet takes
    -- whoever is named. Every leg is coalesced: a contract with no
    -- counterparty_contact_id makes "= v_contact" NULL, and NOT NULL is not
    -- true, so the first cut let Mark Jovic onto the pest-control contract.
    if not (coalesce(c.contractor_id = v_contact, false)
         or coalesce(c.counterparty_contact_id = v_contact, false)
         or coalesce(c.counterparty_company_id = v_company, false)
         or (c.counterparty_company_id is null and c.counterparty_contact_id is null)) then
      return jsonb_build_object('ok', false, 'code', 'WRONG_PARTY', 'reason',
        format('"%s" is with %s, not %s. Pick their own contract, or leave the contract on "new".',
               c.title, coalesce(v_party, 'somebody else'), v_name));
    end if;

    -- THE TRADE MUST NOT CONTRADICT THE CONTRACT. No trade on the contract:
    -- the chosen one is written onto it. A trade the catalogue knows: it must
    -- be the chosen one. A trade the catalogue does not know ("asbestos
    -- abatement"): it must at least resemble the chosen one, and is then
    -- replaced by the catalogue spelling so the spine can find it.
    select t.trade into v_known from public.trades t
     where lower(t.trade) = lower(btrim(coalesce(c.trade, ''))) limit 1;
    if v_trade is null then
      v_trade := v_known;
    elsif c.trade is not null then
      if v_known is not null and v_known <> v_trade then
        return jsonb_build_object('ok', false, 'code', 'WRONG_TRADE', 'reason',
          format('"%s" is a %s contract. Awarding %s on it would rewrite it - open a new one instead.',
                 c.title, lower(v_known), lower(v_trade)));
      elsif v_known is null and not public.trade_matches(c.trade, v_trade) then
        return jsonb_build_object('ok', false, 'code', 'WRONG_TRADE', 'reason',
          format('"%s" says its trade is "%s", which is not %s. Open a new contract, or fix the trade on the money screen first.',
                 c.title, c.trade, lower(v_trade)));
      end if;
    end if;
  end if;

  if v_trade is not null and not exists (select 1 from public.trades t where t.trade = v_trade) then
    return jsonb_build_object('ok', false, 'reason', format('"%s" is not a trade on file.', v_trade));
  end if;

  -- OUR OWN SIDE OF THE BOOK. Exactly the test fn_members_ensure_contract
  -- makes before it writes the placeholder contract - asked here, out loud,
  -- so the two can never disagree about what happened.
  if exists (select 1 from public.party_class_links l
              where l.class_code in ('our_entity','customer')
                and (l.contact_id = v_contact
                  or (v_company is not null and l.company_id = v_company))) then
    return jsonb_build_object('ok', false, 'code', 'OWN_SIDE', 'who', v_name, 'reason',
      v_name || ' is on our own side of the book - a customer, or our own entity - so no payable '
      || 'contract can be written to them, and a contractor seat with nothing behind it is the one '
      || 'thing this refuses to create. Awarding is for the people you pay. Somebody on our side who '
      || 'is running the job belongs on it as a site project manager instead.');
  end if;

  if v_trade is not null and not exists (
      select 1 from public.contact_trade_roles r where r.contact_id = v_contact and r.trade = v_trade) then
    insert into public.contact_trade_roles (contact_id, trade) values (v_contact, v_trade)
    on conflict do nothing;
  end if;

  select id, contract_id into v_member, v_seat_contract
    from public.project_members
   where project_id = p_project and contact_id = v_contact and status <> 'removed'
   limit 1;

  -- A SEAT THAT WAS TAKEN OFF. Twenty-three of them today, every one a past
  -- contractor with no contract behind the seat - "Tree removal - Bergenfield
  -- Tree Services, complete" - which is precisely who gets awarded again when
  -- past work is being documented. The unique index counts a null contract
  -- as a value, so a fresh seat beside the old one is refused. The old row
  -- goes, its note travels onto the new one, and the change log keeps the
  -- row itself; a plain reactivation would skip the insert trigger and
  -- leave the seat unbounded, which is the one thing an award may not do.
  if v_member is null then
    select id, notes, joined_on into v_old, v_old_notes, v_old_joined
      from public.project_members
     where project_id = p_project and contact_id = v_contact and status = 'removed'
     order by created_at desc limit 1;
    if v_old is not null then
      delete from public.project_members where id = v_old;
    end if;
  end if;

  if v_member is null then
    -- The contract goes in with the seat, so the trigger has nothing to
    -- invent. A seat documenting a past contract dates from when that
    -- contract began, not from today.
    insert into public.project_members
      (project_id, contact_id, role, project_role, status, joined_on, notes, contract_id)
    values (p_project, v_contact, 'collaborator', 'contractor', 'active',
            case when p_contract is not null
                 then coalesce(c.start_date, c.signed_date, c.awarded_date, v_old_joined, current_date)
                 else coalesce(v_old_joined, current_date) end,
            left(coalesce(nullif(btrim(p_note), ''),
                     case when p_contract is not null
                          then 'Awarded on "' || c.title || '"' || coalesce(' - ' || lower(v_trade), '') || '.'
                          else 'Awarded' || coalesce(' the ' || lower(v_trade), '') || ' directly - no bid round.' end)
                 || coalesce(' | Earlier seat: ' || nullif(btrim(v_old_notes), ''), ''), 2000),
            p_contract)
    returning id, contract_id into v_member, v_contract;
    v_made := true;
  else
    update public.project_members
       set status = 'active', left_on = null
     where id = v_member and status <> 'active';
    v_contract := v_seat_contract;

    -- A SEAT ON A PLACEHOLDER, WHEN THE REAL CONTRACT WAS JUST NAMED: move
    -- it. This is the repair for every duplicate the old trigger opened. A
    -- seat already on a live contract stays where it is - the person simply
    -- holds two agreements, which is ordinary.
    if p_contract is not null and v_seat_contract is distinct from p_contract then
      if v_seat_contract is null
         or exists (select 1 from public.contracts x where x.id = v_seat_contract and x.status = 'placeholder') then
        update public.project_members set contract_id = p_contract where id = v_member;
        v_rebound_from := v_seat_contract;
        v_contract := p_contract;
      end if;
    end if;
  end if;

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

  if p_contract is not null then
    -- What the pick teaches the contract: its trade, when it had none or
    -- spelled it its own way; its party, when it was a placeholder with none.
    update public.contracts
       set trade = case when v_trade is not null and (trade is null or v_known is null) then v_trade else trade end,
           counterparty_contact_id = case when counterparty_company_id is null and counterparty_contact_id is null
                                          then v_contact else counterparty_contact_id end
     where id = p_contract;
  elsif v_trade is not null then
    update public.contracts
       set trade = coalesce(trade, v_trade),
           contract_type = case when contract_type = 'service agreement'
                                then 'construction trade contract' else contract_type end
     where id = v_contract;
  end if;

  return jsonb_build_object('ok', true, 'seated', v_made, 'member_id', v_member,
                            'contract_id', v_contract, 'bounded', v_contract is not null,
                            'who', v_name, 'trade', v_trade,
                            'existing', p_contract is not null,
                            'returned', v_old is not null,
                            'contract_title', case when p_contract is not null then c.title end,
                            'contract_status', case when p_contract is not null then c.status end,
                            'rebound_from', v_rebound_from,
                            'rebound_from_title', (select x.title from public.contracts x where x.id = v_rebound_from));
end $$;

comment on function public.portal_award_trade(uuid, uuid, text, text, uuid) is
  'Seat a person on a job as a contractor. With p_contract the seat is bound to that existing contract (a closed one included - that is how past work is documented), the person may be read off it, and the trade is written onto it when it has none; a seat on a placeholder is moved to it. Without, the trigger finds or opens a placeholder.';

-- ---------------------------------------------------------------------------
-- 2. The trigger looks where the contracts actually are.
-- ---------------------------------------------------------------------------
create or replace function public.fn_members_ensure_contract()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_contract uuid; v_entity uuid; v_name text; v_trade text; v_type text;
begin
  if new.contract_id is not null then return new; end if;
  if not public.seat_needs_contract(new.project_role) then return new; end if;
  if new.project_id is null then return new; end if;

  if exists (select 1 from public.party_class_links l
              where l.class_code in ('our_entity','customer')
                and (l.contact_id = new.contact_id or l.company_id = new.company_id)) then
    return new;
  end if;

  begin
    -- A real contract names the company and puts the person on contractor_id;
    -- a seat names the person. Both spellings of the same party match (154).
    -- A finished or cancelled contract is never picked up automatically: new
    -- work on a closed agreement is a new agreement. Live before placeholder,
    -- the base contract before its change orders.
    select c.id into v_contract
      from public.contracts c
     where c.project_id = new.project_id
       and c.direction = 'payable'
       and coalesce(c.status, '') not in ('Complete', 'Cancelled')
       and ( (new.company_id is not null and c.counterparty_company_id = new.company_id)
          or (new.contact_id is not null
              and (c.counterparty_contact_id = new.contact_id
                   or c.contractor_id = new.contact_id
                   or (c.counterparty_company_id is not null
                       and c.counterparty_company_id = (select ct.company_id from public.contacts ct
                                                          where ct.id = new.contact_id)))) )
     order by case when c.status in ('signed','awarded','active','Active') then 0 else 1 end,
              case when c.contract_type = 'change order' then 1 else 0 end,
              c.created_at
     limit 1;

    if v_contract is null then
      v_entity := public.project_signing_entity(new.project_id);

      select coalesce(co.company_name, ct.name, 'Unnamed party') into v_name
        from (select 1) z
        left join public.companies co on co.id = new.company_id
        left join public.contacts  ct on ct.id = new.contact_id;

      select tr.trade into v_trade from (
        select trade from public.company_trade_roles where company_id = new.company_id
        union all
        select trade from public.contact_trade_roles where contact_id = new.contact_id
      ) tr limit 1;

      v_type := case when v_trade is not null then 'construction trade contract'
                     else 'service agreement' end;

      insert into public.contracts
        (title, contract_type, status, direction, project_id, trade,
         signer_company_id, counterparty_company_id, counterparty_contact_id,
         created_by, notes)
      values (
        v_name || coalesce(' - ' || v_trade, '') || ' (placeholder)',
        v_type, 'placeholder', 'payable', new.project_id, v_trade,
        v_entity, new.company_id, new.contact_id,
        'system: seat',
        'Created automatically when this party was seated on the project, so the seat is contract-bounded from the start. ' ||
        'Status is placeholder: no value, no scope, nothing agreed. Replace the terms when the real agreement exists - do not create a second contract.')
      returning id into v_contract;
    end if;

    update public.project_members
       set contract_id = v_contract
     where id = new.id and contract_id is null;

  exception when others then
    insert into public.system_trigger_errors (trigger_fn, row_id, sqlstate, message)
    values ('fn_members_ensure_contract', new.id, sqlstate,
            'Seat created UNBOUNDED - no contract could be made: ' || sqlerrm);
  end;

  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 3. The board lists the job's contracts, so there is something to pick.
-- ---------------------------------------------------------------------------
create or replace function public.portal_award_board(p_project uuid)
returns jsonb
language sql stable security definer set search_path to 'public'
as $$
  select jsonb_build_object(
    'project_id', p_project,
    'project_name', (select project_name from public.projects where id = p_project),
    'may_award', public.can_edit_project(p_project),
    'takes_work', public.portal_task_takes_tasks(p_project),

    'needs', case when not public.can_edit_project(p_project) then '[]'::jsonb else coalesce((
      select jsonb_agg(distinct n.trade)
        from public.project_bid_needs n
        join public.trades t on t.trade = n.trade
       where n.project_id = p_project
         and n.kind = 'trade'
         and t.is_worker_trade), '[]'::jsonb) end,

    -- A seat held by a login with no contact row is named from app_users -
    -- it is still a person, and "Someone" was never the answer.
    'awarded', case when not public.can_edit_project(p_project) then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
               'member_id', pm.id,
               'contact_id', pm.contact_id,
               'name', coalesce(ct.person_name, ct.name, co2.company_name, u.full_name, u.email, 'Unnamed seat'),
               'company', co.company_name,
               'seat', pm.project_role,
               'since', pm.joined_on,
               'contract_id', pm.contract_id,
               'contract', c.title,
               'contract_status', c.status,
               'may_remove', pm.project_role is distinct from 'asset owner',
               'trade', coalesce(c.trade, (select r.trade from public.contact_trade_roles r
                                            where r.contact_id = pm.contact_id limit 1)))
             order by coalesce(c.trade, 'zz'), coalesce(ct.person_name, ct.name, u.full_name, u.email))
        from public.project_members pm
        left join public.contacts ct on ct.id = pm.contact_id
        left join public.companies co on co.id = ct.company_id
        left join public.companies co2 on co2.id = pm.company_id
        left join public.app_users u on u.id = pm.app_user_id
        left join public.contracts c on c.id = pm.contract_id
       where pm.project_id = p_project
         and pm.status = 'active'
         and public.seat_needs_contract(pm.project_role)), '[]'::jsonb) end,

    -- EVERY PAYABLE CONTRACT ON THIS JOB, so an award can land on one that
    -- exists rather than opening a twin (154). Closed ones included: a
    -- finished contract with nobody seated on it is exactly the past work
    -- there is to document. Cancelled ones are shown and refused.
    'contracts', case when not public.can_edit_project(p_project) then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id,
               'title', c.title,
               'status', c.status,
               'type', c.contract_type,
               'trade', c.trade,
               'trade_known', (select t.trade from public.trades t
                                where lower(t.trade) = lower(btrim(coalesce(c.trade, ''))) limit 1),
               'amount', c.amount,
               'signed', coalesce(c.signed_date, c.awarded_date, c.start_date),
               'who', (select coalesce(ct.person_name, ct.name) from public.contacts ct
                        where ct.id = coalesce(c.contractor_id, c.counterparty_contact_id)),
               'company', (select co.company_name from public.companies co
                            where co.id = c.counterparty_company_id),
               'seats', (select count(*) from public.project_members pm
                          where pm.contract_id = c.id and pm.status = 'active'))
             order by case c.status when 'signed' then 0 when 'awarded' then 0 when 'active' then 0 when 'Active' then 0
                                    when 'Complete' then 1 when 'placeholder' then 2 else 3 end,
                      c.title)
        from public.contracts c
       where c.project_id = p_project
         and c.direction = 'payable'), '[]'::jsonb) end,

    'people', case when not public.can_edit_project(p_project) then '[]'::jsonb else coalesce((
      select jsonb_agg(x order by x->>'name')
        from (
          select distinct jsonb_build_object(
            'contact_id', ct.id,
            'name', coalesce(ct.person_name, ct.name),
            'company', (select co.company_name from public.companies co where co.id = ct.company_id),
            'trades', coalesce((select jsonb_agg(r.trade order by r.trade)
                                  from public.contact_trade_roles r where r.contact_id = ct.id), '[]'::jsonb),
            'here', exists (select 1 from public.project_members pm
                             where pm.project_id = p_project and pm.contact_id = ct.id
                               and pm.status = 'active')) as x
            from public.contacts ct
           where ct.disabled_at is null
             and (exists (select 1 from public.project_members pm
                           join public.projects pr on pr.id = pm.project_id
                          where pm.contact_id = ct.id and pm.status = 'active'
                            and public.can_edit_project(pr.id))
               or exists (select 1 from public.transactions t
                           where t.project_id = p_project and t.contractor_id = ct.id))
        ) q), '[]'::jsonb) end
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. Done is a state on the spine.
-- ---------------------------------------------------------------------------
do $patch$
declare src text; out_ text; step text;
begin
  select pg_get_functiondef('public.portal_project_trades(uuid)'::regprocedure) into src;
  out_ := src;

  step := 'has_done';
  out_ := replace(out_,
    $a$bool_or(cv.status in ('signed','awarded','active','Active')) as has_award
    from covers cv group by cv.trade$a$,
    $b$bool_or(cv.status in ('signed','awarded','active','Active')) as has_award,
         bool_or(cv.status = 'Complete') as has_done
    from covers cv group by cv.trade$b$);
  if out_ = src then raise exception 'portal_project_trades has drifted at %', step; end if;
  src := out_;

  step := 'done flag';
  out_ := replace(out_,
    $a$'awarded', coalesce(ap.has_award, false),$a$,
    $b$'awarded', coalesce(ap.has_award, false),
      -- Finished under a contract that is now Complete, with nothing live
      -- behind it. Not 'done': that key is already the closed-task count,
      -- and jsonb_build_object keeps the last of two - which is how the
      -- first cut of this migration silently ate the count.
      'finished', coalesce(ap.has_done, false) and not coalesce(ap.has_award, false),$b$);
  if out_ = src then raise exception 'portal_project_trades has drifted at %', step; end if;
  src := out_;

  step := 'done state';
  out_ := replace(out_,
    $a$when r.n_open = 0 then 'idle'$a$,
    $b$when r.n_open = 0 and coalesce(ap.has_done, false) then 'done'
                 when r.n_open = 0 then 'idle'$b$);
  if out_ = src then raise exception 'portal_project_trades has drifted at %', step; end if;
  src := out_;

  step := 'who order';
  out_ := replace(out_,
    $a$order by case when cv.status in ('signed','awarded','active','Active') then 0 else 1 end,
                        cv.created_at$a$,
    $b$order by case when cv.status in ('signed','awarded','active','Active') then 0
                                 when cv.status = 'Complete' then 1 else 2 end,
                        cv.created_at$b$);
  if out_ = src then raise exception 'portal_project_trades has drifted at %', step; end if;

  execute out_;
end $patch$;

-- ---------------------------------------------------------------------------
-- The overload sweep (BUILD.md §16). Fails the migration if it ever finds
-- two signatures a single call could satisfy.
-- ---------------------------------------------------------------------------
do $sweep$
declare r record;
begin
  for r in
    select p.proname, count(*) as n
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
       and p.proname in ('portal_award_trade', 'portal_award_add_trade', 'portal_award_board',
                         'portal_project_trades', 'fn_members_ensure_contract')
     group by p.proname having count(*) > 1
  loop
    raise exception 'OVERLOAD: % has % signatures', r.proname, r.n;
  end loop;
end $sweep$;

update public.config
   set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
