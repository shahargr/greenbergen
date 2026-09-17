-- 162. THE LOAN KNOWS WHEN THE HOUSE SELLS - A GOOD DAY AND A BAD DAY.
--
-- Shahar (2026-09-17), on the monthly payment task he had dated 2027-06-30:
-- "was thinking as place holder till I plan to sell so we can calculate
-- backwards. End date should have good and bad scenario."
--
-- A task's date was carrying a fact about the HOUSE: the day it is meant to
-- sell, which is the day the note is paid off. That fact belongs on the
-- property, once, as two dates rather than one - the sale you plan for and
-- the sale you can live with - and everything that counts backwards from it
-- reads it from there: the loan's schedule, what the loan will have cost by
-- each day, the payment task's own line.
--
-- WHERE IT LIVES. projects.sale_target_good / sale_target_bad, on the
-- property (55 Walnut Drive). A job beneath it inherits: project_sale_targets()
-- walks up from any project to the nearest one that has the dates, so the
-- loan on New build reads the house's plan.
--
-- WHAT READS IT.
--   * loan_schedule_build: the forecast now runs to the BAD day (the longer
--     one) instead of a flat two years, still capped at maturity, and drafts
--     it had written past that day are taken back - money after the sale is
--     not planned money.
--   * loan_exit_scenarios(contract): for each day - payments left, what they
--     add up to, what has been paid so far, the principal due, the total cost
--     of the loan by that day. The money screen shows both lines.
--   * loan_terms_line: says the plan at the end of the sentence, so the
--     payment task and every draft carry it.
-- Changing the dates on the property re-runs all of it (trigger).
--
-- The payment task goes back to its real date: the first unpaid month.

-- ---------------------------------------------------------------------------
-- 1. Two dates on a project.
-- ---------------------------------------------------------------------------
alter table public.projects add column if not exists sale_target_good date;
alter table public.projects add column if not exists sale_target_bad  date;
alter table public.projects drop constraint if exists chk_projects_sale_targets;
alter table public.projects add constraint chk_projects_sale_targets
  check (sale_target_good is null or sale_target_bad is null or sale_target_good <= sale_target_bad);
comment on column public.projects.sale_target_good is
  'The day this house is planned to sell in the good case. Jobs beneath inherit it (project_sale_targets); loans count backwards from it.';
comment on column public.projects.sale_target_bad is
  'The day this house sells in the bad case - the latest you plan for. The loan schedule runs to this day.';

-- The nearest plan, walking up from any project.
create or replace function public.project_sale_targets(p_project uuid)
returns table (project_id uuid, project_name text, good date, bad date)
language sql stable security definer
set search_path to 'public'
as $$
  with recursive up as (
    select p.id, p.project_name, p.parent_project_id, p.sale_target_good, p.sale_target_bad, 0 as depth
      from public.projects p where p.id = p_project
    union all
    select p.id, p.project_name, p.parent_project_id, p.sale_target_good, p.sale_target_bad, up.depth + 1
      from public.projects p join up on p.id = up.parent_project_id
     where up.depth < 12
  )
  select u.id, u.project_name, u.sale_target_good, u.sale_target_bad
    from up u
   where (u.sale_target_good is not null or u.sale_target_bad is not null)
     -- A member's read is gated; a trigger or a migration has no app user
     -- and reads freely, so the payment task's line can carry the plan.
     -- Anon cannot execute this at all (revoked below).
     and (public.current_app_user_id() is null or public.is_superadmin() or public.is_project_member(p_project))
   order by u.depth
   limit 1;
$$;
revoke all on function public.project_sale_targets(uuid) from public, anon;
grant execute on function public.project_sale_targets(uuid) to authenticated;

-- Setting them: whoever may edit the project. Either may be cleared.
create or replace function public.portal_project_sale_targets(p_project uuid, p_good date default null, p_bad date default null)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if not public.can_edit_project(p_project) then
    return jsonb_build_object('ok', false, 'code', 'NOT_YOURS', 'reason', 'Only somebody who runs this project can set when it sells.');
  end if;
  if p_good is not null and p_bad is not null and p_good > p_bad then
    return jsonb_build_object('ok', false, 'code', 'ORDER', 'reason', 'The good day cannot come after the bad one.');
  end if;
  update public.projects
     set sale_target_good = p_good, sale_target_bad = p_bad,
         last_modified_by = coalesce(nullif(current_setting('sgr.actor', true), ''), 'portal:sale targets')
   where id = p_project;
  return jsonb_build_object('ok', true, 'good', p_good, 'bad', p_bad);
end $$;
revoke all on function public.portal_project_sale_targets(uuid, date, date) from public, anon;
grant execute on function public.portal_project_sale_targets(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The terms line says the plan.
-- ---------------------------------------------------------------------------
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
      || coalesce((select ' · Sale planned: '
                            || coalesce('good ' || to_char(s.good, 'Mon DD, YYYY'), '')
                            || case when s.good is not null and s.bad is not null then ', ' else '' end
                            || coalesce('bad ' || to_char(s.bad, 'Mon DD, YYYY'), '')
                     from public.project_sale_targets(c.project_id) s), '')
    end
  from (select p_contract as id) x
  left join public.contracts c on c.id = x.id;
$$;

-- ---------------------------------------------------------------------------
-- 3. The schedule runs to the bad day, and takes back what lies past it.
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
  v_sale_bad date;
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
  -- THE BAD DAY IS THE HORIZON (162): the house sells by then in every plan,
  -- so the note is paid off by then in every plan. Before it, a flat two
  -- years was the best guess available.
  select s.bad into v_sale_bad from public.project_sale_targets(c.project_id) s;
  v_horizon  := coalesce(p_through, c.end_date, c.desired_completion_date, v_sale_bad,
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

  -- Drafts the schedule itself wrote for months after the sale are not
  -- planned money any more. Only its own rows, only forecasts: a draft
  -- somebody typed by hand is theirs to remove.
  if p_through is null and v_sale_bad is not null then
    delete from public.transactions t
     where t.contract_id = c.id and t.status = 'forecast'
       and t.created_by = 'system:loan schedule'
       and coalesce(t.paid_on, t.target_date) > v_horizon;
  end if;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- 4. What the loan costs by each day.
-- ---------------------------------------------------------------------------
create or replace function public.loan_exit_scenarios(p_contract uuid)
returns jsonb
language sql stable security definer
set search_path to 'public'
as $$
  with c as (select * from public.contracts where id = p_contract and contract_type = 'loan'),
  s as (select * from public.project_sale_targets((select project_id from c))),
  paid as (
    select coalesce(sum(t.amount), 0) as amt, count(*) as n
      from public.transactions t, c
     where t.contract_id = c.id and t.direction = 'out'
       and t.status not in ('forecast', 'cancelled', 'void', 'refunded')
  ),
  one as (
    select d.label, d.day,
           (select count(*) from public.transactions t, c
             where t.contract_id = c.id and t.status = 'forecast'
               and coalesce(t.paid_on, t.target_date) <= d.day) as left_n,
           (select coalesce(sum(coalesce(t.amount, 0)), 0) from public.transactions t, c
             where t.contract_id = c.id and t.status = 'forecast'
               and coalesce(t.paid_on, t.target_date) <= d.day) as to_come
      from (values ('good', (select good from s)), ('bad', (select bad from s))) d(label, day)
     where d.day is not null
  )
  select case when (select id from c) is null or (select count(*) from s) = 0 then null else
    jsonb_build_object(
      'source', (select jsonb_build_object('project_id', s.project_id, 'project', s.project_name) from s),
      'paid_so_far', (select amt from paid),
      'paid_n', (select n from paid),
      'payoff', (select case when c.loan_kind in ('interest only', 'balloon', 'line of credit') then c.loan_principal else null end from c),
      'scenarios', (select jsonb_object_agg(o.label, jsonb_build_object(
                       'date', o.day, 'payments_left', o.left_n, 'to_come', o.to_come,
                       'total_cost', (select amt from paid) + o.to_come))
                      from one o))
  end;
$$;
comment on function public.loan_exit_scenarios(uuid) is
  'For a loan: by the good sale day and the bad one, how many payments are left, what they add up to, what has been paid, the principal due (interest only / balloon / line of credit), and the total cost of the loan by that day. Null when the house has no plan.';

-- ---------------------------------------------------------------------------
-- 5. The money screen carries it on every loan contract.
-- ---------------------------------------------------------------------------
do $patch$
declare src text; out_ text;
begin
  select pg_get_functiondef('public.project_financials(uuid)'::regprocedure) into src;
  out_ := replace(src,
    $a$        'change_orders', ($a$,
    $b$        'loan', case when c.contract_type = 'loan'
                  then jsonb_build_object('terms', public.loan_terms_line(c.id), 'exit', public.loan_exit_scenarios(c.id))
                  else null end,
        'change_orders', ($b$);
  if out_ = src then raise exception 'project_financials has drifted - the change_orders anchor was not found'; end if;
  execute out_;
end $patch$;

-- ---------------------------------------------------------------------------
-- 6. Changing the plan on the house reaches its loans.
-- ---------------------------------------------------------------------------
create or replace function public.fn_projects_sale_targets_reach_loans()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare l record;
begin
  for l in
    select c.id from public.contracts c
     where c.contract_type = 'loan'
       and c.project_id in (select id from public.project_ancestry_down(new.id))
  loop
    perform public.loan_schedule_build(l.id);
    update public.actions a
       set status_note = public.loan_terms_line(l.id), last_updated = now(), last_modified_by = 'system:loan'
     where a.contract_id = l.id and a.cadence = 'monthly' and a.action_type = 'financial transaction'
       and a.status not in ('Completed','Cancelled','Force Cancelled');
  end loop;
  return new;
end $$;

drop trigger if exists trg_projects_sale_targets on public.projects;
create trigger trg_projects_sale_targets
  after update of sale_target_good, sale_target_bad on public.projects
  for each row
  when (old.sale_target_good is distinct from new.sale_target_good or old.sale_target_bad is distinct from new.sale_target_bad)
  execute function public.fn_projects_sale_targets_reach_loans();

-- ---------------------------------------------------------------------------
-- 7. 55 Walnut: the plan, as placeholders to be moved. Good = the day Shahar
--    typed on the task; bad = six months later. The payment task goes back
--    to the first unpaid month.
-- ---------------------------------------------------------------------------
update public.projects
   set sale_target_good = date '2027-06-30', sale_target_bad = date '2027-12-31',
       last_modified_by = 'migration 162'
 where id = 'a62c81d4-8cd3-4450-83b7-29cbbd65ab84';

update public.actions
   set target_date = date '2026-10-01', last_updated = now(), last_modified_by = 'migration 162'
 where id = '5061dad9-459f-41ec-a18d-4d54671ecddc';

update public.config
   set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
