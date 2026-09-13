-- 081  A PROJECT HAS A SPINE, AND THE SPINE HAS DATES
--
-- Shahar (2026-09-13): "help me design the most logical flow for the project.
-- there are many tasks, but, less stages. most tasks will fit right into a
-- stage. this will also help us create gaant."
--
-- And, settling the design: a stage belongs to the PROJECT (not to the trade,
-- which is how it works today and why 56 tasks read as "Others / Project
-- manager"); the schedulable node is a TRADE INSIDE A STAGE; dates are
-- COMPUTED from durations and finish-to-start links with lag; the anchor is a
-- start date going forward AND a required finish, so the screen can say how
-- many days over it lands rather than quietly drawing a lie.
--
-- WHY THE NODE IS TRADE-IN-STAGE. A stage-only network cannot say that
-- plumbing rough finishes a week before electrical rough starts - one bar,
-- no parallelism, and a critical path that means nothing. A task-level
-- network is the opposite failure: 145 open tasks on 55 Walnut, 42 of them
-- dated, and no duration column anywhere. Trade-in-stage is ~30 nodes on that
-- job, which is a schedule a person can actually fill in and read.
--
-- WHAT THIS FILE IS: the model and its arithmetic. The compute, the reads and
-- the write API are 082; the backfill of existing tasks onto the spine is
-- there too. Nothing here changes a single existing row.

-- ---------------------------------------------------------------------------
-- THE GATE VOCABULARY (Shahar, 2026-09-13: "Pre work walk through /
-- On-site - rough / On-site - inspection / On-site - final / On-site -
-- inspection. Every trade needs these four gates being scheduled on site.")
--
-- A table, not a CHECK constraint or an enum in the app: he wrote five lines
-- and called them four gates, and the answer to that should be a row somebody
-- edits, not a migration. Same shape as trades, trade_stages,
-- transaction_statuses, project_roles - the vocabulary is the database's
-- (rulebook 15).
--
-- lead_days is what the gate needs BOOKING ahead: a town inspector is not
-- available tomorrow because you finished today, and that lead time is where
-- weeks vanish on a build.
create table if not exists public.site_gates (
  gate text primary key,
  label text not null,
  sort_order integer not null,
  is_inspection boolean not null default false,
  -- Whether the gate after this one may only start once this one has passed.
  blocks_next boolean not null default true,
  lead_days integer not null default 0 check (lead_days >= 0),
  description text,
  created_at timestamptz not null default now(),
  created_by text default 'claude'
);

insert into public.site_gates (gate, label, sort_order, is_inspection, blocks_next, lead_days, description) values
  ('walkthrough',      'Pre-work walk through', 10, false, true, 0,
   'The trade walks the site before they start: what they are doing, what is in their way, what they need from somebody else.'),
  ('rough',            'On site — rough',       20, false, true, 0,
   'The rough work itself. The trade is on site for the whole window, not one day of it.'),
  ('rough_inspection', 'Inspection — rough',    30, true,  true, 3,
   'Rough signed off, usually by the town. Book it ahead: the inspector is not available because you finished.'),
  ('final',            'On site — final',       40, false, true, 0,
   'The finish work, after the trades that come between rough and final have been through.'),
  ('final_inspection', 'Inspection — final',    50, true,  false, 3,
   'Final sign-off. Nothing of this trade is done until it passes.')
on conflict (gate) do nothing;

comment on table public.site_gates is
  'The gates every trade is scheduled through on a site. A row, not an enum, so the list can change without a migration.';

-- ---------------------------------------------------------------------------
-- HOW LONG A TRADE TAKES, by default. A new job must not open as thirty empty
-- boxes to fill in - it opens as a schedule somebody CORRECTS, which is a far
-- smaller job than one they author. These are working days and they are
-- starting points, not promises; the number that matters is the one on the
-- activity after the GC has changed it.
alter table public.trades
  add column if not exists default_duration_days integer
    check (default_duration_days is null or default_duration_days > 0);

update public.trades set default_duration_days = v.d
from (values
  ('Demo & Excavation', 10), ('Tree Removal', 3), ('Waste Removal', 2),
  ('Masonry', 15), ('Waterproofing', 3), ('Framing', 20), ('Roofing', 7),
  ('Gutters', 2), ('Siding', 10), ('Stucco', 10),
  ('Plumbing', 10), ('HVAC', 10), ('Electrical', 10), ('Smart Home', 4),
  ('Alarms & Security', 3), ('Water Systems', 4), ('Insulation', 4),
  ('Drywall', 12), ('Tile', 8), ('Flooring Installer', 8),
  ('Stairs', 5), ('Railings', 3), ('Fireplace', 4), ('Cabinetry', 7),
  ('Painting', 12), ('Trim', 8), ('Countertops', 3), ('Central Vacuum', 3),
  ('Garage Doors', 2), ('Glass Doors', 3),
  ('Hardscaping', 10), ('Outdoor Kitchens', 8), ('Decks', 8),
  ('Pools & Spas', 20), ('Landscaping', 7), ('Irrigation', 4), ('Fencing', 4),
  ('Cleaning', 2), ('Powerwashing', 1), ('Portable toilet', 1),
  ('Site Engineering', 10), ('Surveyor', 5), ('Architecture', 20),
  ('Interior Design', 15), ('Project manager', 5), ('General Contractor', 5)
) as v(trade, d)
where public.trades.trade = v.trade and public.trades.default_duration_days is distinct from v.d;

-- Everything else that can actually be booked onto a site gets a working week.
update public.trades set default_duration_days = 5
where default_duration_days is null
  and (coalesce(is_construction, false) or coalesce(is_worker_trade, false));

-- ---------------------------------------------------------------------------
-- WHERE THE SCHEDULE IS ANCHORED.
--
-- Two dates, because Shahar asked for both directions: the job starts on
-- planned_start and the network computes forward from it, and required_finish
-- is what it is measured against - a closing, an occupancy, a sale. The
-- screen shows the computed finish beside the required one and says how many
-- days over. A chart that only ever draws the computed answer never tells you
-- you are late.
alter table public.projects
  add column if not exists planned_start date,
  add column if not exists required_finish date,
  -- Six-day weeks are normal on a build that is behind. Sunday is never a
  -- working day here; no holiday calendar yet, which is the first thing this
  -- will be wrong about.
  add column if not exists schedule_saturdays boolean not null default false,
  -- When the plan was frozen, so drift has something to be measured against.
  add column if not exists schedule_baselined_at timestamptz,
  add column if not exists schedule_computed_at timestamptz;

-- ---------------------------------------------------------------------------
-- THE SPINE. One ordered list of stages per project, copied from trade_stages
-- when the job is set up and editable per job afterwards - a renovation does
-- not have the same spine as a new build, and neither should be made to
-- pretend it does.
create table if not exists public.project_stages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  stage text not null,
  sort_order integer not null,
  -- Where it was copied from, so the default trade -> stage mapping still
  -- works on a job whose stage has since been renamed.
  from_trade_stage text references public.trade_stages(stage) on update cascade,
  note text,
  created_at timestamptz not null default now(),
  created_by text default 'claude',
  unique (project_id, stage)
);
create index if not exists idx_project_stages_project on public.project_stages (project_id, sort_order);

comment on table public.project_stages is
  'The ordered spine of one project. Copied from trade_stages at setup, then it belongs to the job.';

-- ---------------------------------------------------------------------------
-- THE NODE: one trade inside one stage. This is the thing that carries a
-- duration, gets linked to other nodes, and draws as a bar.
--
-- trade IS NULL is the stage's GENERAL activity - the home for work that
-- belongs to the stage but to no trade. Every stage gets one, which is what
-- lets actions.activity_id be a single required-ish link: a task always has
-- somewhere to sit, and through it always has a stage.
create table if not exists public.schedule_activities (
  id uuid primary key default gen_random_uuid(),
  project_stage_id uuid not null references public.project_stages(id) on delete cascade,
  trade text references public.trades(trade) on update cascade,
  -- Only when the trade's own name is not what this bar should say.
  title text,
  duration_days integer not null default 5 check (duration_days >= 0),

  -- COMPUTED by sched_recompute (082). Never written by hand - a date typed
  -- into a computed schedule is a date the next recompute silently discards.
  planned_start date,
  planned_finish date,
  late_start date,
  late_finish date,
  float_days integer,

  -- THE BASELINE: what the plan said when it was frozen. Without it "we are
  -- three weeks behind" has nothing to be behind of.
  baseline_start date,
  baseline_finish date,

  -- planned      nobody has started
  -- in progress  somebody is on it
  -- done         finished
  -- not applicable  this trade does not do this stage on this job. Counts as
  --                 zero days and keeps its links, so the chain still runs
  --                 through it rather than breaking.
  status text not null default 'planned'
    check (status in ('planned', 'in progress', 'done', 'not applicable')),
  na_reason text,
  note text,

  created_at timestamptz not null default now(),
  created_by text default 'claude',
  last_modified_at timestamptz,
  last_modified_by text,

  -- A reason is the whole point of marking something not applicable.
  constraint chk_activity_na_has_reason
    check (status <> 'not applicable' or coalesce(btrim(na_reason), '') <> '')
);
-- One activity per trade per stage, and exactly one General activity per
-- stage. Two partial indexes rather than UNIQUE NULLS NOT DISTINCT, which
-- would tie this to a Postgres version for no gain.
create unique index if not exists uq_activity_stage_trade
  on public.schedule_activities (project_stage_id, trade) where trade is not null;
create unique index if not exists uq_activity_stage_general
  on public.schedule_activities (project_stage_id) where trade is null;

comment on table public.schedule_activities is
  'One trade inside one stage - the schedulable node. trade IS NULL is the stage''s General activity, where work with no trade sits. planned_* and float_days are computed by sched_recompute; never write them by hand.';

-- ---------------------------------------------------------------------------
-- THE LINKS. Finish-to-start with lag, and MANY predecessors - drywall
-- follows electrical rough AND plumbing rough AND insulation, and a single
-- follows-this column could only ever record one of them, which would make
-- the critical path fiction.
--
-- lag_days is the wait AFTER the predecessor finishes: concrete cures seven
-- days before framing, an inspection is called three days after the rough is
-- done. It is the one extra number that covers nearly all residential
-- sequencing.
create table if not exists public.activity_links (
  id uuid primary key default gen_random_uuid(),
  before_activity_id uuid not null references public.schedule_activities(id) on delete cascade,
  after_activity_id uuid not null references public.schedule_activities(id) on delete cascade,
  lag_days integer not null default 0 check (lag_days >= 0),
  note text,
  created_at timestamptz not null default now(),
  created_by text default 'claude',
  unique (before_activity_id, after_activity_id),
  constraint chk_link_not_self check (before_activity_id <> after_activity_id)
);
create index if not exists idx_links_after on public.activity_links (after_activity_id);
create index if not exists idx_links_before on public.activity_links (before_activity_id);

comment on table public.activity_links is
  'Finish-to-start dependencies with lag. Many predecessors per activity; sched_recompute refuses a cycle rather than looping.';

-- ---------------------------------------------------------------------------
-- THE GATES ON AN ACTIVITY. The scheduler proper: which day this trade is
-- walking the site, which days they are on it, when the inspection is called.
--
-- attempt is there because an inspection FAILS. A re-inspection is a second
-- attempt at the same gate, not a correction of the first - the first
-- happened, and a schedule that overwrites it loses the week it cost.
create table if not exists public.activity_gates (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.schedule_activities(id) on delete cascade,
  gate text not null references public.site_gates(gate) on update cascade,
  attempt integer not null default 1 check (attempt >= 1),

  planned_on date,
  planned_through date,
  -- Who is booked. The trade's person; for an inspection, also the inspector,
  -- who is not the trade and does not work for you.
  contact_id uuid references public.contacts(id) on delete set null,
  inspector_contact_id uuid references public.contacts(id) on delete set null,

  status text not null default 'unscheduled'
    check (status in ('unscheduled', 'scheduled', 'done', 'passed', 'failed', 'not applicable')),
  outcome_note text,
  na_reason text,

  -- The task this gate spawned. The gate is the PLAN; the doing lives in
  -- actions like everything else (rulebook 10 - one task list, never a
  -- parallel one). Same shape as payment_stages spawning transactions.
  action_id uuid references public.actions(id) on delete set null,

  created_at timestamptz not null default now(),
  created_by text default 'claude',
  last_modified_at timestamptz,
  last_modified_by text,

  unique (activity_id, gate, attempt),
  constraint chk_gate_window check (planned_through is null or planned_on is null or planned_through >= planned_on),
  constraint chk_gate_na_has_reason
    check (status <> 'not applicable' or coalesce(btrim(na_reason), '') <> '')
  -- "Only an inspection passes or fails" needs site_gates.is_inspection, and a
  -- CHECK may not reach another table. It is enforced in sched_gate_set (082),
  -- where the gate row is already in hand.
);
create index if not exists idx_gates_activity on public.activity_gates (activity_id, gate, attempt);
create index if not exists idx_gates_when on public.activity_gates (planned_on) where status in ('scheduled', 'unscheduled');

comment on table public.activity_gates is
  'One booking of one gate on one activity. attempt > 1 is a re-inspection: the failed one happened and stays. action_id is the task it spawned - the plan lives here, the doing lives in actions.';

-- ---------------------------------------------------------------------------
-- A TASK SITS ON AN ACTIVITY, and therefore in a stage.
--
-- One nullable link, not two: a task with no trade goes on the stage's
-- General activity rather than needing its own stage_id, so "which stage is
-- this in" has exactly one answer and one join.
alter table public.actions
  add column if not exists activity_id uuid references public.schedule_activities(id) on delete set null;
create index if not exists idx_actions_activity on public.actions (activity_id)
  where activity_id is not null;

-- ---------------------------------------------------------------------------
-- WORKING-DAY ARITHMETIC. Sunday is never a working day; Saturday is one when
-- the project says so (projects.schedule_saturdays). p_week is the length of
-- the working week - 5 or 6 - so both cases are one piece of code.
--
-- No holiday calendar. That is the first thing this will be wrong about, and
-- it is a table away when it matters.
create or replace function public.sched_workday(p_date date, p_week integer default 5)
returns date
language plpgsql immutable
as $$
declare d date := p_date;
begin
  while extract(isodow from d)::int > p_week loop d := d + 1; end loop;
  return d;
end $$;

-- p_from + p_days working days, landing on a working day. 0 days means "the
-- same day", so a one-day activity starts and finishes on one date.
create or replace function public.sched_add_days(p_from date, p_days integer, p_week integer default 5)
returns date
language plpgsql immutable
as $$
declare d date; n integer := greatest(coalesce(p_days, 0), 0);
begin
  d := public.sched_workday(p_from, p_week);
  -- Whole weeks jump; the remainder walks, at most five steps.
  d := d + ((n / p_week) * 7);
  n := n % p_week;
  while n > 0 loop
    d := d + 1;
    while extract(isodow from d)::int > p_week loop d := d + 1; end loop;
    n := n - 1;
  end loop;
  return d;
end $$;

-- The same, backwards, for the late dates in the backward pass.
create or replace function public.sched_sub_days(p_from date, p_days integer, p_week integer default 5)
returns date
language plpgsql immutable
as $$
declare d date := p_from; n integer := greatest(coalesce(p_days, 0), 0);
begin
  while extract(isodow from d)::int > p_week loop d := d - 1; end loop;
  d := d - ((n / p_week) * 7);
  n := n % p_week;
  while n > 0 loop
    d := d - 1;
    while extract(isodow from d)::int > p_week loop d := d - 1; end loop;
    n := n - 1;
  end loop;
  return d;
end $$;

-- Working days from a to b. Negative when b is before a, which is exactly
-- what float wants to say: this activity has nowhere to move.
create or replace function public.sched_days_between(p_a date, p_b date, p_week integer default 5)
returns integer
language sql immutable
as $$
  select case
    when p_a is null or p_b is null then null
    when p_b >= p_a then (
      select count(*)::int - 1 from generate_series(p_a, p_b, interval '1 day') g
       where extract(isodow from g)::int <= p_week)
    else -(
      select count(*)::int - 1 from generate_series(p_b, p_a, interval '1 day') g
       where extract(isodow from g)::int <= p_week)
  end
$$;

-- ---------------------------------------------------------------------------
-- WHO MAY TOUCH A SCHEDULE. The GC and the PM run the calendar; everyone else
-- reads it. authority_rank 50 is the site project manager, 60 the site GC,
-- 70 the asset owner - the same ladder every other write on a project uses.
create or replace function public.sched_may_edit(p_project uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select public.is_superadmin()
      or (public.can_edit_project(p_project) and public.my_authority_rank(p_project) >= 50)
$$;

-- ---------------------------------------------------------------------------
-- RLS. Members READ the schedule of a project they are on; nobody WRITES
-- through the table - every change goes through the functions in 082, which
-- is what keeps the computed dates computed and the gate tasks in step.
alter table public.project_stages enable row level security;
alter table public.schedule_activities enable row level security;
alter table public.activity_links enable row level security;
alter table public.activity_gates enable row level security;
alter table public.site_gates enable row level security;

drop policy if exists project_stages_read on public.project_stages;
create policy project_stages_read on public.project_stages
  for select to authenticated
  using (public.is_project_member(project_id) or public.is_superadmin());

drop policy if exists schedule_activities_read on public.schedule_activities;
create policy schedule_activities_read on public.schedule_activities
  for select to authenticated
  using (exists (select 1 from public.project_stages s
                  where s.id = project_stage_id
                    and (public.is_project_member(s.project_id) or public.is_superadmin())));

drop policy if exists activity_links_read on public.activity_links;
create policy activity_links_read on public.activity_links
  for select to authenticated
  using (exists (select 1 from public.schedule_activities a
                   join public.project_stages s on s.id = a.project_stage_id
                  where a.id = after_activity_id
                    and (public.is_project_member(s.project_id) or public.is_superadmin())));

drop policy if exists activity_gates_read on public.activity_gates;
create policy activity_gates_read on public.activity_gates
  for select to authenticated
  using (exists (select 1 from public.schedule_activities a
                   join public.project_stages s on s.id = a.project_stage_id
                  where a.id = activity_id
                    and (public.is_project_member(s.project_id) or public.is_superadmin())));

-- The vocabulary is public to anybody signed in - it is five rows of English.
drop policy if exists site_gates_read on public.site_gates;
create policy site_gates_read on public.site_gates
  for select to authenticated using (true);

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
