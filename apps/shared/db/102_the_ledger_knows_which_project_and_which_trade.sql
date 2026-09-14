-- 102. THE LEDGER KNOWS WHICH PROJECT AND WHICH TRADE.
--
-- Shahar (2026-09-14): "under money, club transactions by projects, and then
-- by trade."
--
-- The Money screen was a list of PROJECTS and nothing else - the payments
-- themselves were only reachable one job at a time, which is no use when the
-- question is "what have I spent on framing". This is the one read behind the
-- new screen: every payment on every job you hold a seat on, already carrying
-- the project it belongs to and the trade it was for.
--
-- The trade is not stored on a transaction, so it is inferred, nearest first:
--   1. the task's own trade        (actions.trade, migration 099)
--   2. the trade on the task's contract
--   3. the trade on the transaction's own contract
-- and matched back to public.trades where the spelling allows, so "plumbing"
-- and "Plumbing" are one heading rather than two. A payment none of that
-- reaches is filed under no trade and the screen says so, because that is
-- something somebody has to fix and hiding it is how it stays unfixed.
--
-- Who may see it is not this function's business: can_see_money_on and the
-- active project_members rows decide, exactly as everywhere else.
create or replace function public.portal_money_ledger(p_project uuid default null)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  with mine as (
    select distinct pm.project_id from public.project_members pm
     where pm.app_user_id = public.current_app_user_id() and pm.status = 'active'
    union
    select p.id from public.projects p where public.is_superadmin()
  ),
  rows as (
    select t.id, t.description, t.amount, coalesce(t.currency, 'USD') as currency,
           t.paid_on, t.status, t.direction, t.action_id, t.contract_id,
           t.project_id, p.project_name,
           coalesce(
             a.trade,
             (select tr.trade from public.trades tr where lower(tr.trade) = lower(ac.trade) limit 1),
             initcap(ac.trade),
             (select tr2.trade from public.trades tr2 where lower(tr2.trade) = lower(tc.trade) limit 1),
             initcap(tc.trade)
           ) as trade,
           coalesce(c.person_name, c.name) as payee,
           sa.name as from_account
      from public.transactions t
      join public.projects p on p.id = t.project_id and p.trashed_at is null
      join mine m on m.project_id = t.project_id
      left join public.actions a on a.id = t.action_id
      left join public.contracts ac on ac.id = a.contract_id
      left join public.contracts tc on tc.id = t.contract_id
      left join public.contacts c on c.id = t.contractor_id
      left join public.money_accounts sa on sa.id = t.source_account_id
     where public.can_see_money_on(t.project_id, t.contract_id)
       and (p_project is null or t.project_id = p_project)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'description', r.description, 'amount', r.amount,
           'currency', r.currency, 'paid_on', r.paid_on, 'status', r.status,
           -- 'out' is money leaving, 'in' is money coming back. Derived from
           -- the accounts since migration 092; the column is still correct.
           'direction', r.direction,
           'project_id', r.project_id, 'project', r.project_name,
           'trade', r.trade, 'payee', r.payee,
           'from_account', r.from_account,
           'action_id', r.action_id, 'contract_id', r.contract_id)
         order by r.paid_on desc nulls last, r.amount desc nulls last), '[]'::jsonb)
    from rows r;
$function$;

grant execute on function public.portal_money_ledger(uuid) to authenticated;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
