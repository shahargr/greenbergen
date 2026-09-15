-- 139. A BUILD IS A SEQUENCE OF TRADES.
--
-- Shahar (2026-09-15), landing on a project and getting a list:
-- "Instead of that, what I would like to happen is I would like to start by
-- seeing all the trades, the panels for all the different trades and what is
-- currently being worked on. So if there are no tasks open for a specific
-- trade, from my perspective, just don't show it. I want you to know how the
-- trades are sequenced on a project... at the beginning you have demolition
-- and excavation, and then you're bringing in the mason guy, and then you're
-- bringing in the plumber. And after that, the frame. And after that, again
-- the plumber and the electrician and the HVAC guy."
--
-- The sequence is already in the database - trade_stages, ten stages from
-- Buy and Sell through Site preparation, Rough and mechanical, Stairs,
-- Finishing, Outdoor - and nothing has ever read it as a spine. A job is not
-- two hundred tasks; it is eleven trades in order, each of them in one of
-- four states, and the tasks are what is inside one of them.
--
-- And the second half of what he asked for:
-- "what's also important is that you put them in and say that right now what
-- you need to do, you need to start an engagement... You put on a project
-- manager, a task, run a bid for a framer, a task, run a bid for a plumber."
--
-- So a trade the job HAS but nobody has started is not silence, it is the
-- next thing to do. It appears in its place in the sequence, idle, with one
-- move available: run the bid. That move writes a task on the person who runs
-- the job, and from there the trade's own package takes over.

-- ---------------------------------------------------------------------------
-- WHERE THE WORK IS FILED VERSUS WHO IS HOLDING IT.
--
-- Shahar, pausing the design: "The four steps that are in a trade, including
-- bid, or vendor selection - if it's sitting on the PM, then it should not sit
-- under the project as a trade. Under the project as a trade should be only
-- the delivery part... unless you want on the PM just the trigger to start the
-- flow in the trade itself, which is okay, and then it becomes part of the
-- trade itself. But then on the PM side you don't have all the steps. The PM
-- just runs the bid as an action."
--
-- That is the shape this function returns. Scoping and choosing a contractor
-- are FILED under the trade, because that is what they are about and that is
-- where you go looking for them - and they are HELD by whoever runs the job,
-- which is a different column and always was. The PM's own line is a single
-- action, "Run the bid for Framing", not a copy of the package. Nobody sees
-- the bidding but our side (migration 138), so filing it under the trade costs
-- the trade nothing.
create or replace function public.portal_project_trades(p_project uuid)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
-- The family, and how much of it this caller may read. The bound is asked
-- once per project rather than once per task: a house with a dozen jobs under
-- it is a dozen questions, not two hundred and fifty.
with vis as (
  select f.id as project_id,
         public.is_contract_bounded_member(f.id) as bounded
    from public.project_ancestry_down(p_project) f
   where public.is_project_member(f.id) or public.is_superadmin()
),
seen as (
  select a.id, a.action, a.status, a.target_date, a.project_id, a.contract_id,
         a.assigned_to_contact_id, a.scope_item_id, a.trade as own_trade,
         a.action_type, a.parent_action_id,
         (a.status not in ('Completed','Cancelled','Force Cancelled','Superseded')) as is_open
    from public.actions a
    join vis v on v.project_id = a.project_id
    join public.projects p on p.id = a.project_id and p.trashed_at is null
   where (not v.bounded
          or (not coalesce(a.hidden_from_trades, false)
              and ((a.contract_id in (select contract_id from public.my_contract_ids(a.project_id)))
                   or (a.assigned_to_contact_id is not null
                       and a.assigned_to_contact_id in
                           (select contact_id from public.my_team_contact_ids(a.project_id))))))
),
-- The same derivation portal_tasks uses, and for the same reason: five tasks
-- on this job carry a trade of their own, and the rest are placed by the
-- contract they are under, the scope line they came from, or the trade of the
-- person holding them. A spine built on the written-down trade alone would
-- show three panels on a job running eleven trades.
t as (
  select s.*,
    ct.status as contract_status,
    coalesce(
      (select t5.trade from public.trades t5 where t5.trade = s.own_trade limit 1),
      (select t3.trade from public.trades t3 where lower(t3.trade) = lower(ct.trade) limit 1),
      initcap(ct.trade),
      (select t4.trade from public.project_scope_items si
         join public.trades t4 on lower(t4.trade) = lower(si.trade)
        where si.id = s.scope_item_id and si.trade is not null and lower(si.trade) <> 'all'
        limit 1),
      (select tr.trade from public.contact_trade_roles tr
         join public.trades t2 on t2.trade = tr.trade
        where tr.contact_id = s.assigned_to_contact_id
          and (coalesce(t2.is_construction, false) or coalesce(t2.is_worker_trade, false))
        order by t2.sort_order nulls last limit 1)) as trade
  from seen s left join public.contracts ct on ct.id = s.contract_id
),
live as (
  select t.trade,
         count(*) filter (where t.is_open) as n_open,
         count(*) filter (where t.is_open and t.target_date < current_date) as n_late,
         min(t.target_date) filter (where t.is_open) as next_due,
         count(*) filter (where not t.is_open) as n_done,
         bool_or(t.action_type = 'build') as engaged,
         bool_or(t.contract_status in ('signed','awarded','active','Active')) as awarded
    from t where t.trade is not null
   group by t.trade
  having count(*) filter (where t.is_open) > 0
),
-- WHAT THIS JOB HAS BUT HAS NOT STARTED. Three places say a job needs a
-- trade: somebody ticked it as a trade to bid, a contract already names it,
-- or a scope line is filed under it. Only somebody who runs the job is shown
-- this - it is the plan, and the plan is not a trade's business.
idle as (
  select distinct tr.trade
    from public.trades tr
   where not public.is_contract_bounded_member(p_project)
     and tr.trade not in (select l.trade from live l)
     and (exists (select 1 from public.project_bid_needs n
                    join public.project_ancestry_down(p_project) f on f.id = n.project_id
                   where n.trade = tr.trade)
       or exists (select 1 from public.contracts c
                    join public.project_ancestry_down(p_project) f on f.id = c.project_id
                   where lower(c.trade) = lower(tr.trade))
       or exists (select 1 from public.project_scope_items si
                    join public.project_ancestry_down(p_project) f on f.id = si.project_id
                   where lower(si.trade) = lower(tr.trade) and lower(si.trade) <> 'all'))
),
rows_ as (
  select l.trade, l.n_open, l.n_late, l.next_due, l.n_done,
         coalesce(l.engaged, false) as engaged, coalesce(l.awarded, false) as awarded
    from live l
  union all
  select i.trade, 0::bigint, 0::bigint, null::date, 0::bigint, false, false from idle i
)
select jsonb_build_object(
  'trades', coalesce((
    select jsonb_agg(jsonb_build_object(
      'trade', r.trade,
      'stage', tr.stage,
      'art', tr.illustration,
      'open', r.n_open, 'late', r.n_late, 'done', r.n_done,
      'next_due', r.next_due,
      -- FOUR STATES, AND THEY ARE THE ONLY FOUR A TRADE IS EVER IN.
      --   idle     the job needs it; nobody has started
      --   hiring   a package is open and no one is appointed yet
      --   working  appointed, under an agreement, work open
      --   loose    work open with neither a package nor an agreement behind it
      'state', case when r.n_open = 0 then 'idle'
                    when r.awarded then 'working'
                    when r.engaged then 'hiring'
                    else 'loose' end,
      -- Who it is, once there is somebody: the party on the agreement, which
      -- is the only answer that does not change when a task is reassigned.
      'who', (select coalesce(c2.person_name, c2.name, co.company_name)
                from public.contracts ct2
                left join public.contacts c2 on c2.id = ct2.counterparty_contact_id
                left join public.companies co on co.id = ct2.counterparty_company_id
               where lower(ct2.trade) = lower(r.trade)
                 and ct2.project_id in (select f.id from public.project_ancestry_down(p_project) f)
               order by case when ct2.status in ('signed','awarded','active','Active') then 0 else 1 end,
                        ct2.created_at
               limit 1),
      -- The three soonest things open in it, so a panel says what is actually
      -- happening rather than only how much of it there is.
      'now', coalesce((
        select jsonb_agg(jsonb_build_object('id', x.id, 'action', x.action,
                                            'target_date', x.target_date)
                         order by x.target_date nulls last, x.action)
          from (select t2.id, t2.action, t2.target_date
                  from t t2 where t2.trade = r.trade and t2.is_open
                 order by t2.target_date nulls last, t2.action limit 3) x), '[]'::jsonb))
      order by coalesce(ts.sort_order, 999), coalesce(tr.sort_order, 999), r.trade)
    from rows_ r
    join public.trades tr on tr.trade = r.trade
    left join public.trade_stages ts on ts.stage = tr.stage), '[]'::jsonb),
  -- EVERYTHING THE SPINE CANNOT PLACE. Not hidden, not silently folded into
  -- a trade that does not own it - counted, named, and one tap from the list.
  'untagged', jsonb_build_object(
    'open', (select count(*) from t where t.trade is null and t.is_open),
    'late', (select count(*) from t where t.trade is null and t.is_open
                                      and t.target_date < current_date))
);
$function$;

comment on function public.portal_project_trades(uuid) is
'One project as its trades, in build order (trade_stages), across the whole family beneath it. Each carries what is open, what is late, what is next, who is appointed and one of four states - idle, hiring, working, loose. A trade with nothing open appears only for somebody who runs the job, and only when the job actually needs it (a bid need, a contract or a scope line): that is the "start an engagement" row. Reads through the same bound as portal_tasks, so a trade sees their own trade and nothing else.';

-- ---------------------------------------------------------------------------
-- THE ONE MOVE AN IDLE TRADE OFFERS.
--
-- "You put on a project manager, a task, run a bid for a framer, a task, run
-- a bid for a plumber, etc." One action, held by whoever runs the job, filed
-- under the trade it is about - and hidden from the trades, because a bid is
-- ours until it is awarded (migration 138).
--
-- It does not create the four-step package. That happens when the bid is
-- actually started, from the task itself, and the package is what carries the
-- steps. The PM's line is a trigger, not a copy of the flow.
create or replace function public.portal_trade_start_bid(p_project uuid, p_trade text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_trade text; v_id uuid; r jsonb; v_existing uuid;
begin
  if not public.can_edit_project(p_project) then
    return jsonb_build_object('ok', false, 'code', 'NOT_ALLOWED',
      'reason', 'Only somebody who runs this job can start a trade off.');
  end if;

  select tr.trade into v_trade from public.trades tr
   where lower(tr.trade) = lower(trim(coalesce(p_trade, ''))) limit 1;
  if v_trade is null then
    return jsonb_build_object('ok', false, 'code', 'NO_TRADE',
      'reason', format('"%s" is not a trade we know.', p_trade));
  end if;

  -- Asking twice is the same ask. A second "Run the bid for Framing" on a job
  -- that already has one open is a duplicate, not a second bid round.
  select a.id into v_existing
    from public.actions a
   where a.project_id = p_project
     and a.trade = v_trade
     and a.action = format('Run the bid for %s', v_trade)
     and a.status not in ('Completed','Cancelled','Force Cancelled','Superseded')
   limit 1;
  if v_existing is not null then
    return jsonb_build_object('ok', true, 'id', v_existing, 'trade', v_trade, 'existed', true);
  end if;

  r := public.portal_task_create(
    p_project => p_project,
    p_action  => format('Run the bid for %s', v_trade),
    p_delivers => 'work',
    p_trade   => v_trade,
    p_priority => 'Normal',
    p_description =>
      format('Put %s out to the trades, compare what comes back, and appoint somebody. '
          || 'Opening the trade package from here writes the scope, the selection, the '
          || 'legal and insurance and the punch list beneath it.', lower(v_trade)));
  if not coalesce((r->>'ok')::boolean, false) then return r; end if;

  v_id := (r->>'id')::uuid;
  update public.actions set hidden_from_trades = true where id = v_id;

  return r || jsonb_build_object('trade', v_trade, 'existed', false);
end $function$;

comment on function public.portal_trade_start_bid(uuid, text) is
'Writes the one line that starts a trade off - "Run the bid for Framing" - on the job, filed under the trade and hidden from the trades. Idempotent: a job that already has that line open gets its id back rather than a second one. It deliberately does NOT expand the four-step package; that belongs to the trade and is created when the bid actually begins.';

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
