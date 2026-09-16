-- 159. THE LOAN WRITES ITS OWN SCHEDULE.
--
-- Shahar (2026-09-16): "when creating a loan, can the database understand
-- the loan structure, and create automatically payment events under the
-- loan?"
--
-- It can, and the shape of a "payment event" was already settled by hand:
-- the ClearEdge note carries a row per month - "Mortgage interest - Sep
-- 2026", $5,449.00, status forecast, dated the first, ACH from the 55 Walnut
-- account, to the lender - typed in one at a time through July 2027. The
-- ledger shows them as planned and each becomes paid when it is. That is
-- the schedule; a loan should write it itself from its terms.
--
-- loan_schedule_build(contract) reads the terms 157 recorded - the first
-- payment date, the interest-only period and what it costs, the payment
-- after it, the escrow, the maturity - and writes one forecast per month
-- that has none yet, copying the account, the method and the budget line
-- from the newest row already on the contract so the new ones look like
-- the old ones. It runs when a loan is created or its terms change, and
-- again each time a monthly payment task closes, so the schedule always
-- runs two years ahead (or to the contract's end date, when one is set:
-- a note meant to be paid off at the sale need not forecast to 2056).
--
-- CLOSING THE MONTH'S TASK PAYS THE MONTH. The monthly payment task (156)
-- is where the ACH confirmation gets attached; closing it marks that
-- month's forecast paid and binds the two. The payee-confirmation task the
-- ledger normally raises on a payment is skipped for this one write - a
-- lender's auto-draft is confirmed by the bank statement, not by the
-- lender writing back - through a session flag fn_transactions_notify_task
-- now honours.

-- ---------------------------------------------------------------------------
-- 1. The builder.
-- ---------------------------------------------------------------------------
create or replace function public.loan_schedule_build(p_contract uuid, p_through date default null)
returns integer
language plpgsql security definer
set search_path to 'public'
as $$
declare
  c public.contracts; tpl public.transactions;
  v_first date; v_io_until date; v_after numeric; v_escrow numeric; v_pi numeric;
  v_horizon date; m date; n int := 0; v_amount numeric; v_kind text; v_payee uuid;
begin
  select * into c from public.contracts where id = p_contract;
  if c.id is null or c.contract_type <> 'loan' or c.project_id is null then return 0; end if;
  if c.loan_monthly_payment is null then return 0; end if;
  if exists (select 1 from public.projects p where p.id = c.project_id and p.status = 'Completed') then return 0; end if;

  v_first := coalesce((c.type_details->>'first_payment_date')::date,
                      (date_trunc('month', coalesce(c.start_date, c.signed_date, current_date)) + interval '2 months')::date);
  v_io_until := (c.type_details->>'interest_only_until')::date;
  v_after    := (c.type_details->>'payment_after')::numeric;
  v_escrow   := coalesce((c.type_details->>'escrow_monthly')::numeric, 0);
  v_horizon  := coalesce(p_through, c.end_date, c.desired_completion_date,
                         least(coalesce(c.loan_maturity_date, current_date + interval '24 months'),
                               (current_date + interval '24 months')::date));
  if c.loan_maturity_date is not null then v_horizon := least(v_horizon, c.loan_maturity_date); end if;

  -- The newest row on the contract is the template: same account, method,
  -- budget line, payee. A loan with no rows yet gets the contract's party.
  select * into tpl from public.transactions t
   where t.contract_id = c.id order by t.created_at desc limit 1;
  v_payee := coalesce(tpl.contractor_id, c.contractor_id, c.counterparty_contact_id,
                      (select ct.id from public.contacts ct where ct.company_id = c.counterparty_company_id
                        and ct.disabled_at is null order by ct.created_at limit 1));

  m := v_first;
  while m <= v_horizon loop
    if not exists (select 1 from public.transactions t
                    where t.contract_id = c.id
                      and date_trunc('month', coalesce(t.paid_on, t.target_date)) = date_trunc('month', m)) then
      v_pi := case when v_io_until is not null and m >= v_io_until and v_after is not null then v_after
                   else c.loan_monthly_payment end;
      v_kind := case when c.loan_kind = 'interest only' and (v_io_until is null or m < v_io_until) then 'interest only'
                     when c.loan_kind = 'interest only' then 'principal and interest'
                     else coalesce(c.loan_kind, 'payment') end;
      v_amount := round(v_pi + v_escrow, 2);
      insert into public.transactions
        (description, amount, status, paid_on, contract_id, project_id, contractor_id, direction,
         source_account_id, payment_method_id, paid_via, paid_from_account, budget_category_id,
         currency, is_recurring, recurrence, created_by, last_modified_by, notes)
      values
        ('Mortgage payment - ' || to_char(m, 'Mon YYYY') || ' (' || v_kind
           || case when v_escrow > 0 then ' + escrow' else '' end || ')',
         v_amount, 'forecast', m, c.id, c.project_id, v_payee, 'out',
         tpl.source_account_id, tpl.payment_method_id, coalesce(tpl.paid_via, 'ACH'), tpl.paid_from_account,
         tpl.budget_category_id, coalesce(tpl.currency, c.currency, 'USD'), true, 'monthly',
         'system:loan schedule', 'system:loan schedule',
         'Forecast written from the loan terms (migration 159): ' || coalesce(public.loan_terms_line(c.id), ''));
      n := n + 1;
    end if;
    m := (m + interval '1 month')::date;
  end loop;
  return n;
end $$;

comment on function public.loan_schedule_build(uuid, date) is
  'One forecast transaction per month of a loan, from its first payment to its end date or two years out, skipping months that already have a row. Idempotent.';

-- ---------------------------------------------------------------------------
-- 2. When the terms land, and when the loan is created with them.
-- ---------------------------------------------------------------------------
create or replace function public.fn_loan_terms_reach_payments()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if new.contract_type <> 'loan' then return new; end if;
  update public.actions a
     set action = coalesce(public.loan_payment_title(new.id), a.action),
         occurrence_title = coalesce(public.loan_payment_title(new.id), a.occurrence_title),
         status_note = public.loan_terms_line(new.id),
         target_cost = coalesce(new.loan_monthly_payment, a.target_cost),
         last_updated = now(), last_modified_by = 'system:loan'
   where a.contract_id = new.id
     and a.cadence = 'monthly'
     and a.action_type = 'financial transaction'
     and a.status not in ('Completed','Cancelled','Force Cancelled');
  perform public.loan_schedule_build(new.id);
  return new;
end $$;

drop trigger if exists trg_contracts_loan_terms on public.contracts;
create trigger trg_contracts_loan_terms
  after insert or update of loan_kind, loan_monthly_payment, loan_interest_rate, loan_principal,
                            loan_maturity_date, loan_lender, type_details, end_date, desired_completion_date
  on public.contracts
  for each row when (new.contract_type = 'loan')
  execute function public.fn_loan_terms_reach_payments();

-- ---------------------------------------------------------------------------
-- 3. The notice can be told to stand down for one write.
-- ---------------------------------------------------------------------------
do $patch$
declare src text; out_ text;
begin
  select pg_get_functiondef('public.fn_transactions_notify_task()'::regprocedure) into src;
  out_ := replace(src,
    $a$begin
  select means_money_moved into v_moved$a$,
    $b$begin
  -- A write that has its own proof - a monthly loan draft closed on its task
  -- with the bank's confirmation attached (159) - asks nobody to confirm.
  if current_setting('sgr.skip_payment_notice', true) = '1' then return NEW; end if;
  select means_money_moved into v_moved$b$);
  if out_ = src then raise exception 'fn_transactions_notify_task has drifted'; end if;
  execute out_;
end $patch$;

-- ---------------------------------------------------------------------------
-- 4. Closing the month's task pays the month, and keeps the schedule ahead.
-- ---------------------------------------------------------------------------
create or replace function public.fn_loan_payment_closed()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare c public.contracts; v_tx uuid;
begin
  if new.status <> 'Completed' or old.status = 'Completed' then return new; end if;
  if new.cadence <> 'monthly' or new.action_type is distinct from 'financial transaction' or new.contract_id is null then
    return new;
  end if;
  select * into c from public.contracts where id = new.contract_id;
  if c.id is null or c.contract_type <> 'loan' then return new; end if;

  -- The forecast for the task's month, if one is still standing.
  if new.target_date is not null then
    select t.id into v_tx from public.transactions t
     where t.contract_id = c.id and t.status = 'forecast'
       and date_trunc('month', coalesce(t.paid_on, t.target_date)) = date_trunc('month', new.target_date)
     order by coalesce(t.paid_on, t.target_date) limit 1;
    if v_tx is not null then
      perform set_config('sgr.skip_payment_notice', '1', true);
      update public.transactions
         set status = 'paid',
             paid_on = coalesce(paid_on, target_date, new.target_date),
             action_id = coalesce(action_id, new.id),
             last_modified_by = 'system:loan',
             notes = coalesce(notes || E'\n', '') || 'Marked paid when its task closed on ' || to_char(current_date, 'YYYY-MM-DD') || '.'
       where id = v_tx;
      perform set_config('sgr.skip_payment_notice', '0', true);
    end if;
  end if;

  perform public.loan_schedule_build(c.id);
  return new;
end $$;

drop trigger if exists trg_actions_loan_payment_closed on public.actions;
create trigger trg_actions_loan_payment_closed
  after update of status on public.actions
  for each row when (new.status = 'Completed' and old.status is distinct from new.status)
  execute function public.fn_loan_payment_closed();

-- ---------------------------------------------------------------------------
-- 5. 55 Walnut: the schedule runs on from where the hand-typed rows stop.
-- ---------------------------------------------------------------------------
select public.loan_schedule_build('cc22cb9e-de08-4cfd-88f2-ff145df2d291');

update public.config
   set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);

-- ---------------------------------------------------------------------------
-- 159b. The template is the newest RECURRING row, not the newest row: the
-- first run copied "Paid by Shahar" off the appraisal fee onto fourteen
-- mortgage drafts that go by ACH like every month before them. The
-- fourteen are corrected from the July row. (Applied as "..._b".)
-- ---------------------------------------------------------------------------
create or replace function public.loan_schedule_build(p_contract uuid, p_through date default null)
returns integer
language plpgsql security definer
set search_path to 'public'
as $$
declare
  c public.contracts; tpl public.transactions;
  v_first date; v_io_until date; v_after numeric; v_escrow numeric; v_pi numeric;
  v_horizon date; m date; n int := 0; v_amount numeric; v_kind text; v_payee uuid;
begin
  select * into c from public.contracts where id = p_contract;
  if c.id is null or c.contract_type <> 'loan' or c.project_id is null then return 0; end if;
  if c.loan_monthly_payment is null then return 0; end if;
  if exists (select 1 from public.projects p where p.id = c.project_id and p.status = 'Completed') then return 0; end if;

  v_first := coalesce((c.type_details->>'first_payment_date')::date,
                      (date_trunc('month', coalesce(c.start_date, c.signed_date, current_date)) + interval '2 months')::date);
  v_io_until := (c.type_details->>'interest_only_until')::date;
  v_after    := (c.type_details->>'payment_after')::numeric;
  v_escrow   := coalesce((c.type_details->>'escrow_monthly')::numeric, 0);
  v_horizon  := coalesce(p_through, c.end_date, c.desired_completion_date,
                         least(coalesce(c.loan_maturity_date, current_date + interval '24 months'),
                               (current_date + interval '24 months')::date));
  if c.loan_maturity_date is not null then v_horizon := least(v_horizon, c.loan_maturity_date); end if;

  -- The newest monthly row on the contract is the template - the same
  -- account, method, budget line and payee as every draft before it. A loan
  -- with no monthly row yet takes its newest row of any kind, then the
  -- contract's party.
  select * into tpl from public.transactions t
   where t.contract_id = c.id
   order by (coalesce(t.is_recurring, false) or t.recurrence = 'monthly') desc, t.created_at desc
   limit 1;
  v_payee := coalesce(tpl.contractor_id, c.contractor_id, c.counterparty_contact_id,
                      (select ct.id from public.contacts ct where ct.company_id = c.counterparty_company_id
                        and ct.disabled_at is null order by ct.created_at limit 1));

  m := v_first;
  while m <= v_horizon loop
    if not exists (select 1 from public.transactions t
                    where t.contract_id = c.id
                      and date_trunc('month', coalesce(t.paid_on, t.target_date)) = date_trunc('month', m)) then
      v_pi := case when v_io_until is not null and m >= v_io_until and v_after is not null then v_after
                   else c.loan_monthly_payment end;
      v_kind := case when c.loan_kind = 'interest only' and (v_io_until is null or m < v_io_until) then 'interest only'
                     when c.loan_kind = 'interest only' then 'principal and interest'
                     else coalesce(c.loan_kind, 'payment') end;
      v_amount := round(v_pi + v_escrow, 2);
      insert into public.transactions
        (description, amount, status, paid_on, contract_id, project_id, contractor_id, direction,
         source_account_id, payment_method_id, paid_via, paid_from_account, budget_category_id,
         currency, is_recurring, recurrence, created_by, last_modified_by, notes)
      values
        ('Mortgage payment - ' || to_char(m, 'Mon YYYY') || ' (' || v_kind
           || case when v_escrow > 0 then ' + escrow' else '' end || ')',
         v_amount, 'forecast', m, c.id, c.project_id, v_payee, 'out',
         tpl.source_account_id, tpl.payment_method_id, coalesce(tpl.paid_via, 'ACH'), tpl.paid_from_account,
         tpl.budget_category_id, coalesce(tpl.currency, c.currency, 'USD'), true, 'monthly',
         'system:loan schedule', 'system:loan schedule',
         'Forecast written from the loan terms (migration 159): ' || coalesce(public.loan_terms_line(c.id), ''));
      n := n + 1;
    end if;
    m := (m + interval '1 month')::date;
  end loop;
  return n;
end $$;

update public.transactions t
   set paid_via = s.paid_via, payment_method_id = s.payment_method_id, last_modified_by = 'system:loan schedule'
  from (select paid_via, payment_method_id from public.transactions
         where id = 'be2fc216-6436-497a-a1a4-561af06218f6') s
 where t.contract_id = 'cc22cb9e-de08-4cfd-88f2-ff145df2d291'
   and t.created_by = 'system:loan schedule' and t.status = 'forecast';
