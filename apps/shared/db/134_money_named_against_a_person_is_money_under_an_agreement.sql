-- 134. MONEY NAMED AGAINST A PERSON IS MONEY UNDER AN AGREEMENT.
--
-- Shahar (2026-09-15): "should be forced by trigger as well as handled by the
-- UI."
--
-- The screen now offers to make a shell contract while nothing is agreed, and
-- a screen is a suggestion. This is the rule underneath it, and it is the same
-- rule fn_members_ensure_contract has enforced for SEATS since seats became
-- contract-bounded: you cannot be on a job without an agreement, even a blank
-- one, because the blank one is what the real terms get written into.
--
-- WHAT CAN ACTUALLY BE FORCED. Not "every Build has a contract" - a build is
-- written down before anybody has been chosen, and refusing it would stop the
-- one thing this app is for, which is writing work down on site in ten
-- seconds. What CAN be forced is the moment the task first names somebody to
-- pay: at that point there is a person, a job and an amount, which is a
-- commitment whatever it is called, and there is now something to put on the
-- other side of a contract.
--
--   pay_to_contact_id set, contract_id null  ->  bind it to one, making a
--                                                placeholder if none exists.
--
-- It reuses the contract already on the job for that party where there is
-- one, so this never makes a second agreement with somebody you have already
-- signed. Our own entity and the customer are skipped, exactly as the seats
-- trigger skips them: you do not contract with yourself.
--
-- BEFORE INSERT and BEFORE UPDATE, so the id is on the row rather than
-- written by a second statement a moment later - and wrapped, like the seats
-- trigger, so a task is never lost because a contract could not be made. The
-- failure is recorded in system_trigger_errors and the task survives
-- unbounded, which is the right way round: losing the work is worse than
-- losing the binding.
create or replace function public.fn_actions_ensure_contract()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_contract uuid; v_entity uuid; v_name text; v_trade text; v_type text;
begin
  if new.contract_id is not null then return new; end if;
  if new.pay_to_contact_id is null then return new; end if;
  if new.project_id is null then return new; end if;
  if tg_op = 'UPDATE' and old.pay_to_contact_id is not distinct from new.pay_to_contact_id then
    return new;
  end if;

  -- You do not contract with yourself, or with the person paying you.
  if exists (select 1 from public.party_class_links l
              where l.class_code in ('our_entity','customer')
                and l.contact_id = new.pay_to_contact_id) then
    return new;
  end if;

  begin
    -- The agreement already on this job with that party, signed ones first.
    select c.id into v_contract
      from public.contracts c
     where c.project_id = new.project_id
       and c.counterparty_contact_id = new.pay_to_contact_id
     order by case when c.status in ('signed','awarded','active','Active') then 0 else 1 end,
              c.created_at
     limit 1;

    if v_contract is null then
      v_entity := public.project_signing_entity(new.project_id);
      select coalesce(ct.person_name, ct.name) into v_name
        from public.contacts ct where ct.id = new.pay_to_contact_id;
      -- The task's own trade if it has one, else whatever the party is known
      -- for. A trade makes it a trade contract; nothing makes it a service.
      v_trade := coalesce(new.trade,
        (select tr.trade from public.contact_trade_roles tr
          where tr.contact_id = new.pay_to_contact_id limit 1));
      v_type := case when v_trade is not null then 'construction trade contract'
                     else 'service agreement' end;

      insert into public.contracts
        (title, contract_type, status, direction, project_id, trade,
         signer_company_id, signer_contact_id, counterparty_contact_id,
         created_by, last_modified_by, notes)
      values (
        coalesce(v_name, 'Unnamed party') || coalesce(' - ' || v_trade, '') || ' (placeholder)',
        v_type, 'placeholder', 'payable', new.project_id, v_trade,
        v_entity,
        case when v_entity is null then (select u.contact_id from public.app_users u
                                          where u.id = public.current_app_user_id()) end,
        new.pay_to_contact_id,
        'system: task payee', 'system: task payee',
        'Created automatically the moment a task first named somebody to pay, so the money is agreement-bounded '
        || 'from the start (migration 134). Status is placeholder: no value agreed, no scope, nothing signed. '
        || 'Replace the terms when the real agreement exists - do not create a second contract.')
      returning id into v_contract;
    end if;

    new.contract_id := v_contract;

  exception when others then
    insert into public.system_trigger_errors (trigger_fn, row_id, sqlstate, message)
    values ('fn_actions_ensure_contract', new.id, sqlstate,
            'Task left UNBOUNDED - no contract could be made for its payee: ' || sqlerrm);
  end;

  return new;
end $function$;

comment on function public.fn_actions_ensure_contract() is
'A task that names somebody to pay is bound to a contract with them - the one already on the job if there is one, else a placeholder in the same shape fn_members_ensure_contract writes for a seat. Never refuses the task: a contract that cannot be made is recorded in system_trigger_errors and the work survives unbounded, because losing the work is worse than losing the binding.';

-- After the money trigger, which is what decides whether a payee survives on
-- the row at all (fn_actions_money_fits_type clears a payee off a kind that
-- takes no money). Triggers of the same timing fire in name order, and
-- trg_actions_money_fits_type sorts before trg_actions_z_ensure_contract.
drop trigger if exists trg_actions_z_ensure_contract on public.actions;
create trigger trg_actions_z_ensure_contract
  before insert or update of pay_to_contact_id, contract_id, trade on public.actions
  for each row execute function public.fn_actions_ensure_contract();

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
