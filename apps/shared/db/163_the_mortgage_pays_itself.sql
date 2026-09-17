-- 163. THE MORTGAGE PAYS ITSELF.
--
-- Shahar (2026-09-17): "the mortgage is being paid automatically every
-- month. I would like to know what was paid, and then I would like to know
-- what is going to be paid."
--
-- The lender draws it by ACH on the first. Nobody presses anything, so
-- nothing in this system should wait for somebody to press anything: a draft
-- whose day has passed IS a payment. Until now the ledger held August and
-- September as "planned" two weeks after the money had left.
--
-- contracts.autopay says so on the contract. Once a day (pg_cron, 04:20) the
-- tick runs over every loan with it set:
--   1. the monthly payment task for any month whose day has passed is closed
--      by the system, which (156/159) marks that month's draft paid, binds
--      it to the task and dates the next occurrence;
--   2. any draft whose day has passed and no task reached - a month before
--      the task existed - is marked paid directly, drawn by the lender; the
--      ledger writes its completed task for it as it does for any payment
--      made (158);
--   3. the schedule is topped up to the bad day (162).
-- The payee-confirmation notice is stood down for these writes: the lender
-- does not confirm receipt of what it took.
--
-- The money screen then answers both questions on the loan's card: what was
-- paid, with its total, and what is coming, with its total and the last day.

alter table public.contracts add column if not exists autopay boolean not null default false;
comment on column public.contracts.autopay is
  'The counterparty draws each scheduled payment itself (ACH on the due date). A draft whose day has passed is a payment: loan_autopay_tick() records it without anybody pressing anything.';

create or replace function public.loan_autopay_tick()
returns integer
language plpgsql security definer
set search_path to 'public'
as $$
declare
  c record; t record; v_task uuid; guard int; n int := 0;
begin
  for c in
    select ct.id from public.contracts ct
     where ct.contract_type = 'loan' and ct.autopay
       and lower(ct.status) not in ('cancelled', 'complete', 'placeholder')
  loop
    -- 1. The month's task, for every month whose day has passed. Closing it
    --    is what marks the draft paid and dates the next one (156/159), so
    --    the chain of occurrences stays whole. Forced: an autopay draw does
    --    not wait on a photograph. Bounded, so a task dated years back cannot
    --    spin.
    guard := 0;
    loop
      select a.id into v_task from public.actions a
       where a.contract_id = c.id and a.cadence = 'monthly'
         and a.action_type = 'financial transaction'
         and a.status not in ('Completed', 'Cancelled', 'Force Cancelled')
         and a.target_date is not null and a.target_date <= current_date
       order by a.target_date limit 1;
      exit when v_task is null or guard >= 36;
      perform public.close_action(v_task, true, 'system:autopay');
      guard := guard + 1;
    end loop;

    -- 2. Drafts whose day has passed and no task reached.
    perform set_config('sgr.skip_payment_notice', '1', true);
    for t in
      select tx.id from public.transactions tx
       where tx.contract_id = c.id and tx.status = 'forecast'
         and coalesce(tx.paid_on, tx.target_date) <= current_date
       order by coalesce(tx.paid_on, tx.target_date)
    loop
      update public.transactions
         set status = 'paid',
             paid_on = coalesce(paid_on, target_date),
             last_modified_by = 'system:autopay',
             notes = coalesce(notes || E'\n', '')
                     || 'Drawn by the lender automatically (autopay); recorded ' || to_char(current_date, 'YYYY-MM-DD') || '.'
       where id = t.id;
      n := n + 1;
    end loop;
    perform set_config('sgr.skip_payment_notice', '0', true);

    -- 3. Keep the schedule ahead.
    perform public.loan_schedule_build(c.id);
  end loop;
  return n;
end $$;
comment on function public.loan_autopay_tick() is
  'Daily. For every loan with autopay: closes the payment task for months whose day has passed (which marks the draft paid and dates the next), marks any other past-due draft paid, tops up the schedule. Returns the drafts it marked paid directly.';

-- Once a day, after the other night jobs.
select cron.schedule('loan-autopay', '20 4 * * *', $$select public.loan_autopay_tick()$$);

-- The money screen says it.
do $patch$
declare src text; out_ text;
begin
  select pg_get_functiondef('public.project_financials(uuid)'::regprocedure) into src;
  out_ := replace(src,
    $a$'exit', public.loan_exit_scenarios(c.id))$a$,
    $b$'exit', public.loan_exit_scenarios(c.id), 'autopay', c.autopay)$b$);
  if out_ = src then raise exception 'project_financials has drifted - the loan_exit_scenarios anchor was not found'; end if;
  execute out_;
end $patch$;

-- ClearEdge draws on the first. Run the tick once now: August and September
-- become what they are.
update public.contracts set autopay = true, last_modified_by = 'migration 163'
 where id = 'cc22cb9e-de08-4cfd-88f2-ff145df2d291';
select public.loan_autopay_tick();

update public.config
   set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
