-- 078  MONEY GATHERS UNDER THE TRADE THAT SPENT IT
--
-- Shahar (2026-09-13): "we need to improve receipt logging process. for
-- example, every receipt is likely connected to a phase in the project.
-- foundation, frame, etc... so the open tasks should be nested under a trade,
-- based on what they are, etc. even when i click on trade to sort, it might
-- sort, but not show things nested under every trade. build hierarchy so i
-- can see everything Frame related (example the receipt i need to pay) and
-- under each category allow me to log a payment."
--
-- The hierarchy he is describing already exists in the data and nothing on
-- screen was drawing it: a PHASE (trade_stages: Site preparation, Rough and
-- mechanical, Finishing...) holds TRADES, a trade holds TASKS, and a task
-- holds the money. portal_tasks already returns trade, phase and phase_order
-- on every row, so the nesting is the app's job and needs no read.
--
-- What the app could NOT do was put a number next to a category. A payment
-- hangs off a task (transactions.action_id), and no function returned money
-- per task for a whole site - the project screen would have had one round
-- trip per task to find out whether a receipt was outstanding. That is what
-- this adds: one read, the whole family, gated by the same money ladder that
-- gates everything else.
--
-- The gate is per ROW, not per project: can_see_money_on(project, contract)
-- is what portal_task_detail uses, so a contract-bounded trade sees the money
-- on their own contract and nothing else, and a crew member sees an empty
-- object rather than a refusal.

create or replace function public.portal_task_money(p_project uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with fam as (
    select project_id from public.fin_family(p_project)
  ),
  tx as (
    select t.action_id,
           -- The one foreign-currency row in this database carries its
           -- converted figure; everything else is already dollars.
           coalesce(t.amount_usd, t.amount, 0) as amt,
           coalesce(ts.means_money_moved, false) as moved,
           coalesce(ts.is_terminal, false) as ended,
           coalesce(t.direction, 'out') as dir
      from public.transactions t
      join fam on fam.project_id = t.project_id
      left join public.transaction_statuses ts on ts.status = t.status
     where t.action_id is not null
       and public.can_see_money_on(t.project_id, t.contract_id)
  ),
  per as (
    select action_id,
           -- SPENT is money that actually left. refunded and cancelled both
           -- carry means_money_moved = false, so money that came back stops
           -- counting on its own (migration 073) without naming a status here.
           coalesce(sum(amt) filter (where moved), 0) as spent,
           -- TO PAY is the receipt sitting on the task: committed or invoiced,
           -- not moved, not ended, and going out rather than coming in.
           coalesce(sum(amt) filter (where not moved and not ended and dir <> 'in'), 0) as owed,
           count(*) as n
      from tx
     group by action_id
  )
  select jsonb_build_object(
    'tasks', coalesce((
      select jsonb_object_agg(action_id::text, jsonb_build_object(
        'spent', round(spent), 'owed', round(owed), 'n', n))
        from per), '{}'::jsonb),
    'spent', (select round(coalesce(sum(spent), 0)) from per),
    'owed',  (select round(coalesce(sum(owed), 0)) from per),
    -- Whether to OFFER logging one here at all. The same gate
    -- portal_task_detail uses for its own payment drawer (migration 065), so
    -- a category never grows a "log a payment" row that the database would
    -- then refuse.
    'can_log', public.fin_may_record(p_project)
  );
$$;

comment on function public.portal_task_money(uuid) is
  'Money per task across a project and everything beneath it, for nesting under trade and phase. Gated per row by can_see_money_on.';

revoke all on function public.portal_task_money(uuid) from public, anon;
grant execute on function public.portal_task_money(uuid) to authenticated;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
