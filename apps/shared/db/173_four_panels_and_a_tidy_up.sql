-- 173: FOUR PANELS IF POSSIBLE, AND A TIDY-UP THAT TAKES ONE TASK AT A TIME.
--
-- Shahar (2026-09-17), on the project screen with eight panels: "having a
-- panel for all open bids is needed, where there are any. since i am still
-- in rough, i don't need to see panels that are completed running (such as
-- finance), or not yet in scope (finish)... my goal is to keep four panels
-- if possible visible, and more as needed." Then: "suppliers should be
-- visible under more panels, and the visibility based on stage is a good
-- idea. the not filed under a trade is a good catch it all. i think having a
-- data improvement process can help a ton... add an AI button that will
-- start a process that takes tasks without trade or assignee, one by one to
-- fix and sort. so it shows one task at a time."
--
-- Three pieces, all data and functions; the rule that picks the panels runs
-- on the screen from what portal_project_trades already returns.
--
--   * project_panel_prefs - which panels a person pulled up or folded away on
--     a project, remembered per seat so a phone and a desk agree.
--   * trade_keywords + portal_tidy_queue - the tasks with no trade or no
--     holder, one list, each with a guess: the trade whose words are in the
--     task, or the trade of the person the task names. A keyword table, not
--     a model - it grows by insert as the guesses miss (rulebook 15).
--   * contact_on_job + portal_task_edit - a task can be handed to anyone on
--     the job's family, including a contract party with no seat, which 171
--     started offering and the edit still refused.

-- ---------------------------------------------------------------------------
-- WHICH PANELS, PER PERSON PER PROJECT.
create table if not exists public.project_panel_prefs (
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  project_id  uuid not null references public.projects(id) on delete cascade,
  shown       text[] not null default '{}',
  hidden      text[] not null default '{}',
  updated_at  timestamptz not null default now(),
  primary key (app_user_id, project_id)
);
alter table public.project_panel_prefs enable row level security;
comment on table public.project_panel_prefs is
  'Panels a person pulled up (shown) or folded away (hidden) on a project screen, over the rule that picks them (migration 173).';

create or replace function public.portal_panel_prefs(p_project uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('shown', to_jsonb(p.shown), 'hidden', to_jsonb(p.hidden))
                     from public.project_panel_prefs p
                    where p.app_user_id = public.current_app_user_id() and p.project_id = p_project),
                  jsonb_build_object('shown', '[]'::jsonb, 'hidden', '[]'::jsonb));
$$;
revoke all on function public.portal_panel_prefs(uuid) from public, anon;
grant execute on function public.portal_panel_prefs(uuid) to authenticated;

create or replace function public.portal_panel_prefs_set(p_project uuid, p_shown text[], p_hidden text[])
returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.current_app_user_id();
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.'); end if;
  if not (public.is_project_member(p_project) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'reason', 'Not your project.');
  end if;
  insert into public.project_panel_prefs (app_user_id, project_id, shown, hidden, updated_at)
  values (me, p_project, coalesce(p_shown, '{}'), coalesce(p_hidden, '{}'), now())
  on conflict (app_user_id, project_id) do update
    set shown = excluded.shown, hidden = excluded.hidden, updated_at = now();
  return jsonb_build_object('ok', true, 'shown', to_jsonb(coalesce(p_shown, '{}')), 'hidden', to_jsonb(coalesce(p_hidden, '{}')));
end $$;
revoke all on function public.portal_panel_prefs_set(uuid, text[], text[]) from public, anon;
grant execute on function public.portal_panel_prefs_set(uuid, text[], text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- WHO IS ON THE JOB, for handing a task over: a seat on the project, above
-- it or beneath it, or a party to a live contract on any of them.
create or replace function public.contact_on_job(p_project uuid, p_contact uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  with fam as (
    select project_id as id from public.project_ancestry(p_project)
    union select p_project
    union select id from public.project_ancestry_down(p_project)
  )
  select exists (
    select 1 from public.project_members pm
     where pm.project_id in (select id from fam) and pm.status = 'active'
       and coalesce(pm.contact_id, (select u.contact_id from public.app_users u where u.id = pm.app_user_id)) = p_contact)
  or exists (
    select 1 from public.contracts ct
     where ct.project_id in (select id from fam)
       and lower(coalesce(ct.status, '')) not in ('cancelled', 'void', 'placeholder')
       and p_contact in (ct.contractor_id, ct.counterparty_contact_id));
$$;

do $patch$
declare src text; out_ text;
begin
  src := pg_get_functiondef('public.portal_task_edit(uuid, jsonb)'::regprocedure);
  out_ := replace(src,
    E'if v_assignee is not null and not exists (\n        select 1 from public.project_members pm\n         where pm.project_id in (select project_id from public.project_ancestry(a.project_id))\n           and pm.status = ''active''\n           and coalesce(pm.contact_id, (select u.contact_id from public.app_users u where u.id = pm.app_user_id)) = v_assignee) then',
    E'if v_assignee is not null and not public.contact_on_job(a.project_id, v_assignee) then');
  if out_ = src then raise exception 'portal_task_edit has drifted - assignee check not found'; end if;
  execute out_;
end $patch$;

-- ---------------------------------------------------------------------------
-- THE WORDS THAT GIVE A TRADE AWAY. Longest match wins, so "portable toilet"
-- beats "toilet" and "garage door" beats "door". Grows by insert.
create table if not exists public.trade_keywords (
  keyword text primary key,
  trade   text not null references public.trades(trade) on update cascade,
  created_at timestamptz not null default now()
);
alter table public.trade_keywords enable row level security;
comment on table public.trade_keywords is
  'A word or phrase in a task''s text that gives its trade away (migration 173). Longest match wins. Add rows as the guesses miss.';

insert into public.trade_keywords (keyword, trade) values
  ('plumb', 'Plumbing'), ('plumber', 'Plumbing'), ('plumbing', 'Plumbing'), ('water line', 'Plumbing'),
  ('water main', 'Plumbing'), ('sewer', 'Plumbing'), ('sump', 'Plumbing'), ('radon', 'Plumbing'),
  ('pipe', 'Plumbing'), ('water heater', 'Plumbing'), ('drain', 'Plumbing'), ('toilet', 'Plumbing'),
  ('fixture', 'Plumbing'), ('fixtures', 'Plumbing'), ('recirculation', 'Plumbing'), ('gas line', 'Plumbing'),
  ('frame', 'Framing'), ('framer', 'Framing'), ('framing', 'Framing'), ('lvl', 'Framing'), ('stud', 'Framing'),
  ('studs', 'Framing'), ('joist', 'Framing'), ('header', 'Framing'), ('subfloor', 'Framing'), ('blocking', 'Framing'),
  ('metal plates', 'Framing'), ('niche', 'Framing'), ('wall', 'Framing'), ('walls', 'Framing'),
  ('electric', 'Electrical'), ('electrical', 'Electrical'), ('electrician', 'Electrical'), ('outlet', 'Electrical'),
  ('outlets', 'Electrical'), ('wire', 'Electrical'), ('wiring', 'Electrical'), ('dimmer', 'Electrical'),
  ('dimmers', 'Electrical'), ('generator', 'Electrical'), ('ev charger', 'Electrical'), ('lighting', 'Electrical'),
  ('conduit', 'Electrical'), ('power line', 'Utilities & Municipalities'), ('temp power', 'Utilities & Municipalities'),
  ('temporary power', 'Utilities & Municipalities'), ('water company', 'Utilities & Municipalities'),
  ('meter', 'Utilities & Municipalities'), ('pseg', 'Utilities & Municipalities'),
  ('mason', 'Masonry'), ('masonry', 'Masonry'), ('slab', 'Masonry'), ('slabs', 'Masonry'), ('concrete', 'Masonry'),
  ('footing', 'Masonry'), ('footings', 'Masonry'), ('pour', 'Masonry'), ('foundation', 'Masonry'), ('gravel', 'Masonry'),
  ('roof', 'Roofing'), ('roofing', 'Roofing'), ('shingle', 'Roofing'), ('shingles', 'Roofing'),
  ('window', 'Supply: Windows'), ('windows', 'Supply: Windows'), ('skylight', 'Supply: Windows'), ('bankeys', 'Supply: Windows'),
  ('stair', 'Stairs'), ('stairs', 'Stairs'), ('tread', 'Stairs'), ('treads', 'Stairs'), ('railing', 'Railings'),
  ('railings', 'Railings'),
  ('lumber', 'Supply: Lumber'), ('kuiken', 'Supply: Lumber'),
  ('landscap', 'Landscaping'), ('landscaping', 'Landscaping'), ('driveway', 'Landscaping'), ('boulder wall', 'Landscaping'),
  ('irrigation', 'Irrigation'), ('hardscape', 'Hardscaping'), ('patio', 'Hardscaping'),
  ('insurance', 'Insurance'), ('insured', 'Insurance'), ('coi', 'Insurance'), ('policy', 'Insurance'),
  ('loan', 'Finance'), ('lender', 'Finance'), ('mortgage', 'Finance'), ('clearedge', 'Finance'), ('draw', 'Finance'),
  ('survey', 'Surveyor'), ('surveyor', 'Surveyor'),
  ('site plan', 'Site Engineering'), ('engineer', 'Site Engineering'), ('engineering', 'Site Engineering'),
  ('permit', 'Town Official'), ('permits', 'Town Official'), ('inspector', 'Town Official'), ('borough', 'Town Official'),
  ('tenafly', 'Town Official'), ('town', 'Town Official'),
  ('kitchen', 'Cabinetry'), ('cabinet', 'Cabinetry'), ('cabinets', 'Cabinetry'),
  ('tile', 'Tile'), ('tiles', 'Tile'), ('paint', 'Painting'), ('painting', 'Painting'),
  ('hvac', 'HVAC'), ('duct', 'HVAC'), ('ducts', 'HVAC'), ('furnace', 'HVAC'), ('heat load', 'HVAC'), ('mini split', 'HVAC'),
  ('gutter', 'Gutters'), ('gutters', 'Gutters'), ('siding', 'Siding'), ('insulation', 'Insulation'), ('spray foam', 'Insulation'),
  ('excavat', 'Demo & Excavation'), ('excavation', 'Demo & Excavation'), ('demo', 'Demo & Excavation'),
  ('backfill', 'Demo & Excavation'), ('grading', 'Demo & Excavation'),
  ('tree', 'Tree Removal'), ('trees', 'Tree Removal'),
  ('architect', 'Architecture'), ('plans', 'Architecture'), ('drawings', 'Architecture'), ('revision', 'Architecture'),
  ('interior design', 'Interior Design'), ('designer', 'Interior Design'), ('finish schedule', 'Interior Design'),
  ('appliance', 'Supply: Appliances'), ('appliances', 'Supply: Appliances'),
  ('door', 'Supply: Internal Doors & Trim'), ('doors', 'Supply: Internal Doors & Trim'), ('pocket door', 'Supply: Internal Doors & Trim'),
  ('door schedule', 'Supply: Internal Doors & Trim'), ('garage door', 'Garage Doors'), ('glass door', 'Glass Doors'),
  ('waterproof', 'Waterproofing'), ('waterproofing', 'Waterproofing'), ('membrane', 'Waterproofing'),
  ('drywall', 'Drywall'), ('sheetrock', 'Drywall'), ('floor', 'Flooring Installer'), ('flooring', 'Flooring Installer'),
  ('hardwood', 'Flooring Installer'),
  ('asbestos', 'Asbestos'), ('pest', 'Pest Control'), ('termite', 'Pest Control'),
  ('dumpster', 'Waste Removal'), ('waste', 'Waste Removal'), ('portable toilet', 'Portable toilet'),
  ('fence', 'Fencing'), ('fencing', 'Fencing'), ('deck', 'Decks'), ('pool', 'Pools & Spas'), ('fireplace', 'Fireplace'),
  ('smart home', 'Smart Home'), ('alarm', 'Alarms & Security'), ('trim', 'Trim'), ('baseboard', 'Trim'), ('moulding', 'Trim'),
  ('countertop', 'Countertops'), ('countertops', 'Countertops'), ('quartz', 'Countertops'), ('granite', 'Countertops'),
  ('stucco', 'Stucco'), ('cleaning', 'Cleaning'), ('powerwash', 'Powerwashing'), ('blinds', 'Blinds & Shades'),
  ('shades', 'Blinds & Shades'), ('outdoor kitchen', 'Outdoor Kitchens'), ('closet', 'Carpentry')
on conflict (keyword) do nothing;

-- ---------------------------------------------------------------------------
-- THE TIDY-UP QUEUE: open tasks on the job's family with no trade or no
-- holder, late first, each with a guess and the reason for it.
create or replace function public.portal_tidy_queue(p_project uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  with fam as (select f.id from public.project_ancestry_down(p_project) f),
  people as (
    -- Somebody a task might NAME: a party to a live contract, with the
    -- contract's trade. First names only, three letters or more.
    select distinct split_part(coalesce(co.person_name, co.name), ' ', 1) as first_name,
           coalesce(co.person_name, co.name) as name, ct.trade
      from public.contracts ct
      join public.contacts co on co.id = coalesce(ct.contractor_id, ct.counterparty_contact_id)
     where ct.project_id in (select id from fam)
       and ct.trade is not null
       and lower(coalesce(ct.status, '')) not in ('cancelled', 'void', 'placeholder')
       and length(split_part(coalesce(co.person_name, co.name), ' ', 1)) >= 3
  ),
  q as (
    select a.id, a.action, a.notes, a.status_note, a.status, a.priority, a.target_date, a.created_at, a.created_by,
           a.trade, a.project_id, p.project_name as project,
           a.assigned_to_contact_id as assignee_id,
           coalesce((select coalesce(c2.person_name, c2.name) from public.contacts c2 where c2.id = a.assigned_to_contact_id),
                    (select ps.name from public.personas ps where ps.id = a.assigned_to_persona_id)) as assignee,
           (select pa.action from public.actions pa where pa.id = a.parent_action_id) as parent_title,
           (a.target_date is not null and a.target_date < current_date) as late,
           lower(a.action || ' ' || coalesce(a.notes, '')) as txt
      from public.actions a
      join public.projects p on p.id = a.project_id
     where a.project_id in (select id from fam)
       and a.status not in ('Completed', 'Cancelled', 'Force Cancelled', 'Superseded')
       and (a.trade is null or (a.assigned_to_contact_id is null and a.assigned_to_persona_id is null))
       and public.can_see_action(a.id)
  ),
  guessed as (
    select q.*,
           coalesce(
             (select k.trade from public.trade_keywords k
               where q.txt ~ ('\m' || k.keyword || '\M')
               order by length(k.keyword) desc limit 1),
             (select pe.trade from people pe
               where q.txt ~* ('\m' || pe.first_name || '\M')
               order by length(pe.first_name) desc limit 1)) as guess,
           coalesce(
             (select '"' || k.keyword || '"' from public.trade_keywords k
               where q.txt ~ ('\m' || k.keyword || '\M')
               order by length(k.keyword) desc limit 1),
             (select 'names ' || pe.name from people pe
               where q.txt ~* ('\m' || pe.first_name || '\M')
               order by length(pe.first_name) desc limit 1)) as why
      from q
  )
  select case when not (public.is_project_member(p_project) or public.is_superadmin()) then null
  else jsonb_build_object(
    'n', (select count(*) from q),
    'no_trade', (select count(*) from q where q.trade is null),
    'no_holder', (select count(*) from q where q.assignee_id is null and q.assignee is null),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object(
        'id', g.id, 'action', g.action, 'notes', g.notes, 'status_note', g.status_note, 'status', g.status,
        'priority', g.priority, 'target_date', g.target_date, 'created_at', g.created_at, 'created_by', g.created_by,
        'trade', g.trade, 'project_id', g.project_id, 'project', g.project,
        'assignee_id', g.assignee_id, 'assignee', g.assignee, 'parent_title', g.parent_title, 'late', g.late,
        'guess', case when g.trade is null then g.guess end,
        'why', case when g.trade is null then g.why end)
      order by g.late desc, g.target_date nulls last, g.created_at desc)
      from (select * from guessed limit 300) g), '[]'::jsonb)) end;
$$;
revoke all on function public.portal_tidy_queue(uuid) from public, anon;
grant execute on function public.portal_tidy_queue(uuid) to authenticated;

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);

-- ---------------------------------------------------------------------------
-- 173b, applied as its own step: THE TITLE FIRST. The first cut matched the
-- longest keyword anywhere in title + notes, and notes name every trade a
-- task touches ("Framing - Labor" guessed Waterproofing off its notes). The
-- title names the one the task is about; the notes are read only when the
-- title has no word for it. Live definition of portal_tidy_queue: see the
-- migration named 173b_guess_from_the_title_first in the applied list.
