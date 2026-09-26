-- A DIY JOB GETS A DIY LIST, NOT THE CONTRACTOR'S SCOPE.
--
-- Numbered 241 in the repo; applied to the database on 2026-09-25 as
-- 237_a_diy_job_gets_a_diy_list_not_the_contractors_scope (the structure)
-- and 237_diy_lists_content (the lists), while two other sessions were also
-- writing a 237.
--
-- Shahar, 2026-09-25: "DIY scope should be cleared for ALL packages, and
-- instead, a detailed DIY list should be provided." The list is free to read,
-- with a suggested $5 paid by Venmo (his call: show the price, unlock for
-- everyone, record nothing).
--
-- WHAT CHANGES
--   * blueprint_package_diy_steps - the homeowner's how-to for a package:
--     before you start, what you need, the work, finish and check. A step can
--     say a licensed pro is recommended for it (needs_pro) and that nothing
--     after it should start until it is done (is_gate).
--   * A DIY plan no longer copies the package's scope lines into
--     project_scope_items. Those lines are the contractor's contract - who
--     files the permit, the insurance, the warranty - and on a job you do
--     yourself none of them is true.
--   * Posting a plan ("switch to turn-key") copies them at that moment
--     instead (homeowner_scope_copy), so a hired job still has its scope.
--   * The DIY checklist (homeowner_diy_checklist) is built from the DIY list
--     first; the old sources remain only for a package with no list.
--   * The four DIY plans that already carried the scope are cleared of it.
--
-- WHY A NEW TABLE (rulebook 30). blueprint_package_items is the scope a
-- contractor is bound to; blueprint_activity_steps is the job's process that
-- the office runs on every generator job, hired or not (trigger 226). Neither
-- is written for the person holding the drill, and pointing either at them
-- would change what the other audience reads.

create table if not exists public.blueprint_package_diy_steps (
  id               uuid primary key default gen_random_uuid(),
  package_code     text not null references public.blueprint_packages(code) on update cascade on delete cascade,
  phase            text not null check (phase in ('prepare', 'gather', 'work', 'finish')),
  step             text not null check (btrim(step) <> ''),
  detail           text,
  needs_pro        boolean not null default false,
  is_gate          boolean not null default false,
  sort_order       integer not null default 100,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  created_by       text,
  last_modified_at timestamptz not null default now(),
  last_modified_by text
);
comment on table public.blueprint_package_diy_steps is
  'The detailed DIY list for a package: the homeowner''s own how-to, in four phases (prepare, gather, work, finish). Separate from blueprint_package_items, which is the scope a contractor is bound to, and from blueprint_activity_steps, which is the process the office runs on the job. A DIY plan''s checklist is built from these rows (homeowner_diy_checklist).';
comment on column public.blueprint_package_diy_steps.needs_pro is
  'The step is one we recommend a licensed professional does (inside the panel, gas piping, hot asphalt). The list still says how it is done.';
comment on column public.blueprint_package_diy_steps.is_gate is
  'Nothing after this step should start until it is done - a permit, a moisture test, calling 811.';
create index if not exists blueprint_package_diy_steps_pkg_idx on public.blueprint_package_diy_steps (package_code, sort_order);

alter table public.blueprint_package_diy_steps enable row level security;
drop policy if exists blueprint_package_diy_steps_read on public.blueprint_package_diy_steps;
create policy blueprint_package_diy_steps_read on public.blueprint_package_diy_steps for select using (true);
drop policy if exists blueprint_package_diy_steps_admin on public.blueprint_package_diy_steps;
create policy blueprint_package_diy_steps_admin on public.blueprint_package_diy_steps for all using (public.is_superadmin()) with check (public.is_superadmin());

-- A checklist task remembers which DIY step it came from, as a task already
-- remembers its scope line (actions.scope_item_id).
alter table public.actions
  add column if not exists diy_step_id uuid references public.blueprint_package_diy_steps(id) on delete set null;
comment on column public.actions.diy_step_id is
  'The DIY list step this checklist task was made from (homeowner_diy_checklist). Carries the phase and the licensed-pro flag to the checklist screen.';

-- ---- the suggested price and where it is paid ------------------------------
alter table public.config
  add column if not exists diy_list_suggested_cents integer check (diy_list_suggested_cents is null or diy_list_suggested_cents >= 0),
  add column if not exists diy_list_venmo text check (diy_list_venmo is null or diy_list_venmo ~ '^[A-Za-z0-9_-]{2,40}$');
comment on column public.config.diy_list_suggested_cents is
  'What the DIY list suggests paying for it (500 = $5). Voluntary: the list is open to everyone and nothing is recorded (Shahar, 2026-09-25). Null hides the suggestion.';
comment on column public.config.diy_list_venmo is
  'The Venmo handle the DIY list''s pay link opens, without the @.';
update public.config set diy_list_suggested_cents = 500, diy_list_venmo = 'Shahar-Greenberg';

-- ---- the list, for anyone ---------------------------------------------------
-- Anon-callable on purpose (rulebook 71): the list is free by Shahar's call,
-- read-only, and says nothing that is not already public by design.
create or replace function public.homeowner_diy_list(p_code text)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select case when not exists (select 1 from public.blueprint_package_diy_steps s where s.package_code = bp.code and s.is_active)
    then null else jsonb_build_object(
      'package', bp.code, 'name', bp.name, 'tile_title', bp.tile_title, 'trade', bp.trade,
      'requires_permit', bp.requires_permit,
      'suggested_cents', (select c.diy_list_suggested_cents from public.config c limit 1),
      'venmo', (select c.diy_list_venmo from public.config c limit 1),
      'steps', (select jsonb_agg(jsonb_build_object(
                  'id', s.id, 'phase', s.phase, 'step', s.step, 'detail', s.detail,
                  'needs_pro', s.needs_pro, 'is_gate', s.is_gate) order by s.sort_order, s.created_at)
                from public.blueprint_package_diy_steps s where s.package_code = bp.code and s.is_active))
  end
  from public.blueprint_packages bp where bp.code = p_code and bp.is_active;
$function$;
revoke all on function public.homeowner_diy_list(text) from public;
grant execute on function public.homeowner_diy_list(text) to anon, authenticated, service_role;

-- ---- the scope, copied when a job is hired ----------------------------------
-- The same copy homeowner_book always made, now a function so posting a plan
-- can make it too. Idempotent: a job that already has its package's lines
-- keeps them.
create or replace function public.homeowner_scope_copy(p_project uuid, p_code text)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare pkg public.blueprint_packages; n integer := 0;
begin
  select * into pkg from public.blueprint_packages where code = p_code;
  if pkg.code is null then return 0; end if;
  if exists (select 1 from public.project_scope_items where project_id = p_project and source = 'blueprint_packages.' || pkg.code) then
    return 0;
  end if;
  insert into public.project_scope_items (project_id, trade, item, category, source, is_required, add_to_contract, add_to_checklist,
                                          origin, notes, created_by, authority, owner_summary, audience)
  select p_project, pkg.trade, it.label, 'Package: ' || pkg.name, 'blueprint_packages.' || pkg.code, true, true, true,
         'blueprint copy', it.detail, 'homeowner-app', 'unassigned', it.detail, 'both'
    from public.blueprint_package_items it where it.package_code = pkg.code order by it.sort_order;
  get diagnostics n = row_count;
  return n;
end $function$;
revoke all on function public.homeowner_scope_copy(uuid, text) from public, anon, authenticated;
grant execute on function public.homeowner_scope_copy(uuid, text) to service_role;

-- ---- a plan stops copying the scope; posting a plan starts ------------------
do $mig$
declare src text; n int;
  a constant text := 'for it in select * from public.blueprint_package_items where package_code = pkg.code order by sort_order loop';
  b constant text := 'for it in select * from public.blueprint_package_items where package_code = pkg.code and not v_plan order by sort_order loop';
  c constant text := 'return public.homeowner_post_internal(p_project);';
  d constant text := 'perform public.homeowner_scope_copy(p_project, b.package_code);
    return public.homeowner_post_internal(p_project);';
begin
  src := pg_get_functiondef('public.homeowner_book'::regproc);
  n := (length(src) - length(replace(src, a, ''))) / length(a);
  if n <> 1 then raise exception 'homeowner_book: the scope loop matched % times, expected 1.', n; end if;
  execute replace(src, a, b);

  src := pg_get_functiondef('public.homeowner_booking_action'::regproc);
  n := (length(src) - length(replace(src, c, ''))) / length(c);
  if n <> 1 then raise exception 'homeowner_booking_action: the post call matched % times, expected 1.', n; end if;
  execute replace(src, c, d);
end $mig$;

-- ---- the DIY checklist is the DIY list ---------------------------------------
create or replace function public.homeowner_diy_checklist(p_project uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  me uuid := public.current_app_user_id();
  p public.projects;
  pkg public.blueprint_packages;
  v_contact uuid; v_parent uuid; v_made int := 0;
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.'); end if;
  select * into p from public.projects where id = p_project;
  if p.id is null then return jsonb_build_object('ok', false, 'reason', 'No such project.'); end if;
  if not public.is_project_member(p_project) then
    return jsonb_build_object('ok', false, 'reason', 'That job is not yours.');
  end if;

  select * into pkg from public.blueprint_packages where code = p.package_code and is_active;

  -- Generated once. Re-running after half of it is ticked must not
  -- resurrect what was closed.
  select id into v_parent from public.actions
   where project_id = p_project and source = 'homeowner:diy-checklist' and parent_action_id is null
   limit 1;
  if v_parent is not null then
    return jsonb_build_object('ok', true, 'already', true, 'parent_action_id', v_parent);
  end if;

  -- No DIY list written for this package: the office process where there is
  -- one (it runs on the job anyway), else the scope lines of an older plan.
  if not exists (select 1 from public.blueprint_package_diy_steps where package_code = pkg.code and is_active) then
    if pkg.activity_blueprint_id is not null then
      return public.project_process_start(p_project) || jsonb_build_object('source', 'activity blueprint');
    end if;
  end if;

  select contact_id into v_contact from public.app_users where id = me;

  insert into public.actions (action, status, priority, domain, project_id, created_by, source,
                              depth_level, assigned_to_contact_id, desired_outcome, notes)
  values ('Do it yourself: ' || coalesce(pkg.name, p.project_name), 'Not Started', 'Medium', 'construction',
          p_project, 'homeowner-app', 'homeowner:diy-checklist', 2, v_contact,
          'The job is finished to the same standard a contractor would be held to, by you.',
          'Every step below is from the package''s DIY list. Close them as you go; nothing here is sent to anybody.')
  returning id into v_parent;

  if exists (select 1 from public.blueprint_package_diy_steps where package_code = pkg.code and is_active) then
    insert into public.actions (action, status, priority, domain, project_id, parent_action_id, created_by,
                                source, depth_level, assigned_to_contact_id, notes, is_gate, step_order, diy_step_id)
    select s.step, 'Not Started', 'Medium', 'construction', p_project, v_parent, 'homeowner-app',
           'homeowner:diy-checklist', 3, v_contact, s.detail, s.is_gate, s.sort_order, s.id
      from public.blueprint_package_diy_steps s
     where s.package_code = pkg.code and s.is_active
     order by s.sort_order;
    get diagnostics v_made = row_count;
    return jsonb_build_object('ok', true, 'parent_action_id', v_parent, 'steps', v_made, 'source', 'diy list');
  end if;

  insert into public.actions (action, status, priority, domain, project_id, parent_action_id, created_by,
                              source, depth_level, assigned_to_contact_id, notes)
  select si.item, 'Not Started', 'Medium', 'construction', p_project, v_parent, 'homeowner-app',
         'homeowner:diy-checklist', 3, v_contact, si.owner_summary
    from public.project_scope_items si
   where si.project_id = p_project and coalesce(si.add_to_checklist, true)
   order by si.id;
  get diagnostics v_made = row_count;
  return jsonb_build_object('ok', true, 'parent_action_id', v_parent, 'steps', v_made, 'source', 'package scope');
end $function$;

create or replace function public.homeowner_checklist(p_project uuid)
 returns jsonb
 language sql
 stable
 set search_path to 'public'
as $function$
  select jsonb_build_object(
    'project_id', p.id,
    'delivery', p.delivery,
    'parent_action_id', (select a.id from public.actions a
                          where a.project_id = p.id
                            and a.source = 'homeowner:diy-checklist'
                            and a.parent_action_id is null limit 1),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id,
               'action', c.action,
               'status', c.status,
               'notes', c.notes,
               'asks', c.asks,
               'is_gate', coalesce(c.is_gate, false),
               'phase', ds.phase,
               'needs_pro', coalesce(ds.needs_pro, false),
               'done', c.status in ('Completed','Cancelled','Force Cancelled')
             ) order by c.step_order nulls last, c.created_at)
        from public.actions c
        join public.actions par on par.id = c.parent_action_id
        left join public.blueprint_package_diy_steps ds on ds.id = c.diy_step_id
       where par.project_id = p.id
         and par.source = 'homeowner:diy-checklist'
         and par.parent_action_id is null
    ), '[]'::jsonb)
  )
  from public.projects p
  where p.id = p_project;
$function$;

-- ---- Admin > Packages edits the list ------------------------------------------
do $mig$
declare src text; n int;
  s1 constant text := 'lk jsonb; e jsonb;';
  s1b constant text := 'lk jsonb; e jsonb; v_gate boolean;';
  s2 constant text := E'  when ''video'' then\n';
  s2b constant text := E'  when ''diy'' then\n'
    || E'    v_code := p_parent; t := nullif(btrim(p_patch->>''step''), ''''); d := nullif(btrim(p_patch->>''detail''), '''');\n'
    || E'    k := coalesce(nullif(btrim(p_patch->>''phase''), ''''), ''work'');\n'
    || E'    def := coalesce((p_patch->>''needs_pro'')::boolean, false); v_gate := coalesce((p_patch->>''is_gate'')::boolean, false);\n'
    || E'    act := coalesce((p_patch->>''is_active'')::boolean, true);\n'
    || E'    if t is null then return jsonb_build_object(''ok'', false, ''reason'', ''A DIY step needs words.''); end if;\n'
    || E'    if v_id is null then\n'
    || E'      insert into public.blueprint_package_diy_steps (package_code, phase, step, detail, needs_pro, is_gate, sort_order, is_active, created_by, last_modified_by)\n'
    || E'      values (v_code, k, t, d, def, v_gate, coalesce(so, 100), act, ''admin:packages'', ''admin:packages'') returning id into v_id;\n'
    || E'    else\n'
    || E'      update public.blueprint_package_diy_steps set phase = k, step = t, detail = d, needs_pro = def, is_gate = v_gate,\n'
    || E'             sort_order = coalesce(so, sort_order), is_active = act, last_modified_at = now(), last_modified_by = ''admin:packages''\n'
    || E'      where id = v_id returning package_code into v_code;\n'
    || E'    end if;\n\n'
    || E'  when ''video'' then\n';
  s3 constant text := E'  when ''video''     then delete';
  s3b constant text := E'  when ''diy''       then delete from public.blueprint_package_diy_steps where id = p_id returning package_code into v_code;\n'
    || E'  when ''video''     then delete';
begin
  src := pg_get_functiondef('public.admin_package_row_save'::regproc);
  n := (length(src) - length(replace(src, s1, ''))) / length(s1);
  if n <> 1 then raise exception 'row_save declare matched % times', n; end if;
  n := (length(src) - length(replace(src, s2, ''))) / length(s2);
  if n <> 1 then raise exception 'row_save video branch matched % times', n; end if;
  execute replace(replace(src, s1, s1b), s2, s2b);

  src := pg_get_functiondef('public.admin_package_row_delete'::regproc);
  n := (length(src) - length(replace(src, s3, ''))) / length(s3);
  if n <> 1 then raise exception 'row_delete video branch matched % times', n; end if;
  execute replace(src, s3, s3b);
end $mig$;

-- ---- the DIY plans that already carried the scope ----------------------------
delete from public.project_scope_items si
 using public.project_bookings b
 where b.project_id = si.project_id and b.state = 'planned'
   and si.source = 'blueprint_packages.' || b.package_code;

-- ---- the lists --------------------------------------------------------------
insert into public.blueprint_package_diy_steps (package_code, phase, step, detail, needs_pro, is_gate, sort_order, created_by, last_modified_by)
select v.*, 'claude 2026-09-25', 'claude 2026-09-25' from (values
('ev_charger','prepare','Check your panel has room for the circuit','Open the panel door. You need two free full-size slots for a 2-pole 50 A breaker. A 100 A panel that is already busy may not carry a charger - if in doubt, ask an electrician for a load calculation before you buy anything.',false,true,10),
('ev_charger','prepare','Pick the spot for the charger','Where the car''s charge port ends up when it is parked, within the charging cable''s reach (most are 18-25 ft). The garage wall nearest the panel keeps the run short and cheap.',false,false,20),
('ev_charger','prepare','Measure the run from the panel to the spot','Follow the path the cable will really take - along joists, around corners, down the wall - and add 10%.',false,false,30),
('ev_charger','prepare','Get the electrical permit','From your town''s construction office. In New Jersey the owner of a single-family home they live in can usually pull a homeowner electrical permit, and then passes the same rough and final inspections a contractor would.',false,true,40),
('ev_charger','gather','The charger','UL-listed, hardwired or plug-in (NEMA 14-50). Its manual names the breaker size: a 40 A charger needs a 50 A breaker.',false,false,50),
('ev_charger','gather','Breaker and wire','A 2-pole 50 A breaker made for your panel''s brand, and 6 AWG copper: 6/3 NM-B cable inside walls, or THHN in conduit where it is exposed.',false,false,60),
('ev_charger','gather','Small parts','Cable staples or conduit and straps, connectors for the panel knockout, anchors for masonry, and the charger''s mounting plate.',false,false,70),
('ev_charger','gather','Tools','Non-contact voltage tester and a multimeter, drill and bits, fish tape, wire strippers, level, and a torque screwdriver if the charger specifies torque.',false,false,80),
('ev_charger','work','Turn off the main breaker and prove the panel is dead','Check your tester on a live outlet first, then test inside the panel. The wires coming in from the utility are still live with the main off - never touch them.',true,true,90),
('ev_charger','work','Run the cable from the panel to the charger spot','Secure it within 12 in of each box and every 4.5 ft. In a garage, protect it in conduit wherever it is exposed below 8 ft.',false,false,100),
('ev_charger','work','Mount the charger','Level, at the height its manual gives (usually 3-4 ft to the bottom), screwed into studs or masonry anchors.',false,false,110),
('ev_charger','work','Connect the wires at the charger','Two hots and the ground (a neutral only if the model uses one), tightened to the torque on the label.',false,false,120),
('ev_charger','work','Install the breaker and connect the circuit in the panel','Snap in the 2-pole breaker, land the two hots on it and the ground on the ground bar, and label the circuit. Working inside the panel is where DIY goes wrong - we recommend a licensed electrician for this step.',true,false,130),
('ev_charger','finish','Rough inspection before any wall is closed','Book the inspector while the wiring is still visible.',false,true,140),
('ev_charger','finish','Power up and test a charge','Set the charger''s current limit to match the breaker (for example 40 A on a 50 A circuit), plug in the car and check it charges at the expected rate.',false,false,150),
('ev_charger','finish','Final inspection, permit closed','Keep the approval - your insurer and a future buyer will ask for it.',false,true,160),
('generator','prepare','Decide what it must power','Whole house or just the essentials (furnace, fridge, sump pump, some lights). This decides the size of the generator and the transfer switch.',false,false,10),
('generator','prepare','Pick the spot','Follow the manufacturer''s clearances - typically at least 5 ft from any window, door or vent opening and 18 in from the wall, never under a deck or overhang. The side nearest the gas meter and the panel keeps both runs short. Check your town''s setbacks from the property line.',false,false,20),
('generator','prepare','List every gas appliance in the house','Furnace or boiler, water heater, range, dryer, pool heater, fireplace, grill. A plumber needs the total to know whether the meter and the gas line can carry the generator too.',false,false,30),
('generator','prepare','Ask the gas utility about the meter','Tell them the generator''s gas input (a 22 kW unit burns roughly 300,000 BTU/h on natural gas) and ask whether the meter can carry it with the house. If it cannot, the utility upsizes it - that can take weeks, so ask first.',false,true,40),
('generator','prepare','Permits: electrical, plumbing (gas) and zoning','Most New Jersey towns want all three for a standby generator, with a plot plan showing the spot and its setbacks.',false,true,50),
('generator','gather','The generator with its transfer switch','The package''s suggested unit is the Generac Guardian 22 kW (model 7043), which ships with a 200 A automatic transfer switch. Match the switch to your service size.',false,false,60),
('generator','gather','The pad','A composite generator pad (QwikPad) or a 4 in concrete pad, on compacted gravel, level.',false,false,70),
('generator','gather','Wire, conduit, gas pipe and fittings','Sized to the runs you measured and the manufacturer''s tables. Gas pipe size depends on the length and the BTU load - use the pipe-sizing table in the installation manual.',false,false,80),
('generator','work','Set the pad and the generator','Compact about 4 in of gravel, set the pad level, then the unit. It weighs 400 lb or more - two people and an appliance dolly, or have the delivery crew place it.',false,false,90),
('generator','work','Install the transfer switch beside the main panel','This re-routes your home''s electrical service. A licensed electrician is strongly recommended.',true,false,100),
('generator','work','Run the power and control wiring from the generator to the switch','In conduit, sized to the generator''s output, following the manufacturer''s wiring diagram.',true,false,110),
('generator','work','Run the gas line from the meter to the generator','With a shut-off valve and a sediment trap at the unit. Gas piping needs a licensed plumber in most towns.',true,false,120),
('generator','work','Pressure-test the gas line','Before it is connected to the generator, and witnessed by the inspector where the town requires it.',true,true,130),
('generator','finish','Rough inspections - electrical and plumbing','Before trenches are backfilled or walls closed.',false,true,140),
('generator','finish','Start-up and load test','Follow the start-up section of the manual: battery in, set the exercise schedule, run it, then switch off the utility main to simulate an outage and confirm the switch transfers and the house runs.',false,false,150),
('generator','finish','Final inspections, permits closed','Keep the approvals.',false,true,160),
('generator','finish','Register the warranty','Most manufacturers require registration within a set time after start-up.',false,false,170),
('water_heater','prepare','Read the plate on the old heater','Gallons, fuel (gas or electric) and, for gas, the input in BTU/h and the venting type. Replacing like for like is the simple job; switching to tankless usually changes the gas line and the venting.',false,false,10),
('water_heater','prepare','Get the plumbing permit','Water heater replacements need a permit in New Jersey towns. An owner living in a single-family home can usually pull a homeowner permit.',false,true,20),
('water_heater','prepare','Measure the space and where the connections sit','Height and diameter of the old tank, and the positions of the water, gas or electric connections and the vent.',false,false,30),
('water_heater','gather','The new heater','Same fuel, sized to the household: roughly 40 gal for 1-2 people, 50 for 3-4, 75 for a bigger family.',false,false,40),
('water_heater','gather','Connectors and safety parts','Flexible water connectors, a relief-valve discharge pipe that ends within 6 in of the floor, a drain pan if it sits above finished space, and an expansion tank if your water line has a check valve or pressure reducer. For gas: a new flexible gas connector and a sediment trap.',false,false,50),
('water_heater','gather','Tools','Two pipe wrenches, garden hose, tubing cutter or PEX tool, gas leak-detection solution, appliance dolly.',false,false,60),
('water_heater','work','Shut it down and drain the old heater','Gas valve to off, or the breaker off for electric. Close the cold supply, open a hot tap upstairs, and drain through a hose to a floor drain or outside. The water is hot - let it cool first.',false,false,70),
('water_heater','work','Disconnect the water, the fuel and the vent','Disconnecting and reconnecting gas is where a licensed plumber earns the fee - we recommend one for the gas side.',true,false,80),
('water_heater','work','Set the new heater and connect the water','Cold in, hot out. Use dielectric fittings where copper meets the tank.',false,false,90),
('water_heater','work','Connect the gas and the vent (gas heaters)','The vent pipe rises at least 1/4 in per foot and is fastened with screws at every joint. Leak-test every gas joint with solution - bubbles mean it is not done.',true,false,100),
('water_heater','work','Fill the tank before any power or flame','Open a hot tap until water runs with no air. An electric element fired dry burns out in seconds.',false,true,110),
('water_heater','finish','Light it and check the vent','Light it by the instructions on the label, or restore the breaker. Hold a match at the vent hood: the flame should draw in. Set the thermostat to 120 F.',false,false,120),
('water_heater','finish','Inspection, permit closed',null,false,true,130),
('water_heater','finish','Get rid of the old tank','Scrap yards take steel tanks; many towns collect them on bulk-pickup day.',false,false,140),
('toilet','prepare','Measure the rough-in','From the finished wall (not the baseboard) to the centre of the floor bolts. 12 in is standard; 10 and 14 in exist. Buy a toilet that matches.',false,false,10),
('toilet','prepare','Choose the height','Standard (about 15 in to the rim) or comfort height (about 17 in), which is easier on knees.',false,false,20),
('toilet','gather','The toilet','Bowl and tank, or one piece. Check the box includes the seat - many do not.',false,false,30),
('toilet','gather','Parts','A wax ring (or a wax-free seal), new closet bolts, a braided supply line, plastic shims and a tube of caulk.',false,false,40),
('toilet','gather','Tools','Adjustable wrench, putty knife, sponge and bucket, small hacksaw, level, rubber gloves, an old towel.',false,false,50),
('toilet','work','Shut off the water and empty the old toilet','Close the stop valve, flush, and sponge out what is left in the tank and bowl.',false,false,60),
('toilet','work','Remove the old toilet and clean the flange','Unbolt it, lift it straight up, and stuff a rag in the drain to block sewer gas. Scrape off the old wax. Check the flange is not cracked and sits level with the floor - a repair ring or spacer fixes either.',false,true,70),
('toilet','work','Set the new seal and lower the bowl straight down','New bolts in the flange, the wax ring on, then the bowl straight onto the bolts. Press down with your weight - do not rock it once it is set.',false,false,80),
('toilet','work','Tighten evenly and shim','Alternate side to side and stop at snug - overtightening cracks porcelain. Shim until it does not rock.',false,false,90),
('toilet','work','Fit the tank and connect the supply line','Hand-tight plus a quarter turn on the supply line.',false,false,100),
('toilet','finish','Leak test','Open the valve, let it fill and flush a dozen times. Check the base and the supply line with a dry tissue.',false,false,110),
('toilet','finish','Caulk the base and trim the bolts','Caulk the front and sides but leave the back open, so a leak shows instead of rotting the floor.',false,false,120),
('toilet','finish','Get rid of the old toilet','Bulk pickup or the town transfer station.',false,false,130),
('garage_heater','prepare','Size the heater','About 45,000 BTU/h heats an insulated 2-car garage through a New Jersey winter. Go bigger for a 3-car or an uninsulated garage.',false,false,10),
('garage_heater','prepare','Check the rules for your garage','A gas heater in an attached garage has height and clearance rules (the burner usually at least 18 in above the floor) and most towns want a permit for new gas piping. Ask the construction office before you buy.',false,true,20),
('garage_heater','prepare','Find the nearest gas tie-in and plan the vent','The package assumes a gas line within about 15 ft. A sidewall vent needs clearance from windows and doors - the manual gives the distances.',false,false,30),
('garage_heater','gather','The heater and its kits','The unit heater, its hanging kit, its vent kit and a thermostat.',false,false,40),
('garage_heater','gather','Gas and power parts','Gas pipe and fittings, a shut-off valve, a sediment trap and a flexible connector; 120 V power for the fan - an outlet within cord reach or a new circuit.',false,false,50),
('garage_heater','gather','Tools','Drill, hole saw sized to the vent, pipe wrenches, gas leak-detection solution, a sturdy ladder.',false,false,60),
('garage_heater','work','Hang the heater from the framing','From joists or rafters with threaded rod or the brackets, level, with the clearances on its label.',false,false,70),
('garage_heater','work','Install the vent through the wall','Cut the hole, fit the vent kit and seal it inside and out, pitched as the manual says.',false,false,80),
('garage_heater','work','Run and connect the gas line','Gas piping and the connection at the heater: we recommend a licensed plumber, and most towns require one.',true,false,90),
('garage_heater','work','Power for the fan and the thermostat','Plug into an existing outlet if one is in reach. A new 120 V circuit is electrician''s work. Mount the thermostat on an inside wall away from the garage door.',true,false,100),
('garage_heater','finish','Leak-test every gas joint, then fire it','Soap solution on each joint. Bubbles mean shut the gas off and redo the joint.',false,true,110),
('garage_heater','finish','Run a full heating cycle','Check the flame, that the vent is drawing, and that the thermostat turns it on and off.',false,false,120),
('garage_heater','finish','Carbon-monoxide alarm and inspection','Put a CO alarm in the room next to the door into the house, and book the inspection if you pulled a permit.',false,false,130),
('garage_floor','prepare','Test the concrete for moisture and old sealer','Tape an 18 in square of plastic sheet to the floor for 24 hours. If it is damp underneath, moisture will lift any coating - stop and ask. Sprinkle water: if it beads, there is a sealer that has to come off.',false,true,10),
('garage_floor','prepare','Pick a weather window','Most coatings want 50-90 F and low humidity through the cure. Plan three dry days.',false,false,20),
('garage_floor','prepare','Empty the garage','Everything out, including what hangs low on the walls.',false,false,30),
('garage_floor','gather','The coating system','A 100%-solids epoxy base coat, color flake to broadcast (about 1 lb per 10 sq ft for full coverage) and a clear polyaspartic top coat. Buy 10% over your square footage.',false,false,40),
('garage_floor','gather','Rent a diamond grinder with a vacuum','Grinding opens the concrete so the coating bonds. Acid etching is the cheaper shortcut and bonds worse.',false,false,50),
('garage_floor','gather','Tools and protection','Respirator with organic-vapor cartridges, nitrile gloves, spiked shoes, 18 in roller and frames, squeegee, mixing paddle and drill, crack filler, painter''s tape.',false,false,60),
('garage_floor','work','Grind the whole floor','Edges with a hand grinder. Vacuum twice.',false,false,70),
('garage_floor','work','Fill cracks and pits','Epoxy or polyurea crack filler, ground flush once it has cured.',false,false,80),
('garage_floor','work','Base coat and broadcast the flake','Work in 4-ft sections and keep a wet edge. Toss the flake up so it falls evenly, until no base coat shows.',false,false,90),
('garage_floor','work','Next day: scrape and vacuum the loose flake','A floor scraper knocks off the high points; vacuum everything.',false,false,100),
('garage_floor','work','Clear top coat','Polyaspartic cures fast - mix small batches. Add anti-slip grit if you want more grip.',false,false,110),
('garage_floor','finish','Let it cure','Walk on it after about 24 hours, park on it after 72 (longer when it is cold).',false,false,120),
('garage_floor','finish','Look after it','Hot tires on a fresh floor can lift the coating, so wait the full cure. Clean with mild soap, never solvents.',false,false,130),
('faucet','prepare','Check what you have','Count the holes in the sink or counter and look at the valves under it (usually 3/8 in compression). Buy a faucet that fits the holes, or one with a deck plate to cover them.',false,false,10),
('faucet','gather','The faucet and parts','The faucet, two braided supply lines of the right length, and plumber''s putty or silicone - whichever the faucet''s instructions say.',false,false,20),
('faucet','gather','Tools','Basin wrench, adjustable wrench, bucket, towel, flashlight.',false,false,30),
('faucet','work','Shut off both valves under the sink','Open the faucet to let the pressure out. If a valve will not close fully, fix that first or shut the main.',false,true,40),
('faucet','work','Disconnect and remove the old faucet','Undo the supply lines, then the mounting nuts with the basin wrench.',false,false,50),
('faucet','work','Clean the deck and set the new faucet','With its gasket, or a bead of putty if the instructions call for it.',false,false,60),
('faucet','work','Tighten the mounting and connect the new supply lines','Hand-tight plus a quarter turn. Kitchen: fit the pull-down hose weight. Bathroom: connect the drain stopper linkage.',false,false,70),
('faucet','finish','Flush the lines','Take off the aerator, open the valves slowly, and run hot and cold for a minute to clear debris. Refit the aerator.',false,false,80),
('faucet','finish','Check for drips','A dry paper towel under every connection now, and again the next day.',false,false,90),
('faucet','finish','Get rid of the old faucet','It is scrap metal.',false,false,100),
('driveway','prepare','Call 811 before you dig','Free, and required by law in New Jersey at least 3 business days before excavating. Gas, water and cable lines run under many driveways.',false,true,10),
('driveway','prepare','Check with your town','Many towns need a permit for work on the apron in the public right-of-way, and some limit changes to paved area.',false,false,20),
('driveway','prepare','Measure the area','Length times width. The package lays 2 in of compacted asphalt over a compacted stone base.',false,false,30),
('driveway','gather','Rent the equipment','A skid steer or mini excavator for the tear-out, a plate compactor for the base, and a roller for the asphalt.',false,false,40),
('driveway','gather','Order the materials','Quarry-process stone for the base; hot-mix asphalt from a plant, ordered by the ton (about 110 lb per square yard per inch of thickness); a dumpster for the old asphalt.',false,false,50),
('driveway','gather','Line up a crew','Hot asphalt has to be spread and rolled within about 30-60 minutes of arriving. That takes 3-4 people with rakes and lutes.',false,false,60),
('driveway','work','Tear out the old surface','Into the dumpster - old asphalt is recycled.',false,false,70),
('driveway','work','Grade and compact the base','Slope it so water runs away from the house (about 2%), and compact the stone in 2 in layers.',false,false,80),
('driveway','work','Lay and roll the asphalt','This is the step most homeowners hire even when they do the tear-out themselves - it is fast, hot and unforgiving.',true,false,90),
('driveway','finish','Seal the edges and keep off it','Walk on it the next day, drive on it after 3 days, and do not turn the wheel while parked during the first hot weeks.',false,false,100),
('driveway','finish','Seal-coat later, not now','Wait 6-12 months before the first seal coat.',false,false,110),
('interior_painting','prepare','House built before 1978? Test for lead first','Sanding lead paint makes dangerous dust. Use an EPA-recognized test kit on the surfaces you will sand.',false,true,10),
('interior_painting','prepare','Choose the paint and the sheen','Eggshell or satin for walls, flat for ceilings, semi-gloss for trim. About 1 gallon per 350 sq ft per coat.',false,false,20),
('interior_painting','prepare','Clear and protect the room','Furniture to the middle and covered, drop cloths down, outlet and switch covers off.',false,false,30),
('interior_painting','gather','Materials','Paint, primer for patched spots, spackle, 120-180 grit sandpaper, painter''s tape.',false,false,40),
('interior_painting','gather','Tools','2.5 in angled brush, 9 in roller with 3/8 in nap, tray, extension pole, step ladder.',false,false,50),
('interior_painting','work','Patch, sand and spot-prime','Fill holes and cracks, let dry, sand smooth, prime the patches so they do not show through.',false,false,60),
('interior_painting','work','Wash greasy walls','Kitchens especially - degreaser, rinse, let dry.',false,false,70),
('interior_painting','work','Cut in the edges','Brush a band along the ceiling, corners and trim. Tape first if your hand is not steady.',false,false,80),
('interior_painting','work','Roll the walls','One wall at a time, top to bottom, in a W pattern, keeping a wet edge.',false,false,90),
('interior_painting','work','Second coat','After the recoat time on the can.',false,false,100),
('interior_painting','finish','Pull the tape while the paint is still slightly soft','At a 45 degree angle, slowly.',false,false,110),
('interior_painting','finish','Touch up and put the room back','Covers back on and furniture back after 24 hours. Clean the brushes and roller.',false,false,120),
('interior_painting','finish','Label the leftover paint','Room and date on the lid, for touch-ups.',false,false,130),
('sprinklers','prepare','Know your system','How many zones, where the backflow preventer is, and where the irrigation shut-off valve is.',false,false,10),
('sprinklers','prepare','Pick the date','Before the first hard freeze - in Bergen County usually late October to mid-November.',false,false,20),
('sprinklers','gather','Rent a big enough compressor','A towable or large rental compressor. A small pancake compressor cannot move enough air for more than a zone or two.',false,false,30),
('sprinklers','gather','Fittings and protection','A blowout adapter that fits your system''s blowout port, and safety glasses.',false,false,40),
('sprinklers','work','Shut off the water to the system','Close the irrigation shut-off and set the controller to off.',false,false,50),
('sprinklers','work','Connect the compressor after the backflow preventer','At the blowout port. Never push air back through the backflow preventer - leave its test cocks half open.',false,true,60),
('sprinklers','work','Set the pressure','No more than 50 psi for most home systems.',false,false,70),
('sprinklers','work','Blow out each zone','Open one zone at the controller and blow until only mist comes out, then move on. Two passes per zone. Never blow air into a system with every zone closed.',false,false,80),
('sprinklers','work','Drain the backflow preventer','Open the test cocks and leave the valves at 45 degrees.',false,false,90),
('sprinklers','finish','Shut the controller down for the season','Off, or rain mode. Note any broken heads you saw for spring.',false,false,100),
('sprinklers','finish','Insulate the backflow preventer','If it is exposed, a cover or insulating bag.',false,false,110),
('gutters','prepare','Set up the ladder safely','Extension ladder 3 ft above the gutter, at a 4-to-1 angle, on firm level ground, with a stabilizer so it does not rest on the gutter. Never work alone.',false,true,10),
('gutters','prepare','Two stories or more?','Second-story gutters from a ladder are where most falls happen. Most people hire this height.',true,false,20),
('gutters','prepare','Pick a dry day','Wet leaves are heavy and ladders slip.',false,false,30),
('gutters','gather','Tools and parts','Gloves, gutter scoop, bucket with a hook, garden hose with a spray nozzle, tarp for the debris, gutter sealant, replacement hidden hangers and screws.',false,false,40),
('gutters','work','Scoop out the debris','Start at the downspout end and work outward. Bag it or drop it on the tarp.',false,false,50),
('gutters','work','Flush each run','Hose toward the downspout and watch the water flows away.',false,false,60),
('gutters','work','Clear blocked downspouts','Hose from the top; use a plumber''s snake if it will not clear.',false,false,70),
('gutters','work','Re-secure loose hangers','Screw into the fascia behind the gutter, one every 24 in.',false,false,80),
('gutters','work','Seal small leaks at the seams','Dry and clean the joint, then gutter sealant on the inside.',false,false,90),
('gutters','finish','Run water once more','Watch the whole run from the ground.',false,false,100),
('gutters','finish','Check where the water goes','Each downspout should discharge 4-6 ft from the foundation - add extensions if not.',false,false,110),
('blinds','prepare','Choose inside or outside mount','Inside sits in the window recess (check the recess is deep enough for the bracket); outside covers the frame.',false,false,10),
('blinds','prepare','Measure every window','Inside mount: width at the top, middle and bottom - use the smallest; height at left, centre and right - use the longest. Measure each window; they are rarely identical.',false,false,20),
('blinds','prepare','Order to the exact measurement','For inside mount the maker takes off the clearance - do not deduct it yourself.',false,false,30),
('blinds','gather','Tools and fixings','Drill and driver, bits, level, pencil, tape measure, and anchors for drywall or masonry.',false,false,40),
('blinds','work','Mark the bracket positions','Level, 2-3 in in from each end, with any centre supports evenly spaced.',false,false,50),
('blinds','work','Mount the brackets','Pre-drill; screw into wood trim or framing, anchors into drywall.',false,false,60),
('blinds','work','Hang the blinds','Snap the headrail into the brackets and fit the valance, wand or cords.',false,false,70),
('blinds','work','Motorized blinds: charge and pair','Follow the maker''s steps for the motor, remote or app.',false,false,80),
('blinds','finish','Test each one','Fully up, fully down, and tilt. Set the limits on motorized ones.',false,false,90),
('blinds','finish','Child safety','Mount cord cleats at least 5 ft 3 in above the floor and wrap any loops. Cordless is safest in children''s rooms.',false,true,100),
('blinds','finish','Recycle the packaging',null,false,false,110),
('windows_doors','prepare','House built before 1978? Test for lead first','Old window frames are a common source of lead dust when removed. Use an EPA-recognized test kit.',false,true,10),
('windows_doors','prepare','Measure for a replacement window','Width between the side jambs at top, middle and bottom - use the smallest; height at left, centre and right - use the smallest. Follow the manufacturer''s deductions.',false,false,20),
('windows_doors','prepare','Check the rules and order','Like-for-like replacement is often permit-free in New Jersey, but ask your town. A bedroom window must stay large enough to escape through. Lead times are often 2-6 weeks.',false,false,30),
('windows_doors','gather','Materials','The window, low-expansion window-and-door foam, exterior sealant, shims, screws, flashing tape.',false,false,40),
('windows_doors','gather','Tools','Pry bar, utility knife, level, caulk gun, drill, a second person for anything heavy.',false,false,50),
('windows_doors','work','Remove the stops and the old sashes','Keep the frame. Take out the old balances or sash weights.',false,false,60),
('windows_doors','work','Check the sill','It must be sound and level. Fix any rot before you go on.',false,true,70),
('windows_doors','work','Set the new window','Dry-fit first. Run sealant on the outside stops, set the window, and shim at the screw points until it is plumb, level and square (equal diagonals).',false,false,80),
('windows_doors','work','Fasten, check and foam','Screw through the jambs, check it opens and locks smoothly, then fill the gaps with low-expansion foam.',false,false,90),
('windows_doors','finish','Trim and caulk','Refit the stops and trim; caulk inside and out.',false,false,100),
('windows_doors','finish','Test and clean up','Operation and locks; peel off the labels.',false,false,110),
('windows_doors','finish','Get rid of the old window','Glass and frame - bulk pickup or the transfer station.',false,false,120),
('deck_fence','prepare','Find your property line','Work from your survey. A fence on the neighbour''s land is theirs to take down. When unsure, have a surveyor stake the corners.',false,true,10),
('deck_fence','prepare','Get the zoning permit and read the rules','Most New Jersey towns need a fence permit. Height limits are common (often 6 ft in the back, 4 ft in front), and the finished side usually has to face out.',false,true,20),
('deck_fence','prepare','Call 811 before you dig','Free, and required by law in New Jersey at least 3 business days before digging.',false,true,30),
('deck_fence','prepare','Tell your neighbours','It saves an argument later.',false,false,40),
('deck_fence','gather','Materials','4x4 pressure-treated posts rated for ground contact (one every 8 ft), panels or rails and pickets, a gate kit with hinges and latch, one bag of concrete per post, gravel, coated or galvanized screws.',false,false,50),
('deck_fence','gather','Tools','Post-hole digger or a rented auger, string line and stakes, level, circular saw, drill.',false,false,60),
('deck_fence','work','Take down the old fence','And pull the old footings.',false,false,70),
('deck_fence','work','String a line and mark every post','Measure from the line, not by eye.',false,false,80),
('deck_fence','work','Dig the post holes','About 30-36 in deep (below the frost line), three times the post''s width, with 4 in of gravel in the bottom.',false,false,90),
('deck_fence','work','Set the end and gate posts first, then the line posts','Plumb each one and pour the concrete; line posts go to the string.',false,false,100),
('deck_fence','work','Hang the panels or rails and pickets','After the concrete has set (24-48 hours). Keep them level, or step them down a slope.',false,false,110),
('deck_fence','work','Hang the gate','Gate posts must be solid. Leave about 1 in of gap for the swing.',false,false,120),
('deck_fence','finish','Final zoning inspection','If your town requires one.',false,false,130),
('deck_fence','finish','Haul away the old fence',null,false,false,140)
) as v(package_code, phase, step, detail, needs_pro, is_gate, sort_order)
where not exists (select 1 from public.blueprint_package_diy_steps s where s.package_code = v.package_code);

update public.config set schema_version = schema_version + 1, schema_updated_at = current_date;
