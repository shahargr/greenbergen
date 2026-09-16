-- 158b. THE LEDGER TASK WEARS THE TRADE.
--
-- What 158 found when it ran. The asbestos payment already HAD a task -
-- "Check - Asbestos", closed 2026-05-20, imported by hand - but that task
-- carried no contract and no trade, so the trade panel could not claim it.
-- Same for anything imported the same way. And 158's trigger read a
-- payment's direction off its account columns, as fn_transactions_notify_task
-- does; imported rows have no accounts, so an outgoing 'paid' read as 'in'
-- and matched no status. transactions.direction is the column that says it.
--
-- So: a task that a payment points at takes the payment's contract when it
-- has none, and the contract's catalogue trade when it has none; the trigger
-- trusts transactions.direction first; and three contracts that never named
-- a trade get the obvious one - the loan is Finance, the builder's risk
-- policy is Insurance, the toilet rental is Portable toilet - so their
-- payments file under a tile instead of "not filed under a trade".

create or replace function public.fn_transactions_paid_is_done()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_moved boolean; v_dir text; c public.contracts; v_trade text; v_task uuid; v_who text; v_project public.projects;
begin
  if new.action_id is not null or new.contract_id is null or new.amount is null then return new; end if;
  v_dir := coalesce(new.direction, case when new.source_account_id is not null then 'out' else 'in' end);
  select means_money_moved into v_moved
    from public.transaction_statuses
   where status = new.status and direction in (v_dir, 'both') limit 1;
  if not coalesce(v_moved, false) then return new; end if;
  if exists (select 1 from public.actions a where a.source = 'system:transaction:' || new.id::text) then
    return new;
  end if;

  select * into c from public.contracts where id = new.contract_id;
  if c.id is null or c.project_id is null then return new; end if;
  select * into v_project from public.projects where id = c.project_id;
  if v_project.status = 'Completed' then return new; end if;

  select t.trade into v_trade from public.trades t where lower(t.trade) = lower(btrim(c.trade)) limit 1;
  if v_trade is null and c.trade is not null then
    select t.trade into v_trade from public.trades t where public.trade_matches(c.trade, t.trade)
     order by t.sort_order nulls last limit 1;
  end if;
  select coalesce(ct.person_name, ct.name) into v_who from public.contacts ct where ct.id = new.contractor_id;

  begin
    insert into public.actions
      (action, status, priority, domain, project_id, contract_id, trade, action_type,
       target_cost, pay_to_contact_id, target_date, completed_on,
       source, created_by, last_modified_by, notes, accepts_steps)
    values
      (coalesce(nullif(btrim(new.description), ''), 'Payment on ' || c.title),
       'Completed', 'No Priority', coalesce(v_project.domain, 'construction'),
       c.project_id, c.id, v_trade, 'financial transaction',
       new.amount, new.contractor_id, new.paid_on, coalesce(new.paid_on, current_date),
       'system:ledger:' || new.id::text, 'system:ledger', 'system:ledger',
       'Written from the ledger (migration 158): $' || to_char(coalesce(new.amount_usd, new.amount), 'FM999,999,990.00')
       || case when v_who is not null then ' paid to ' || v_who else '' end
       || coalesce(' on ' || to_char(new.paid_on, 'YYYY-MM-DD'), '')
       || coalesce(' · ' || new.paid_via, '')
       || coalesce(' · ref ' || new.payment_reference, '')
       || '. The payment''s receipts are this task''s evidence.',
       false)
    returning id into v_task;
    update public.transactions set action_id = v_task where id = new.id;
  exception when others then
    insert into public.system_trigger_errors (trigger_fn, row_id, sqlstate, message)
    values ('fn_transactions_paid_is_done', new.id, sqlstate, 'Payment left without a task: ' || sqlerrm);
  end;
  return new;
end $$;

-- The contracts that never said their trade.
update public.contracts set trade = 'Finance', last_modified_by = 'Claude (158b)'
 where id = 'cc22cb9e-de08-4cfd-88f2-ff145df2d291' and trade is null;
update public.contracts set trade = 'Insurance', last_modified_by = 'Claude (158b)'
 where id = '4fcc1b7b-a54e-4446-9d99-7d6b1da95712' and trade is null;
update public.contracts set trade = 'Portable toilet', last_modified_by = 'Claude (158b)'
 where id = '48adef45-66e1-4f98-9261-5e2f64590da2' and trade is null;

-- A task a payment points at takes the payment's contract, and the
-- contract's catalogue trade, when it has neither.
update public.actions a
   set contract_id = t.contract_id, last_modified_by = 'Claude (158b)'
  from public.transactions t
 where t.action_id = a.id and a.contract_id is null and t.contract_id is not null
   and exists (select 1 from public.projects p where p.id = a.project_id and p.status is distinct from 'Completed');

update public.actions a
   set trade = x.trade, last_modified_by = 'Claude (158b)'
  from (
    select a2.id,
           coalesce((select tr.trade from public.trades tr where lower(tr.trade) = lower(btrim(c.trade)) limit 1),
                    (select tr.trade from public.trades tr where public.trade_matches(c.trade, tr.trade)
                      order by tr.sort_order nulls last limit 1)) as trade
      from public.actions a2
      join public.contracts c on c.id = a2.contract_id
     where a2.trade is null and c.trade is not null
       and exists (select 1 from public.transactions t where t.action_id = a2.id)
  ) x
 where x.id = a.id and x.trade is not null
   and exists (select 1 from public.projects p where p.id = a.project_id and p.status is distinct from 'Completed');

update public.config
   set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);

-- ---------------------------------------------------------------------------
-- And the spine counts what a finished trade finished. `live` only holds
-- trades with something OPEN, so a trade whose every task is closed came
-- through `idle` with done = 0 - Asbestos, one task, done, "0 done". The
-- idle row now counts its closed tasks. (Applied as "..._c".)
-- ---------------------------------------------------------------------------
do $patch$
declare src text; out_ text;
begin
  select pg_get_functiondef('public.portal_project_trades(uuid)'::regprocedure) into src;
  out_ := replace(src,
    $a$select i.trade, 0::bigint, 0::bigint, null::date, 0::bigint, false from idle i$a$,
    $b$select i.trade, 0::bigint, 0::bigint, null::date,
         (select count(*) from t t3 where t3.trade = i.trade and not t3.is_open), false from idle i$b$);
  if out_ = src then raise exception 'portal_project_trades has drifted at idle done'; end if;
  execute out_;
end $patch$;
