-- 106. A GC CAN HAND A TRADE THE WORK.
--
-- Shahar (2026-09-14): "as a GC i'd like to award business. how do i do this?
-- i'd like to award the electric work to Franklin."
--
-- Asked which shape he wanted, he picked: hand it straight to him. No bid
-- round, no invitations, no comparing numbers - he has chosen the electrician
-- and wants the job to say so.
--
-- The database could already do every part of this and had no way to say it
-- in one move. Seating a party whose seat needs a contract already creates a
-- placeholder contract (fn_members_ensure_contract), which is exactly the
-- right behaviour: a seat that is not bounded by a contract is how somebody
-- ends up on a job with no terms. What was missing was one governed call that
-- does the seating, names the trade, and hands back the contract to fill in -
-- so a screen never has to write project_members by hand, and neither does
-- anybody with a service key.
--
-- What this does NOT do, deliberately: agree a price. The contract comes back
-- as a placeholder with no value and no scope, because the GC saying "it's
-- yours" and the two of them agreeing terms are two different days. The
-- financials screen is where the second one happens.
create or replace function public.portal_award_trade(
  p_project uuid,
  p_contact uuid,
  p_trade text default null,
  p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
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
                            'contract_id', v_contract, 'who', v_name, 'trade', v_trade);
end $$;

comment on function public.portal_award_trade(uuid, uuid, text, text) is
  'Hands a trade the work on one job, with no bid round: seats them as a contractor and returns the contract the seat is bounded by, for the terms to be filled in. The GC test is can_edit_project.';

grant execute on function public.portal_award_trade(uuid, uuid, text, text) to authenticated;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
