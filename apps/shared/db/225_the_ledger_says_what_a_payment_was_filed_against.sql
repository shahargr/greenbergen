-- THE LEDGER SAYS WHAT A PAYMENT WAS FILED AGAINST.
--
-- Shahar, 2026-09-23: "allow me to see a list of all financial transactions
-- made and captured in a table with the data relevant / such as contract,
-- paid to, etc... make sure every payment logged is logged against a
-- contract, trade, or scope item."
--
-- portal_money_ledger already had the payee, the trade and the contract id;
-- the audit needs the contract's NAME and the BUDGET LINE to read at a
-- glance. Two additive keys - 'contract' (title) and 'budget_line' (with
-- its id) - same shape otherwise, so existing readers keep working. The
-- "unfiled" verdict itself is derived by the reader: no contract, no trade,
-- no budget line means nobody can say what the money bought.
create or replace function public.portal_money_ledger(p_project uuid default null::uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  with mine as (
    select distinct pm.project_id from public.project_members pm
     where pm.app_user_id = public.current_app_user_id() and pm.status = 'active'
    union
    select p.id from public.projects p where public.is_superadmin()
  ),
  rows as (
    select t.id, t.description, t.amount, coalesce(t.currency, 'USD') as currency,
           t.paid_on, t.status, t.direction, t.action_id, t.contract_id,
           t.budget_category_id, bc.category as budget_line,
           t.project_id, p.project_name,
           coalesce(tc.title, ac.title) as contract_title,
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
      left join public.budget_categories bc on bc.id = t.budget_category_id
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
           'action_id', r.action_id, 'contract_id', r.contract_id,
           'contract', r.contract_title,
           'budget_category_id', r.budget_category_id, 'budget_line', r.budget_line)
         order by r.paid_on desc nulls last, r.amount desc nulls last), '[]'::jsonb)
    from rows r;
$function$;

comment on function public.portal_money_ledger(uuid) is
  'Every transaction the caller may see, one row each, with payee, trade, '
  'contract (id and title, 225) and budget line (225) - the audit list that '
  'shows which payments are filed against nothing.';
