-- WHAT I HAVE TO DO, IN ONE READ.
--
-- Shahar, 2026-09-21, looking at the Professionals landing: "this page should
-- help me quickly understand my things to do. should have a schedule view,
-- finance view, bidding view."
--
--   schedule - all my tasks across all projects
--   bidding  - the bids I am running
--   finance  - expected payment this month, total paid thus far
--
-- The page today is a list of properties and eight links to other screens.
-- Every one of those screens knows something; the landing knows nothing, so
-- "what needs me today" costs four taps and a memory of which screen holds
-- which fact.
--
-- ONE FUNCTION, THREE BLOCKS, because a landing that fires three round trips
-- is a landing that renders three times - and these three share the same
-- expensive part anyway: which projects are mine.
--
-- NOT portal_my_bid_projects, which already exists and answers a DIFFERENT
-- question: the jobs somebody has invited ME to bid on, as a trade. This is
-- the other side of the table - the rooms I am RUNNING, where I am the one
-- waiting for prices to come back.
--
-- THE MONEY BLOCK IS GATED PER PROJECT. can_view_project_financials is the
-- money ladder the rest of the app uses; a trade who runs one job and holds
-- a seat on another sees the money of the first and not the second. The
-- totals are sums over whatever survives that filter, so they are true for
-- the person asking rather than true in general.
create or replace function public.portal_pro_overview()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $fn$
with me as (select public.current_app_user_id() as uid),
mine as (
  select distinct pm.project_id
    from project_members pm, me
   where pm.app_user_id = me.uid and pm.status = 'active'),
proj as (
  select p.id, p.project_name, p.parent_project_id,
         coalesce(par.project_name, p.project_name) as house
    from projects p
    join mine m on m.project_id = p.id
    left join projects par on par.id = p.parent_project_id
   where p.trashed_at is null and not coalesce(p.is_template, false)),
-- SCHEDULE. Open work with a date on it, across everything.
task as (
  select a.id, a.action, a.target_date, a.status, a.priority,
         coalesce(a.is_gate, false) as is_gate, a.trade,
         pr.id as project_id, pr.project_name, pr.house,
         (a.target_date - current_date) as days
    from actions a join proj pr on pr.id = a.project_id
   where a.status not in ('Completed', 'Cancelled', 'Force Cancelled')),
-- BIDDING. The rooms I run, and whether they are waiting on me or on them.
room as (
  select bp.id, bp.trade, bp.category, bp.status, bp.reply_by, bp.awarded_bid_id,
         pr.id as project_id, pr.project_name, pr.house,
         (select count(*) from bids b where b.package_id = bp.id) as invited,
         (select count(*) from bids b where b.package_id = bp.id
           and b.status in ('received','under negotiation','awarded','not awarded')) as replied,
         (select min(b.amount) from bids b where b.package_id = bp.id and b.amount is not null) as low
    from bid_packages bp join proj pr on pr.id = bp.project_id),
-- MONEY, per project, and only where the ladder allows it.
money_proj as (select pr.id from proj pr where public.can_view_project_financials(pr.id)),
stage as (
  select s.id, s.name, s.due_on, s.status,
         coalesce(s.amount, s.percent_of_contract / 100.0 * c.amount) as amount,
         pr.project_name, pr.house, c.title as contract_title
    from payment_stages s
    join money_proj mp on mp.id = s.project_id
    join proj pr on pr.id = s.project_id
    left join contracts c on c.id = s.contract_id
   where s.paid_at is null and coalesce(s.status, '') not ilike '%paid%')
select jsonb_build_object(
  'projects', (select count(*) from proj),

  'schedule', jsonb_build_object(
    'late',    (select count(*) from task where target_date < current_date),
    'today',   (select count(*) from task where target_date = current_date),
    'week',    (select count(*) from task where days between 1 and 7),
    'undated', (select count(*) from task where target_date is null),
    'open',    (select count(*) from task),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'action', t.action, 'project_id', t.project_id,
        'project_name', t.project_name, 'house', t.house, 'trade', t.trade,
        'target_date', t.target_date, 'days', t.days, 'is_gate', t.is_gate,
        'priority', t.priority, 'status', t.status)
        order by t.target_date, t.is_gate desc)
      from (select * from task where target_date is not null and days <= 14
             order by target_date limit 40) t), '[]'::jsonb)),

  'bidding', jsonb_build_object(
    'rooms',    (select count(*) from room where awarded_bid_id is null and coalesce(status,'') <> 'closed'),
    'awaiting', (select count(*) from room where awarded_bid_id is null and replied < invited),
    'to_decide',(select count(*) from room where awarded_bid_id is null and replied > 0),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', r.id, 'trade', coalesce(r.category, r.trade), 'project_id', r.project_id,
        'project_name', r.project_name, 'house', r.house, 'status', r.status,
        'reply_by', r.reply_by, 'invited', r.invited, 'replied', r.replied,
        'low', r.low, 'awarded', r.awarded_bid_id is not null)
        order by (r.awarded_bid_id is not null), r.reply_by nulls last)
      from room r), '[]'::jsonb)),

  'money', jsonb_build_object(
    -- Says plainly whether this is a partial view rather than pretending the
    -- number is the whole picture.
    'projects_visible', (select count(*) from money_proj),
    'projects_total',   (select count(*) from proj),
    'paid_to_date', coalesce((select sum(t.amount) from transactions t
                               join money_proj mp on mp.id = t.project_id
                              where coalesce(t.paid_on, t.created_at::date) <= current_date
                                and coalesce(t.direction, 'out') <> 'in'), 0),
    'due_this_month', coalesce((select sum(s.amount) from stage s
                                 where s.due_on >= date_trunc('month', current_date)::date
                                   and s.due_on <  (date_trunc('month', current_date) + interval '1 month')::date), 0),
    'overdue', coalesce((select sum(s.amount) from stage s where s.due_on < current_date), 0),
    'unscheduled', coalesce((select sum(s.amount) from stage s where s.due_on is null), 0),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'due_on', s.due_on, 'amount', s.amount,
        'project_name', s.project_name, 'house', s.house, 'contract', s.contract_title,
        'overdue', s.due_on is not null and s.due_on < current_date)
        order by s.due_on nulls last)
      from (select * from stage where due_on is null
               or due_on < (date_trunc('month', current_date) + interval '1 month')::date
             order by due_on nulls last limit 30) s), '[]'::jsonb)));
$fn$;

comment on function public.portal_pro_overview() is
  'The Professionals landing in one read: open work by when it is due, the bid rooms I am RUNNING (not the ones I was invited to - that is portal_my_bid_projects), and the money. The money block is filtered per project through can_view_project_financials and reports how many projects it could see, so a partial total says so.';

revoke all on function public.portal_pro_overview() from public, anon;
grant execute on function public.portal_pro_overview() to authenticated, service_role;
