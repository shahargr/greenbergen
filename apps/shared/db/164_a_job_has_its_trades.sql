-- 164. A JOB HAS ITS TRADES, AND A TRADE NAMED ON THE JOB JOINS THEM.
--
-- Shahar (2026-09-17): "To minimize complexity... Under project, you can
-- club all the trades you need. Once task is created under project, the
-- trades you can assign the task are only the ones listed under the project.
-- if you want to add a trade, then it should be added also to the project
-- level. this way, we have a list of relevant trades per project instead of
-- looking at all trades."
--
-- The list existed: project_bid_needs, kind 'trade', one row per trade the
-- job uses, ticked on the scope screen. Two things were missing.
--
--   1. Nothing kept it true. A task or a contract could name any of the 74
--      trades and the job's list never heard of it: on 55 Walnut, thirteen
--      trades carry tasks and three were on the list. So the rule is now the
--      database's: a trade named on a task or a contract JOINS the job's
--      list the moment it is written (triggers), and the list is backfilled
--      from what is already there. Adopt, never refuse - refusing would have
--      broken the pest control, the asbestos and the lumber already filed.
--
--   2. Nothing read it for the pickers. project_trade_list(job) is the read:
--      the job's trades in build order, with their stage, for every screen
--      that asks "which trade". The new-task screen shows them first and
--      keeps the rest of the catalogue under "add another trade", which the
--      trigger then adds.
--
-- A trade that is not in the trades table (a free-text contract trade like
-- "windows") is not adopted: the list is of trades, and the fix for a
-- misspelt one is on the contract.

-- ---------------------------------------------------------------------------
-- 1. The read.
-- ---------------------------------------------------------------------------
create or replace function public.project_trade_list(p_project uuid)
returns table (trade text, stage text, sort_order integer, open_tasks bigint, has_contract boolean)
language sql stable security definer
set search_path to 'public'
as $$
  select t.trade, t.stage, t.sort_order,
         (select count(*) from public.actions a
           where a.project_id = p_project and a.trade = t.trade
             and a.status not in ('Completed','Cancelled','Force Cancelled','Superseded')) as open_tasks,
         exists (select 1 from public.contracts c
                  where c.project_id = p_project and c.trade = t.trade
                    and lower(c.status) not in ('cancelled','placeholder')) as has_contract
    from public.project_bid_needs n
    join public.trades t on t.trade = n.trade
   where n.project_id = p_project and n.kind = 'trade' and n.trade is not null
     and (public.is_superadmin() or public.is_project_member(p_project))
   order by t.sort_order nulls last, t.trade;
$$;
revoke all on function public.project_trade_list(uuid) from public, anon;
grant execute on function public.project_trade_list(uuid) to authenticated;
comment on function public.project_trade_list(uuid) is
  'The trades on a job (project_bid_needs, kind trade), in build order, with the stage each sits at, how many tasks are open under it and whether a contract carries it. What every "which trade" picker on the job offers first.';

-- ---------------------------------------------------------------------------
-- 2. The rule: a trade named on the job joins the job.
-- ---------------------------------------------------------------------------
create or replace function public.project_trade_join(p_project uuid, p_trade text, p_by text)
returns boolean
language plpgsql security definer
set search_path to 'public'
as $$
declare v_sort integer;
begin
  if p_project is null or nullif(btrim(coalesce(p_trade, '')), '') is null then return false; end if;
  select t.sort_order into v_sort from public.trades t where t.trade = p_trade;
  if not found then return false; end if;                       -- not a trade we know
  if exists (select 1 from public.project_bid_needs n
              where n.project_id = p_project and n.trade = p_trade) then return false; end if;
  if exists (select 1 from public.projects p where p.id = p_project and p.is_template) then return false; end if;
  insert into public.project_bid_needs (project_id, trade, label, note, kind, sort_order, source, created_by)
  values (p_project, p_trade, p_trade, 'Joined the job when ' || p_by || ' named it (migration 164).',
          'trade', coalesce(v_sort, 100), 'manual', 'system:trade joins job')
  on conflict (project_id, label) do nothing;
  return found;
end $$;

create or replace function public.fn_actions_trade_joins_project()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
begin
  perform public.project_trade_join(new.project_id, new.trade, 'a task');
  return new;
end $$;

drop trigger if exists trg_actions_trade_joins_project on public.actions;
create trigger trg_actions_trade_joins_project
  after insert or update of trade, project_id on public.actions
  for each row when (new.trade is not null and new.project_id is not null)
  execute function public.fn_actions_trade_joins_project();

create or replace function public.fn_contracts_trade_joins_project()
returns trigger
language plpgsql security definer
set search_path to 'public'
as $$
begin
  if lower(coalesce(new.status, '')) in ('cancelled', 'placeholder') then return new; end if;
  perform public.project_trade_join(new.project_id, new.trade, 'a contract');
  return new;
end $$;

drop trigger if exists trg_contracts_trade_joins_project on public.contracts;
create trigger trg_contracts_trade_joins_project
  after insert or update of trade, project_id, status on public.contracts
  for each row when (new.trade is not null and new.project_id is not null)
  execute function public.fn_contracts_trade_joins_project();

-- ---------------------------------------------------------------------------
-- 3. Backfill: every trade already named on a job joins it.
-- ---------------------------------------------------------------------------
do $fill$
declare r record; n int := 0;
begin
  for r in
    select distinct a.project_id, a.trade, 'a task' as named_by
      from public.actions a
      join public.projects p on p.id = a.project_id
     where a.trade is not null and p.trashed_at is null and not p.is_template
    union
    select distinct c.project_id, c.trade, 'a contract' as named_by
      from public.contracts c
      join public.projects p on p.id = c.project_id
     where c.trade is not null and p.trashed_at is null and not p.is_template
       and lower(c.status) not in ('cancelled', 'placeholder')
  loop
    if public.project_trade_join(r.project_id, r.trade, r.named_by) then n := n + 1; end if;
  end loop;
  raise notice 'migration 164: % trades joined their jobs', n;
end $fill$;

update public.config
   set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);

-- ---------------------------------------------------------------------------
-- 164b. Three contracts named their trade in free text - "demolition /
-- excavation / landscaping", "excavation", "windows" - which is not a trade
-- the list can hold. Corrected to the catalogue's words (Demo & Excavation;
-- Supply: Windows), and the trigger joined them. Run directly, recorded here.
-- ---------------------------------------------------------------------------
-- update public.contracts set trade = case trade when 'windows' then 'Supply: Windows' else 'Demo & Excavation' end
--  where trade in ('demolition / excavation / landscaping', 'excavation', 'windows');
