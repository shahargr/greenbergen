-- 135. A PLACEHOLDER MAY NOT KNOW WHO IT IS WITH.
--
-- Shahar (2026-09-15), on the refusal the shell panel was giving him: "the
-- whole idea is to create a contract with target for transaction as place
-- holder as we don't know them yet."
--
-- He is right and migration 132 got this wrong. It read
-- chk_contracts_one_counterparty - exactly one of a company or a contact - as
-- a rule about contracts, and made the panel ask who it would be with. But
-- the counterparty is the ONE THING a shell contract exists to not know yet.
-- Asking for it is asking the question the placeholder was invented to
-- postpone: you write "Internal stairs, about $35,000" today and you find out
-- who is building them in three weeks.
--
-- SO THE CONSTRAINT MOVES RATHER THAN THE SCREEN. A contract with nobody on
-- the other side is allowed while it is a PLACEHOLDER, and only while it is.
-- The moment it becomes signed, awarded or active it must name somebody, the
-- way it always had to - which is where the integrity actually matters, since
-- that is the row money gets paid against.
--
-- Everything else the old constraint said still holds: never two
-- counterparties, and never a company and a person at once.
alter table public.contracts drop constraint if exists chk_contracts_one_counterparty;
alter table public.contracts add constraint chk_contracts_one_counterparty check (
  -- Nobody yet: only a placeholder may be in this state.
  (counterparty_company_id is null and counterparty_contact_id is null
   and coalesce(status, '') = 'placeholder')
  -- Or exactly one of the two, as before.
  or ((counterparty_company_id is null) <> (counterparty_contact_id is null))
);

comment on constraint chk_contracts_one_counterparty on public.contracts is
'A contract has exactly one other side - a company or a person, never both - EXCEPT while it is a placeholder, which may have neither. That is what a placeholder is for: the work is agreement-bounded from the day it is written down, and who it is with is filled in when it is known (migration 135). Anything past placeholder must name somebody, because that is the row money is paid against.';

-- And the door stops asking. p_counterparty and p_company_name are both
-- optional now; the title falls back to what the work is called, because
-- "(placeholder)" on its own tells a reader nothing.
create or replace function public.portal_contract_shell(
  p_project uuid, p_title text default null, p_trade text default null,
  p_counterparty uuid default null, p_company_name text default null,
  p_amount numeric default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  me uuid := public.current_app_user_id();
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_trade text := nullif(btrim(coalesce(p_trade, '')), '');
  v_co    text := nullif(btrim(coalesce(p_company_name, '')), '');
  v_entity uuid; v_signer_contact uuid; v_company uuid; v_who text; v_id uuid; v_label text;
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.'); end if;
  if not public.can_edit_project(p_project) then
    return jsonb_build_object('ok', false, 'reason', 'Adding a contract to this job is not yours to do.');
  end if;
  if v_trade is not null and not exists (select 1 from public.trades t where t.trade = v_trade) then
    return jsonb_build_object('ok', false, 'reason', format('"%s" is not a trade on file.', v_trade));
  end if;
  if p_amount is not null and p_amount < 0 then
    return jsonb_build_object('ok', false, 'reason', 'A contract value is a positive number, or nothing at all.');
  end if;

  -- WHO IT IS WITH, IF ANYBODY IS KNOWN YET. All three states are legitimate:
  -- a person on file, a company by name, or nobody at all.
  if p_counterparty is not null then
    select coalesce(c.person_name, c.name) into v_who
      from public.contacts c where c.id = p_counterparty and c.disabled_at is null;
    if v_who is null then
      return jsonb_build_object('ok', false, 'reason', 'That person is not on file.');
    end if;
  elsif v_co is not null then
    select id into v_company from public.companies
     where lower(btrim(company_name)) = lower(v_co) limit 1;
    if v_company is null then
      begin
        insert into public.companies (company_name, source, created_by, needs_review)
        values (v_co, 'pro-app:shell-contract', 'pro-app:shell-contract', true)
        returning id into v_company;
      exception when unique_violation then
        select id into v_company from public.companies
         where lower(btrim(company_name)) = lower(v_co) limit 1;
      end;
    end if;
    v_who := v_co;
  end if;

  v_entity := public.project_signing_entity(p_project);
  if v_entity is null then
    select u.contact_id into v_signer_contact from public.app_users u where u.id = me;
    if v_signer_contact is null then
      return jsonb_build_object('ok', false, 'reason',
        'This job has no signing entity set, so there is nothing to put on our side of a contract yet.');
    end if;
  end if;

  -- The title names the WORK when it does not name a party, because a list of
  -- rows all called "(placeholder)" is a list nobody can use.
  v_label := coalesce(v_title, v_who, 'Not appointed yet') || coalesce(' - ' || v_trade, '');

  insert into public.contracts
    (title, contract_type, status, direction, project_id, trade, amount,
     signer_company_id, signer_contact_id, counterparty_company_id, counterparty_contact_id,
     created_by, last_modified_by, notes)
  values (
    v_label || ' (placeholder)',
    case when v_trade is not null then 'construction trade contract' else 'service agreement' end,
    'placeholder', 'payable', p_project, v_trade, p_amount,
    v_entity, v_signer_contact, v_company, p_counterparty,
    'pro-app:shell-contract', 'pro-app:shell-contract',
    'Shell contract, made from the task screen so the work is agreement-bounded from the day it was written '
    || 'down. Status is placeholder: no value agreed, no scope, nothing signed'
    || case when v_who is null then ', and nobody named on the other side yet - that is what it is for' else '' end
    || '. Fill these terms in when the real agreement exists - do not create a second contract.')
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'who', v_who, 'trade', v_trade,
    'label', v_label || ' (placeholder)');
end $function$;

comment on function public.portal_contract_shell(uuid, text, text, uuid, text, numeric) is
'Make a placeholder contract deliberately, from a screen - the same row fn_members_ensure_contract writes as a side effect of seating somebody: payable, status placeholder, the project''s signing entity on our side, no value and no scope. The counterparty is OPTIONAL (migration 135): not knowing who the work is with is the reason a shell exists, and the constraint allows nobody on the other side for exactly as long as the contract stays a placeholder.';

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
