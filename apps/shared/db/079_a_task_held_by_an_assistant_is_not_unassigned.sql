-- 079  A TASK HELD BY AN ASSISTANT IS NOT UNASSIGNED
--
-- Found while filing untagged work under whoever holds it (Shahar,
-- 2026-09-13: "anything you don't know club under the owner"). On 55 Walnut,
-- 53 open tasks came back with no assignee - and every single one of them is
-- held by a PERSONA. Not one is genuinely unheld:
--
--   truly_none 0 · persona_held 53
--
-- actions carries two holders and the constraint chk_assigned_to_one_owner
-- says a task has exactly one: a CONTACT (a person) or a PERSONA (Zoe, Bobby,
-- the System Architect - the assistants that run the standing work).
-- portal_tasks only ever read the contact, so persona-held work has always
-- read as "unassigned" on every screen in the contractor app. Harmless while
-- it was one word on a row; not harmless now that it becomes a heading with
-- forty-six tasks under it saying nobody is on them.
--
-- So the read tells the truth: the holder's NAME whoever holds it, and a word
-- saying which kind of holder that is, so a screen can badge an assistant
-- without pretending it is a person. assignee_id stays the CONTACT id and
-- nothing else - "is this mine" is a question about people, and every caller
-- that asks it must keep getting the same answer.

create or replace function public.portal_tasks(
  p_project_id uuid default null,
  p_open_limit integer default 250,
  p_closed_limit integer default 150,
  p_domain text default null)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
with my_ids as (
  select distinct pm.project_id from project_members pm
  where pm.app_user_id = public.current_app_user_id() and pm.status = 'active'
  union
  select p.id from projects p where public.is_superadmin()
),
base as (
  select a.id, a.action, a.status, a.priority, a.target_date, a.last_updated,
         a.notes, a.domain, a.project_id, p.project_name,
         a.assigned_to_contact_id, a.assigned_to_persona_id, a.contract_id,
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
  -- The CONTACT, and only ever the contact: "is this mine" is a question
  -- about people, and every caller that compares this to their own contact
  -- id must keep getting the same answer it always got.
  'assignee_id', t.assigned_to_contact_id,
  -- WHO HOLDS IT, whichever kind of holder that is. A persona-held task is
  -- held; saying "unassigned" about it is a lie the screens told for months.
  'assignee', coalesce(c.person_name, c.name, pe.name),
  'assignee_kind', case
                     when t.assigned_to_contact_id is not null then 'person'
                     when t.assigned_to_persona_id is not null then 'assistant'
                     else null end,
  'parent_id', t.parent_action_id,
  'parent_title', (select pa.action from actions pa where pa.id = t.parent_action_id),
  'open_children', (select count(*) from actions ch where ch.parent_action_id = t.id
                    and ch.status not in ('Completed','Cancelled','Force Cancelled','Superseded')),
  'trade', t.trade,
  'phase', (select tr.stage from trades tr where tr.trade = t.trade),
  'phase_order', (select ts.sort_order from trades tr
                    join trade_stages ts on ts.stage = tr.stage
                   where tr.trade = t.trade)
)), '[]'::jsonb)
from t
left join contacts c on c.id = t.assigned_to_contact_id
left join personas pe on pe.id = t.assigned_to_persona_id;
$function$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
