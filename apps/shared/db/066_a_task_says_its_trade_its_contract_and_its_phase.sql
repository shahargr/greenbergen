-- 066 - a task says its trade, its contract and its phase of the build.
--
-- Shahar (2026-09-11): "i need to see completed as well. all tasks should be
-- in sections under trade, contract, building phase. check the data we have
-- and decide what is best."
--
-- WHAT THE DATA SAYS, counted on 55 Walnut's New build (263 tasks, 143 open,
-- every one of them on that single project - there is no job beneath it to
-- group by):
--
--     a resolvable trade      58 of 263   (22%)
--     a contract              25 of 263   (10%)
--     a phase                 55 of 263   (21%)  - phase comes from the trade
--
-- So none of the three can be the ONLY way the list is arranged: each would
-- file four tasks in five under "not recorded". That is the honest finding,
-- and it decides the design - the app keeps its timing buckets (late, this
-- week, waiting, later, undated), which every task belongs to, as the
-- default, and offers trade, contract and phase as groupings you switch to.
-- In those, the untagged tasks gather in a named section with a count, which
-- is itself the useful thing: it is the list of what still needs tagging.
--
-- What this migration does is make all three answerable at all.
--
-- TRADE, in order of how much it is worth: the CONTRACT the task belongs to
-- (a task under the plumbing contract is plumbing, whoever does it), then
-- the SCOPE LINE it implements (project_scope_items.trade - 129 lines on
-- this project carry one), then the person it is assigned to. The first two
-- are new; only the third was there.
--
-- PHASE is not a column anywhere - it is trades.stage, which every one of
-- the 79 trades carries (Site preparation, Rough and mechanical, Finishing,
-- Stairs and railing, Outdoor, Survey & environmental, Buy and Sell,
-- Suppliers, Others), with trade_stages.sort_order giving the order a build
-- actually runs in. So a task's phase is its trade's stage, and anything
-- that has no trade has no phase - the same 21%.
--
-- CONTRACT: portal_tasks said has_contract true/false and threw the contract
-- away. It now carries the id and the title, so a section can be named after
-- the contract it belongs to and lead to it.
CREATE OR REPLACE FUNCTION public.portal_tasks(p_project_id uuid DEFAULT NULL::uuid, p_open_limit integer DEFAULT 250, p_closed_limit integer DEFAULT 150, p_domain text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
with my_ids as (
  select distinct pm.project_id from project_members pm
  where pm.app_user_id = public.current_app_user_id() and pm.status = 'active'
  union
  select p.id from projects p where public.is_superadmin()
),
base as (
  select a.id, a.action, a.status, a.priority, a.target_date, a.last_updated,
         a.notes, a.domain, a.project_id, p.project_name, a.assigned_to_contact_id, a.contract_id,
         a.parent_action_id, a.scope_item_id, a.completed_on,
         (a.status not in ('Completed','Cancelled','Force Cancelled','Superseded')) as is_open
  from actions a
  join projects p on p.id = a.project_id and p.trashed_at is null
  join my_ids m on m.project_id = a.project_id
  where (p_project_id is null or a.project_id = p_project_id)
    and (p_domain is null or a.domain = p_domain)
),
open_t as (
  select * from base where is_open
  order by target_date asc nulls last limit greatest(p_open_limit, 0)),
closed_t as (
  select * from base where not is_open
  order by coalesce(completed_on, last_updated::date) desc nulls last limit greatest(p_closed_limit, 0)),
u as (select * from open_t union all select * from closed_t),
-- The trade, resolved once so the phase can hang off it: the contract it is
-- under, else the scope line it implements, else the person it is on.
t as (
  select u.*,
    coalesce(
      (select t3.trade from trades t3 where lower(t3.trade) = lower(ct.trade) limit 1),
      initcap(ct.trade),
      (select t4.trade from project_scope_items si
         left join trades t4 on lower(t4.trade) = lower(si.trade)
        where si.id = u.scope_item_id and si.trade is not null and lower(si.trade) <> 'all'
        limit 1),
      (select initcap(si2.trade) from project_scope_items si2
        where si2.id = u.scope_item_id and si2.trade is not null and lower(si2.trade) <> 'all'),
      (select tr.trade from contact_trade_roles tr
        join trades t2 on t2.trade = tr.trade
        where tr.contact_id = u.assigned_to_contact_id
          and (coalesce(t2.is_construction, false) or coalesce(t2.is_worker_trade, false))
        order by t2.sort_order nulls last limit 1)) as trade,
    ct.title as contract_title
  from u left join contracts ct on ct.id = u.contract_id
)
select coalesce(jsonb_agg(jsonb_build_object(
  'id', t.id,
  'action', coalesce(t.action, '(untitled)'),
  'status', t.status,
  'priority', t.priority,
  'target_date', t.target_date,
  'last_updated', t.last_updated,
  'completed_on', t.completed_on,
  'notes', left(t.notes, 400),
  'project', t.project_name,
  'project_id', t.project_id,
  'domain', t.domain,
  'has_contract', t.contract_id is not null,
  'contract_id', t.contract_id,
  'contract', t.contract_title,
  'state', case when t.is_open then 'open' else 'closed' end,
  'assignee_id', t.assigned_to_contact_id,
  'assignee', coalesce(c.person_name, c.name),
  'parent_id', t.parent_action_id,
  'parent_title', (select pa.action from actions pa where pa.id = t.parent_action_id),
  'open_children', (select count(*) from actions ch where ch.parent_action_id = t.id
                    and ch.status not in ('Completed','Cancelled','Force Cancelled','Superseded')),
  'trade', t.trade,
  -- The phase of the build this belongs to, and the order a build runs in.
  -- No trade, no phase: the app names that section rather than inventing one.
  'phase', (select tr.stage from trades tr where tr.trade = t.trade),
  'phase_order', (select ts.sort_order from trades tr
                    join trade_stages ts on ts.stage = tr.stage
                   where tr.trade = t.trade)
)), '[]'::jsonb)
from t
left join contacts c on c.id = t.assigned_to_contact_id;
$function$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
