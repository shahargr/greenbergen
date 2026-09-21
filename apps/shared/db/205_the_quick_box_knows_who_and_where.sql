-- THE QUICK BOX LEARNS WHERE THE MONEY LANDS, AND WHO IT USUALLY GOES TO.
--
-- Shahar, 2026-09-21, on the quick task-and-payment box: "the drop down does
-- not seem to work (who you paid). this is where drifts start with different
-- names. Allow to create new if necessary. From default to the one used last
-- time."
--
-- Two halves. This is the database half.
--
-- 1. portal_task_quick_paid could not say which contract or which budget line
--    the money was for - the columns it writes were both left null. That is
--    exactly how $5,000 of framing came to sit in the ledger counted by
--    nothing (migration 203 fixed the same hole on the other two paths). The
--    two arguments are added here and passed straight through; the checks
--    live in task_payment_log, which refuses a contract or a line from
--    another project.
--
--    Note the DROP: adding parameters CHANGES the signature, so `create or
--    replace` alone leaves the old function in place beside the new one and
--    every short call becomes ambiguous. That is what 203 did to
--    task_payment_log, and what 204 had to undo.
--
-- 2. portal_trade_pay_defaults answers "the one used last time" from the
--    record rather than from a list somebody has to maintain: the last
--    payment logged against this trade on this project family names the
--    payee, the account, the rail, the contract and the budget line. Failing
--    a payment, the trade's own contract answers as much of it as it can.
--
-- NOTE: the contract fallback below uses min(c.id) on a uuid, which does not
-- exist in Postgres. It threw 42883 on exactly the case it was written for -
-- a trade with no payment history - and migration 206 rewrites it. Kept here
-- as applied, because a migration is a record of what happened.

drop function if exists public.portal_task_quick_paid(
  uuid, text, numeric, uuid, text, date, uuid, uuid[], uuid, text, text, text, text, date, text, boolean, uuid[]);

create function public.portal_task_quick_paid(
  p_project uuid,
  p_action text,
  p_amount numeric,
  p_method uuid,
  p_trade text default null,
  p_target_date date default null,
  p_parent uuid default null,
  p_file_ids uuid[] default null,
  p_payee_contact uuid default null,
  p_payee_name text default null,
  p_from_account text default null,
  p_to_account text default null,
  p_reference text default null,
  p_paid_on date default null,
  p_notes text default null,
  p_awaiting boolean default false,
  p_receipt_ids uuid[] default null,
  p_contract uuid default null,
  p_budget_category uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare r jsonb; pay jsonb; v_id uuid;
begin
  perform public.assert_own_hands();

  -- MONEY CHANGED HANDS, so this is a financial transaction whatever else it
  -- is about. The kind is not a question worth asking somebody holding a
  -- receipt in a driveway.
  r := public.portal_task_quick(
    p_project => p_project,
    p_action => p_action,
    p_trade => p_trade,
    p_target_date => p_target_date,
    p_parent => p_parent,
    p_file_ids => p_file_ids,
    p_type => 'financial transaction',
    -- What it cost is what it was expected to cost: you are recording it
    -- after the fact, so the intent and the actual are the same number.
    p_target_cost => p_amount,
    p_pay_to_contact => p_payee_contact);
  if not coalesce((r->>'ok')::boolean, false) then return r; end if;
  v_id := (r->>'id')::uuid;

  pay := public.task_payment_log(
    p_action => v_id,
    p_amount => p_amount,
    p_method => p_method,
    p_payee_contact => p_payee_contact,
    p_payee_name => p_payee_name,
    p_reference => p_reference,
    p_paid_on => p_paid_on,
    p_from_account => p_from_account,
    p_to_account => p_to_account,
    p_notes => p_notes,
    p_awaiting => coalesce(p_awaiting, false),
    p_file_ids => p_receipt_ids,
    -- WHERE IT LANDS. Null is still allowed - a lumber run has no contract -
    -- but it is no longer impossible to say.
    p_contract => p_contract,
    p_budget_category => p_budget_category);

  if not coalesce((pay->>'ok')::boolean, false) then
    -- One act, so it either lands or it does not: no stray task, and no
    -- second one when they fix the amount and press it again.
    delete from public.actions where id = v_id;
    return pay;
  end if;

  return r || jsonb_build_object('paid', true, 'payment', pay, 'amount', p_amount);
end $function$;

revoke all on function public.portal_task_quick_paid(
  uuid, text, numeric, uuid, text, date, uuid, uuid[], uuid, text, text, text, text, date, text, boolean, uuid[], uuid, uuid)
  from public;
grant execute on function public.portal_task_quick_paid(
  uuid, text, numeric, uuid, text, date, uuid, uuid[], uuid, text, text, text, text, date, text, boolean, uuid[], uuid, uuid)
  to authenticated, service_role;


-- WHAT THE LAST PAYMENT ON THIS TRADE KNEW.
create or replace function public.portal_trade_pay_defaults(p_project uuid, p_trade text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  t            public.transactions;
  v_contract   uuid;
  v_budget     uuid;
  v_payee      uuid;
  v_payee_name text;
  v_title      text;
  v_line       text;
  n            int;
begin
  -- The same gate as writing one: these are the fields of a payment form, and
  -- who was paid what is financial. Nothing leaks to a trade looking at their
  -- own row.
  if not public.fin_may_record(p_project) then return jsonb_build_object('ok', false); end if;

  -- THE LAST ONE. The trade's work can live on the job under the house, so
  -- the whole family is in scope - the same family the trade screen shows.
  select x.* into t
    from public.transactions x
    join public.actions a on a.id = x.action_id
   where x.project_id in (select project_id from public.fin_family(p_project))
     and a.trade = p_trade
   order by coalesce(x.paid_on, x.created_at::date) desc, x.created_at desc
   limit 1;

  v_payee    := t.contractor_id;
  v_contract := t.contract_id;
  v_budget   := t.budget_category_id;

  -- FAILING A PAYMENT, THE CONTRACT. Only when there is exactly one live one
  -- for this trade: two candidates is a question, not a default, and a
  -- silently wrong contract is worse than an empty field.
  if v_contract is null then
    select count(*), min(c.id) into n, v_contract
      from public.contracts c
     where c.project_id in (select project_id from public.fin_family(p_project))
       and c.trade = p_trade
       and coalesce(c.status, '') not in ('complete', 'completed', 'cancelled', 'canceled', 'closed', 'draft');
    if n <> 1 then v_contract := null; end if;
  end if;

  if v_contract is not null then
    select c.title, coalesce(v_budget, c.budget_category_id), coalesce(v_payee, c.contractor_id)
      into v_title, v_budget, v_payee
      from public.contracts c where c.id = v_contract;
  end if;

  if v_payee is not null then
    select coalesce(c.person_name, c.name) into v_payee_name
      from public.contacts c where c.id = v_payee and c.disabled_at is null;
    if v_payee_name is null then v_payee := null; end if;
  end if;
  if v_budget is not null then
    select bc.category into v_line from public.budget_categories bc where bc.id = v_budget;
  end if;

  return jsonb_build_object(
    'ok', true,
    'payee_contact_id', v_payee,
    'payee_name', v_payee_name,
    'from_account', t.paid_from_account,
    'method_id', t.payment_method_id,
    'contract_id', v_contract,
    'contract_title', v_title,
    'budget_category_id', v_budget,
    'budget_category', v_line);
end $function$;

revoke all on function public.portal_trade_pay_defaults(uuid, text) from public;
grant execute on function public.portal_trade_pay_defaults(uuid, text) to authenticated, service_role;
