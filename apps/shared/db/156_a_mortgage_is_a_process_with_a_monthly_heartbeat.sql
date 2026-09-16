-- 156. A MORTGAGE IS A PROCESS WITH A MONTHLY HEARTBEAT.
--
-- Shahar (2026-09-16): "When closing a finance task, a sub task for payment
-- to be created automatically. I need your help to set a finance process,
-- that documents the monthly payments. It should call out specifically if
-- this is an interest only, or different type of loan that was taken. When
-- closing on the house, this task should close with the evidence that the
-- mortgage was closed."
--
-- A PROCESS HERE IS A BLUEPRINT: tag a task with activity_blueprint_id and
-- fn_actions_expand_blueprint fans it out into its steps (help: blueprints).
-- Recurrence is already built: a monthly task closes and close_action spawns
-- next month's (action_cadences.advances_on_close). So the loan is a
-- blueprint whose middle step beats monthly, and three things the mechanics
-- were missing get fixed on the way:
--
--   1. THE LOAN KIND HAS NOWHERE TO LIVE. contracts carries principal, rate,
--      term, payment, lender and maturity - and no word for whether the
--      payment touches the principal. loan_kind: interest only, principal and
--      interest, balloon, line of credit, other. loan_terms_line() renders it
--      as one sentence, and that sentence is the payment task's title, so an
--      interest-only loan says INTEREST ONLY on every occurrence, unmissable.
--
--   2. EXPANSION DROPPED THE STEP'S CADENCE. blueprint_activity_steps has had
--      a cadence column since the start and fn_actions_expand_blueprint never
--      copied it: every step came out one-time, so a "monthly" step was a
--      task that closed once and vanished. It carries cadence now, and two
--      new step columns - action_type and is_gate - so a step can say it is
--      money, and a step can say the parent may not close before it.
--
--   3. THE NEXT OCCURRENCE CARRIED NO DATE, and lost its trade, its type, its
--      payee and - worst - hidden_from_trades. A monthly payment that spawns
--      undated, un-hidden and un-typed is not a heartbeat. close_action now
--      dates it (daily +1, weekly +7, monthly +1 month) and carries the rest.
--
-- THE BLUEPRINT - "Mortgage or construction loan", five steps:
--   10 Secure the loan                     one-time
--   20 Record the loan terms on the contract  one-time   (kind, rate, payment, maturity)
--   30 Monthly loan payment                monthly, financial transaction
--   40 Keep the lender's conditions met    one-time, optional (insurance, taxes)
--   50 Pay off the loan at closing         one-time, GATE - the parent cannot
--      close until this has, and closing it goes through the proof gate:
--      the payoff statement and the recorded discharge are the evidence.
--
-- "WHEN CLOSING A FINANCE TASK, A SUB TASK FOR PAYMENT": closing step 10
-- dates step 30 for the first of next month and binds it to the loan, and
-- writes it if a hand-made process lacks it. From then on each payment
-- closed spawns the next, dated a month on, until the payoff step closes
-- the chain (close with is_final_occurrence).
--
-- 55 WALNUT: the process is opened here on New build against "Construction
-- loan note - 55 Walnut (ClearEdge Lending)", step 10 is closed because
-- Daniel Meidan already did it (his task and the hand-written "Monthly
-- mortgage payments are active" task move under the process), and step 20
-- is dated a week out because the loan's kind, rate and payment are not on
-- file - only Shahar knows them.

-- ---------------------------------------------------------------------------
-- 1. The loan kind, and one sentence that says it.
-- ---------------------------------------------------------------------------
alter table public.contracts add column if not exists loan_kind text;
alter table public.contracts drop constraint if exists chk_contracts_loan_kind;
alter table public.contracts add constraint chk_contracts_loan_kind
  check (loan_kind is null or loan_kind in ('interest only', 'principal and interest', 'balloon', 'line of credit', 'other'));
comment on column public.contracts.loan_kind is
  'What the monthly payment does to the principal. interest only: nothing - the whole principal is due at maturity or the sale. principal and interest: amortising. balloon: small payments, a lump at the end. line of credit: draw and repay.';

create or replace function public.loan_terms_line(p_contract uuid)
returns text
language sql stable
set search_path to 'public'
as $$
  select case
    when c.id is null then null
    when c.loan_kind is null then
      'LOAN KIND NOT RECORDED - is this interest only? Record the kind, rate, monthly payment and maturity on the contract.'
    else upper(c.loan_kind)
      || coalesce(' · $' || to_char(c.loan_monthly_payment, 'FM999,999,990') || ' a month', '')
      || coalesce(' at ' || rtrim(rtrim(c.loan_interest_rate::text, '0'), '.') || '%', '')
      || coalesce(' on $' || to_char(c.loan_principal, 'FM999,999,990'), '')
      || case c.loan_kind
           when 'interest only' then ' - the principal does not move; all of it is due at '
                                     || coalesce(to_char(c.loan_maturity_date, 'Mon DD, YYYY'), 'maturity or the sale')
           when 'balloon' then ' - a lump sum is due at '
                               || coalesce(to_char(c.loan_maturity_date, 'Mon DD, YYYY'), 'maturity')
           when 'principal and interest' then ' - each payment brings the principal down'
           else '' end
    end
  from (select p_contract as id) x
  left join public.contracts c on c.id = x.id;
$$;
comment on function public.loan_terms_line(uuid) is
  'The loan in one sentence, INTEREST ONLY said in capitals when that is what it is. The monthly payment task wears it as its title.';

create or replace function public.loan_payment_title(p_contract uuid)
returns text
language sql stable
set search_path to 'public'
as $$
  select 'Monthly loan payment · '
      || coalesce(upper(c.loan_kind), 'KIND NOT RECORDED')
      || coalesce(' · $' || to_char(c.loan_monthly_payment, 'FM999,999,990'), '')
      || coalesce(' · ' || coalesce(c.loan_lender, co.company_name, ct.name), '')
  from public.contracts c
  left join public.companies co on co.id = c.counterparty_company_id
  left join public.contacts ct on ct.id = coalesce(c.contractor_id, c.counterparty_contact_id)
  where c.id = p_contract;
$$;

-- ---------------------------------------------------------------------------
-- 2. A step can say it is money and it can say it is a gate; expansion
--    carries cadence, type and gate.
-- ---------------------------------------------------------------------------
alter table public.blueprint_activity_steps
  add column if not exists action_type text references public.action_types(action_type),
  add column if not exists is_gate boolean not null default false;

create or replace function public.fn_actions_expand_blueprint()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_child_depth integer;
begin
  if new.activity_blueprint_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and old.activity_blueprint_id is not distinct from new.activity_blueprint_id then
    return new;
  end if;
  v_child_depth := least(coalesce(new.depth_level, 2) + 1, 5);
  -- cadence, action_type and is_gate travel with the step (156). Cadence
  -- always existed on the step and was never copied, so a monthly step
  -- expanded into a task that closed once and vanished.
  insert into public.actions (
    action, status, priority, domain, project_id, engagement_id,
    parent_action_id, assigned_to, assigned_by, depth_level,
    source, created_by, notes, step_order, hidden_from_trades,
    cadence, action_type, is_gate
  )
  select s.step_name,
         'Not Started',
         coalesce(new.priority, 'Missing'),
         new.domain,
         new.project_id,
         new.engagement_id,
         new.id,
         s.default_assigned_to,
         new.assigned_to,
         v_child_depth,
         'system:blueprint',
         'system:blueprint',
         s.notes,
         s.step_order,
         coalesce(s.hidden_from_trades, false),
         coalesce(s.cadence, 'one-time'),
         s.action_type,
         coalesce(s.is_gate, false)
  from public.blueprint_activity_steps s
  where s.activity_blueprint_id = new.activity_blueprint_id
    and not exists (
      select 1 from public.actions c
      where c.parent_action_id = new.id
        and c.action = s.step_name
    )
  order by s.step_order;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The next occurrence is dated and keeps what it is.
-- ---------------------------------------------------------------------------
do $patch$
declare src text; out_ text; step text;
begin
  select pg_get_functiondef('public.close_action(uuid, boolean, text, text, boolean)'::regprocedure) into src;
  out_ := src;

  step := 'columns';
  out_ := replace(out_,
    $a$      desired_outcome, is_gate, contract_id, documentation_stage,
      source, created_by, notes
    )$a$,
    $b$      desired_outcome, is_gate, contract_id, documentation_stage,
      source, created_by, notes,
      -- 156: the next occurrence is dated by its cadence and keeps its trade,
      -- its type, its payee, its cost and - above all - hidden_from_trades.
      target_date, trade, action_type, pay_to_contact_id, target_cost, delivers, hidden_from_trades
    )$b$);
  if out_ = src then raise exception 'close_action has drifted at %', step; end if;
  src := out_;

  step := 'values';
  out_ := replace(out_,
    $a$      a.desired_outcome, a.is_gate, a.contract_id, a.documentation_stage,
      'system:recurrence', 'system',$a$,
    $b$      a.desired_outcome, a.is_gate, a.contract_id, a.documentation_stage,
      'system:recurrence', 'system',
      -- (the notes literal follows, then:)$b$);
  if out_ = src then raise exception 'close_action has drifted at %', step; end if;
  src := out_;

  step := 'after notes';
  out_ := replace(out_,
    $a$      'Closing this normally spawns the next occurrence; close with p_is_final_occurrence => true to end the chain.'
    )
    returning id into v_next_id;$a$,
    $b$      'Closing this normally spawns the next occurrence; close with p_is_final_occurrence => true to end the chain.',
      case a.cadence
        when 'daily'   then coalesce(a.target_date, current_date) + 1
        when 'weekly'  then coalesce(a.target_date, current_date) + 7
        when 'monthly' then (coalesce(a.target_date, current_date) + interval '1 month')::date
        else null end,
      a.trade, a.action_type, a.pay_to_contact_id, a.target_cost, a.delivers, a.hidden_from_trades
    )
    returning id into v_next_id;$b$);
  if out_ = src then raise exception 'close_action has drifted at %', step; end if;

  execute out_;
end $patch$;

-- ---------------------------------------------------------------------------
-- 4. The blueprint.
-- ---------------------------------------------------------------------------
insert into public.blueprint_activity (name, domain, description, is_recurring, recurrence_note, auto_close_condition, created_by)
values (
  'Mortgage or construction loan',
  'construction',
  'A loan secured on the property, from the day it is arranged to the day it is discharged: securing it, writing '
  || 'its terms down where the payment task can read them, paying it every month, keeping the lender''s conditions '
  || 'met, and paying it off at the closing with the paper to prove it. THE KIND OF LOAN IS THE THING TO KNOW: on '
  || 'an interest-only loan the payments never touch the principal, and the whole of it is due at maturity or at '
  || 'the sale - the payment task says INTEREST ONLY in its title so nobody mistakes twelve payments for progress. '
  || 'Step 30 recurs monthly on its own once step 10 closes; step 50 is a gate, so the process cannot be closed '
  || 'until the loan has been.',
  true,
  'Once per loan. Step 30 recurs monthly from the month after the loan is secured until the payoff step ends the chain.',
  'The loan is discharged: payoff statement and recorded satisfaction on file',
  'Shahar (2026-09-16)'
)
on conflict (name) do nothing;

insert into public.blueprint_activity_steps
  (activity_blueprint_id, step_order, step_name, default_assigned_to, necessity, cadence, action_type, is_gate, hidden_from_trades, notes)
select b.id, s.step_order, s.step_name, null, s.necessity, s.cadence, s.action_type, s.is_gate, true, s.notes
from public.blueprint_activity b,
lateral (values
  (10, 'Secure the loan', 'required', 'one-time', 'backoffice', false,
   'The broker, the lender, the rate, the appraisal, the closing. At 55 Walnut: Daniel Meidan (mortgage broker) '
   || 'arranged the construction loan with ClearEdge Lending; the note was signed 2026-04-13. Close this step when '
   || 'the loan has funded - closing it dates the first monthly payment for the first of the following month and '
   || 'binds it to the loan contract.'),

  (20, 'Record the loan terms on the contract', 'required', 'one-time', 'backoffice', false,
   'On the loan contract: the KIND (interest only / principal and interest / balloon / line of credit), the '
   || 'principal, the rate, the monthly payment, the term and the maturity date, and the lender. The monthly payment '
   || 'task reads these - its title says INTEREST ONLY when that is what it is, and its amount is the payment. '
   || 'Until they are recorded the payment task says KIND NOT RECORDED, on purpose.'),

  (30, 'Monthly loan payment', 'required', 'monthly', 'financial transaction', false,
   'One occurrence per month, paid to the lender. Record the amount paid and attach the confirmation (the ACH '
   || 'receipt or the statement line) as the evidence - the payment is the proof. INTEREST ONLY: every payment is '
   || 'interest and the principal does not move; the balance owed is the full principal until the payoff. '
   || 'PRINCIPAL AND INTEREST: note the split from the statement. Closing an occurrence spawns the next, dated a '
   || 'month on; the chain ends when step 50 closes.'),

  (40, 'Keep the lender''s conditions met', 'optional', 'one-time', 'backoffice', false,
   'What the note requires while it is open: the builder''s risk or homeowner''s policy naming the lender as '
   || 'mortgagee, property taxes current, and any draw or inspection schedule the lender runs. At 55 Walnut the '
   || 'rental policy was cancelled and the lender had to accept the builder''s risk policy in its place - that gap '
   || 'is the kind of thing this step exists to catch.'),

  (50, 'Pay off the loan at closing', 'required', 'one-time', 'financial transaction', true,
   'A GATE: the process cannot close until this has. Order the payoff statement from the lender ahead of the '
   || 'closing (it is good for a set number of days), have the closing attorney wire it from the proceeds, and '
   || 'then get the paper: the lender''s payoff confirmation and the recorded satisfaction / discharge of mortgage '
   || 'from the county. THOSE ARE THE EVIDENCE this closes on - attach them here. Close this as the final '
   || 'occurrence of the payment chain: no payment is due after it.')
) as s(step_order, step_name, necessity, cadence, action_type, is_gate, notes)
where b.name = 'Mortgage or construction loan'
on conflict (activity_blueprint_id, step_order) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Closing "Secure the loan" starts the heartbeat.
-- ---------------------------------------------------------------------------
create or replace function public.fn_loan_secured_starts_payments()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_parent public.actions; v_bp uuid; v_pay uuid; v_lender uuid; v_first date;
begin
  if new.status <> 'Completed' or old.status = 'Completed' then return new; end if;
  if new.parent_action_id is null or coalesce(new.step_order, 0) <> 10 then return new; end if;

  select id into v_bp from public.blueprint_activity where name = 'Mortgage or construction loan';
  select * into v_parent from public.actions where id = new.parent_action_id;
  if v_parent.activity_blueprint_id is distinct from v_bp then return new; end if;

  v_first := (date_trunc('month', current_date) + interval '1 month')::date;
  select coalesce(c.contractor_id, c.counterparty_contact_id) into v_lender
    from public.contracts c where c.id = v_parent.contract_id;

  select a.id into v_pay from public.actions a
   where a.parent_action_id = v_parent.id and a.step_order = 30
     and a.status not in ('Completed','Cancelled','Force Cancelled')
   order by a.created_at limit 1;

  if v_pay is null then
    insert into public.actions
      (action, status, priority, domain, project_id, parent_action_id, depth_level,
       cadence, action_type, trade, contract_id, pay_to_contact_id, target_date, step_order,
       hidden_from_trades, assigned_to_contact_id, source, created_by, notes)
    values
      (coalesce(public.loan_payment_title(v_parent.contract_id), 'Monthly loan payment'),
       'Not Started', coalesce(v_parent.priority, 'Missing'), v_parent.domain, v_parent.project_id, v_parent.id,
       least(coalesce(v_parent.depth_level, 2) + 1, 5),
       'monthly', 'financial transaction', 'Finance', v_parent.contract_id, v_lender, v_first, 30,
       true, v_parent.assigned_to_contact_id, 'system:loan', 'system:loan',
       (select s.notes from public.blueprint_activity_steps s where s.activity_blueprint_id = v_bp and s.step_order = 30))
    returning id into v_pay;
  else
    update public.actions
       set action = coalesce(public.loan_payment_title(v_parent.contract_id), action),
           occurrence_title = coalesce(public.loan_payment_title(v_parent.contract_id), occurrence_title),
           target_date = coalesce(target_date, v_first),
           contract_id = coalesce(contract_id, v_parent.contract_id),
           pay_to_contact_id = coalesce(pay_to_contact_id, v_lender),
           trade = coalesce(trade, 'Finance'),
           status_note = public.loan_terms_line(v_parent.contract_id),
           last_updated = now(), last_modified_by = 'system:loan'
     where id = v_pay;
  end if;

  insert into public.action_comments (action_id, body, author)
  values (v_pay, 'Started by the loan being secured (' || to_char(current_date, 'YYYY-MM-DD')
                 || '). First payment dated ' || to_char(v_first, 'Mon DD, YYYY') || '. '
                 || coalesce(public.loan_terms_line(v_parent.contract_id), ''), 'system:loan');
  return new;
end $$;

drop trigger if exists trg_actions_loan_secured on public.actions;
create trigger trg_actions_loan_secured
  after update of status on public.actions
  for each row when (new.status = 'Completed' and old.status is distinct from new.status)
  execute function public.fn_loan_secured_starts_payments();

-- ---------------------------------------------------------------------------
-- 6. The terms, once recorded, reach every open payment.
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
  return new;
end $$;

drop trigger if exists trg_contracts_loan_terms on public.contracts;
create trigger trg_contracts_loan_terms
  after update of loan_kind, loan_monthly_payment, loan_interest_rate, loan_principal, loan_maturity_date, loan_lender
  on public.contracts
  for each row execute function public.fn_loan_terms_reach_payments();

-- ---------------------------------------------------------------------------
-- 7. 55 Walnut: open the process against the ClearEdge note.
-- ---------------------------------------------------------------------------
do $walnut$
declare
  v_job uuid := 'f6e4c189-d3fe-4e57-9901-61922e5b21ef';   -- New build
  v_loan uuid := 'cc22cb9e-de08-4cfd-88f2-ff145df2d291';  -- Construction loan note - 55 Walnut (ClearEdge Lending)
  v_me uuid := '8ad2f713-b57d-4b28-9127-55f724ca688f';    -- Shahar's contact
  v_daniel uuid := '1acf2867-4ad1-4e2c-9513-1b628cf70517'; -- "Daniel helped me secure the mortgage."
  v_manual uuid := '910b35e5-2825-42ec-9930-c556499cb7d3'; -- "Monthly mortgage payments are active..."
  v_bp uuid; v_proc uuid; v_secure uuid;
begin
  select id into v_bp from public.blueprint_activity where name = 'Mortgage or construction loan';
  if exists (select 1 from public.actions where project_id = v_job and activity_blueprint_id = v_bp) then
    return;
  end if;

  insert into public.actions
    (action, status, priority, domain, project_id, trade, contract_id, activity_blueprint_id,
     depth_level, hidden_from_trades, assigned_to_contact_id, action_type, source, created_by, notes,
     desired_outcome)
  values
    ('Construction loan - 55 Walnut (ClearEdge Lending, via Daniel Meidan)',
     'In Progress', 'High', 'construction', v_job, 'Finance', v_loan, v_bp,
     1, true, v_me, 'backoffice', 'system:156', 'Claude (156)',
     'The loan process for the ClearEdge construction note, opened 2026-09-16 at Shahar''s request. Its steps are '
     || 'beneath it; the monthly payment recurs on its own; the payoff step is a gate this cannot close before.',
     'The note is paid off at the sale and the discharge is on file')
  returning id into v_proc;

  -- Every step is the owner's business, on the loan, filed under Finance.
  update public.actions
     set contract_id = v_loan, trade = 'Finance', hidden_from_trades = true,
         assigned_to_contact_id = v_me, last_modified_by = 'system:156'
   where parent_action_id = v_proc;

  update public.actions set target_date = current_date + 7
   where parent_action_id = v_proc and step_order = 20;

  -- What Daniel did, filed where it belongs.
  update public.actions
     set parent_action_id = v_proc, last_updated = now(), last_modified_by = 'system:156'
   where id in (v_daniel, v_manual);
  update public.actions
     set notes = coalesce(notes || E'\n\n', '')
              || '[2026-09-16] Moved under the loan process. The monthly payments now recur as their own '
              || 'occurrences beneath it and the payoff step is the gate that closes it - this line is the '
              || 'earlier, hand-written version of the same intent. Cancel it if the process covers it.',
         last_modified_by = 'system:156'
   where id = v_manual;

  -- Step 10 is done: Daniel secured it. Closing it starts the heartbeat.
  select id into v_secure from public.actions where parent_action_id = v_proc and step_order = 10;
  insert into public.action_comments (action_id, body, author)
  values (v_secure, 'Done before this process existed - see "Daniel helped me secure the mortgage." '
                    || '(closed 2026-09-16) beneath the same parent. Note signed 2026-04-13.', 'system:156');
  perform public.close_action(v_secure, false, 'system:156');
end $walnut$;

update public.config
   set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
