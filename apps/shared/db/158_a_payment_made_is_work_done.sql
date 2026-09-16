-- 158. A PAYMENT MADE IS WORK DONE - AND THE HOUSE YOU BOUGHT GETS INSPECTED.
--
-- Shahar (2026-09-16), on Asbestos under New build: "i saw a transaction
-- logged, but it wasn't logged against the trade somehow. meaning, when i
-- click on the panel on the main project page, the ledger was not visible
-- as completed task." And: "The category where Asbestos sits should be
-- called Existing house inspection. This way, pest control, asbestos and
-- lead can all sit in one category."
--
-- TWO THINGS.
--
-- 1. THE LEDGER IS WORK. The $634.41 asbestos inspection was paid on May 20
--    against the asbestos contract, and the trade panel said "Nothing is
--    filed under asbestos" - because a task joins a trade through a contract
--    or a scope line, and the payment was a transaction, not a task. A
--    payment logged through the app gets a confirmation task from
--    fn_transactions_notify_task, which closes when the payee confirms and
--    then reads as done work under the trade. A payment that arrived any
--    other way - imported, historic, recorded straight at 'paid' - got no
--    task at all, and twenty of them sat invisible on New build.
--
--    So: money that moved on a contract, with no task pointing at it, is a
--    COMPLETED task from now on - a financial transaction, on the contract,
--    under the contract's trade, dated the day it was paid, costing what it
--    cost, with the transaction's own receipts as its evidence (the close
--    gate already counts file_links.transaction_id). The trigger yields to
--    the confirmation flow: if a task already names the transaction, nothing
--    is written. The twenty are backfilled.
--
-- 2. EXISTING HOUSE INSPECTION is a stage of the build, between buying and
--    surveying: what you have somebody look at in the house that is already
--    standing before you touch it. Asbestos, Pest Control and Oil Tank
--    Sweep move into it; Home Inspection moves in from Buy and Sell, because
--    that is what it is; and Lead Paint is added, because Shahar named it
--    and the catalogue did not have it. "Survey & environmental" keeps the
--    surveyor and the site engineer - they are about the land, not the
--    house - so it is a new stage rather than a rename.
--
-- Also: the asbestos contract's trade was spelled "asbestos abatement" - not
-- a catalogue trade - and only fuzzy matching made the spine find it. It is
-- "Asbestos" now, the way the award screen would have written it.

-- ---------------------------------------------------------------------------
-- 1. The stage and the trades in it.
-- ---------------------------------------------------------------------------
insert into public.trade_stages (stage, sort_order, in_spine)
values ('Existing house inspection', 15, true)
on conflict (stage) do nothing;

update public.trades
   set stage = 'Existing house inspection'
 where trade in ('Asbestos', 'Pest Control', 'Oil Tank Sweep & Detection', 'Home Inspection');

insert into public.trades
  (trade, stage, sort_order, is_worker_trade, is_professional, is_construction, is_service, is_supply,
   schedulable, license_label, default_duration_days)
values
  ('Lead Paint', 'Existing house inspection', 4, true, true, false, false, false,
   true, 'Lead inspector / risk assessor certification', 3)
on conflict (trade) do nothing;

-- Order within the stage: what you look at first.
update public.trades set sort_order = 1 where trade = 'Home Inspection';
update public.trades set sort_order = 2 where trade = 'Pest Control';
update public.trades set sort_order = 3 where trade = 'Asbestos';
update public.trades set sort_order = 4 where trade = 'Lead Paint';
update public.trades set sort_order = 5 where trade = 'Oil Tank Sweep & Detection';

update public.contracts
   set trade = 'Asbestos', last_modified_by = 'Claude (158)'
 where id = '1ca76a18-b507-418e-8e85-cbdae4d43ef0' and lower(trade) = 'asbestos abatement';

-- ---------------------------------------------------------------------------
-- 2. Money that moved on a contract is a completed task.
-- ---------------------------------------------------------------------------
create or replace function public.fn_transactions_paid_is_done()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_moved boolean; v_dir text; c public.contracts; v_trade text; v_task uuid; v_who text; v_project public.projects;
begin
  if new.action_id is not null or new.contract_id is null or new.amount is null then return new; end if;
  v_dir := case when new.source_account_id is not null then 'out' else 'in' end;
  select means_money_moved into v_moved
    from public.transaction_statuses
   where status = new.status and direction in (v_dir, 'both') limit 1;
  if not coalesce(v_moved, false) then return new; end if;
  -- The confirmation flow owns this one: it wrote a task that closes when
  -- the payee confirms, and that task is the done work.
  if exists (select 1 from public.actions a where a.source = 'system:transaction:' || new.id::text) then
    return new;
  end if;

  select * into c from public.contracts where id = new.contract_id;
  if c.id is null or c.project_id is null then return new; end if;
  select * into v_project from public.projects where id = c.project_id;
  if v_project.status = 'Completed' then return new; end if;

  -- The catalogue spelling of the contract's trade, or the nearest one.
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

drop trigger if exists trg_transactions_paid_is_done on public.transactions;
create trigger trg_transactions_paid_is_done
  after insert or update of status, contract_id on public.transactions
  for each row execute function public.fn_transactions_paid_is_done();

-- The backfill: every payment that moved on a contract and has no task.
-- Nudging status to itself fires the trigger with its own rules.
update public.transactions t
   set status = t.status
 where t.action_id is null
   and t.contract_id is not null
   and t.amount is not null
   and exists (select 1 from public.transaction_statuses s
                where s.status = t.status and s.means_money_moved
                  and s.direction in ((case when t.source_account_id is not null then 'out' else 'in' end), 'both'))
   and not exists (select 1 from public.actions a where a.source = 'system:transaction:' || t.id::text)
   -- A completed project's ledger is locked (fn_block_completed_project_writes)
   -- and would refuse even a no-op nudge; its history stays as it is.
   and exists (select 1 from public.projects p where p.id = t.project_id and p.status is distinct from 'Completed');

update public.config
   set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
