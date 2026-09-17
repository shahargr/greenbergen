-- 165. A CONTRACT KNOWS WHO GETS PAID, AND FROM WHERE.
--
-- Shahar (2026-09-17), on the Log a payment screen: "If this is part of a
-- contract, you can pull the right source and target automatically?"
--
-- Yes: the party to the contract is who gets paid, and the account the last
-- payment on it left from is where the next one leaves from. One read per
-- job family, keyed by contract, for the payment screens to fill their two
-- mandatory slots the moment a task with a contract is chosen. Gated the
-- way the money screen is (fin_may_record).
--
-- The same screen also changed shape (no migration): the task is found in
-- two moves - which job, then which task, with a search box over the job -
-- because one list of 145 open tasks "is not possible to search"; and From
-- and To are both required, under the heading Transaction.

create or replace function public.portal_contract_defaults(p_project uuid)
returns jsonb
language sql stable security definer
set search_path to 'public'
as $$
  with fam as (select project_id from public.fin_family(p_project)),
  cs as (
    select c.id, c.title, c.trade, c.project_id,
           coalesce(
             (select coalesce(k.person_name, k.name) from public.contacts k where k.id = c.contractor_id),
             (select co.company_name from public.companies co where co.id = c.counterparty_company_id),
             (select coalesce(k.person_name, k.name) from public.contacts k where k.id = c.counterparty_contact_id)) as party,
           (select coalesce(a.name, t.paid_from_account)
              from public.transactions t
              left join public.money_accounts a on a.id = t.source_account_id
             where t.contract_id = c.id and coalesce(t.direction, 'out') = 'out'
               and t.status <> 'forecast'
             order by t.paid_on desc nulls last, t.created_at desc limit 1) as last_account,
           (select m.name from public.transactions t
              join public.payment_methods m on m.id = t.payment_method_id
             where t.contract_id = c.id and t.status <> 'forecast'
             order by t.paid_on desc nulls last, t.created_at desc limit 1) as last_method
      from public.contracts c
      join fam on fam.project_id = c.project_id
     where lower(c.status) not in ('cancelled')
  )
  select case when not public.fin_may_record(p_project) then '[]'::jsonb else
    coalesce((select jsonb_agg(jsonb_build_object(
      'contract_id', cs.id, 'title', cs.title, 'trade', cs.trade,
      'party', cs.party, 'account', cs.last_account, 'method', cs.last_method) order by cs.title)
      from cs), '[]'::jsonb) end;
$$;
revoke all on function public.portal_contract_defaults(uuid) from public, anon;
grant execute on function public.portal_contract_defaults(uuid) to authenticated;
comment on function public.portal_contract_defaults(uuid) is
  'Per contract on a job family: who gets paid (the party), the account the last payment left from, and the rail it went on. Fills the payment screens'' From and To when a task with a contract is chosen.';

update public.config
   set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
