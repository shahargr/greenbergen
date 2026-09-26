-- THE HOUSE REMEMBERS WHAT IT BURNS.
--
-- Shahar, 2026-09-21: "where the scope of the project is defined, the user
-- should be asked to upload info on existing gas devices: images and model
-- numbers. gas fireplace, gas range, water heater, bbq, pool heater,
-- furness, dryer, and oven. this info be sent along the bid."
--
-- The generator process already turns on this number. Step 10 says "add up
-- what the house already burns... EVERY GAS APPLIANCE, off its nameplate -
-- not off a spec sheet for a similar model, off the plate on the machine",
-- and step 20 asks whether the meter carries the house plus the generator.
-- Answer 20 wrong and the utility has to upsize the meter, which is weeks at
-- best and a season at worst. So the survey is not paperwork - it is the
-- input to the one question that decides how long this job takes.
--
-- Until now there was nowhere to put it. The plate photographs had no home:
-- file_links reaches actions, scope items, bid packages and transactions,
-- and nothing that is a THING IN THE HOUSE.
--
-- KEYED TO THE HOUSE, NOT THE JOB (Shahar's call: "a record of the house").
-- Ran's water heater is the same water heater next year. Collect it once,
-- and every future gas job at that address reads it instead of asking again.
-- assets already holds the house - Ran's is 'real estate', 8 Jason Woods Rd -
-- so the survey hangs off that.
--
-- WHY NOT CHILD ASSETS, which was the first instinct and is wrong: an asset
-- cannot say THERE IS NO POOL HEATER. The survey has three answers per
-- appliance - yes, no, and nobody has said - and only the first is a thing
-- that exists. A row per (house, kind) holds all three; a row per appliance
-- holds one. "No pool heater" is a real and useful answer, and the commonest
-- one.

-- ---- the eight questions --------------------------------------------------
create table if not exists public.gas_appliance_kinds (
  key             text primary key,
  label           text not null,
  sort_order      int  not null,
  -- What the UI shows under the field. A typical range is not a rule; it is
  -- how somebody notices they read the OUTPUT rating off the plate instead of
  -- the input, which is the mistake step 10 warns about by name.
  typical_btuh_low  int,
  typical_btuh_high int,
  hint            text
);

comment on table public.gas_appliance_kinds is
  'The gas appliances a house is asked about when a job needs the total connected load. Ordered by how much they typically draw, biggest first, because that is the order in which getting one wrong matters.';

insert into public.gas_appliance_kinds (key, label, sort_order, typical_btuh_low, typical_btuh_high, hint) values
  ('pool_heater',  'Pool heater',      10, 250000, 400000, 'The biggest burner most houses have, and the one people forget because it runs half the year. Plate is usually on the side panel.'),
  ('furnace',      'Furnace or boiler',20,  60000, 150000, 'The plate is inside the front panel. If there are two units, record the bigger one here and the other in the note.'),
  ('water_heater', 'Water heater',     30,  30000, 200000, 'A tank is usually 30-50k; a TANKLESS is 150-200k and changes the answer completely. Say which it is.'),
  ('bbq',          'BBQ',              40,  30000,  60000, 'Only if it is PLUMBED IN. A bottle on the patio is not on the meter and does not count.'),
  ('range',        'Gas range',        50,  40000,  65000, 'Cooktop and oven together, as one appliance. If the oven is a separate wall unit, record it below instead.'),
  ('fireplace',    'Gas fireplace',    60,  20000,  40000, 'Each one, if there is more than one - put the second in the note with its own rating.'),
  ('oven',         'Wall oven',        70,  15000,  30000, 'Only a SEPARATE oven. If it is part of the range above, leave this one as not present.'),
  ('dryer',        'Gas dryer',        80,  20000,  25000, 'Check it is gas and not electric - the plug is the giveaway.')
on conflict (key) do nothing;

-- ---- the answers ----------------------------------------------------------
create table if not exists public.gas_appliances (
  id            uuid primary key default gen_random_uuid(),
  -- THE HOUSE. Not the project: the whole point is that it outlives the job.
  asset_id      uuid not null references public.assets(id) on delete cascade,
  kind          text not null references public.gas_appliance_kinds(key),

  -- NULL means nobody has answered yet, which is not the same as "no". The
  -- survey is asked, not enforced (Shahar), so the difference has to survive
  -- into the bid - a plumber reading "not answered" knows to ask, and one
  -- reading "no pool heater" does not.
  present       boolean,

  manufacturer  text,
  model         text,
  input_btuh    numeric,
  -- Natural gas and propane are different numbers off the same model, which
  -- is why the process says "name the fuel".
  fuel          text check (fuel is null or fuel in ('natural gas', 'propane')),
  location      text,
  note          text,

  surveyed_at   timestamptz,
  surveyed_by   text,
  created_at    timestamptz not null default now(),
  created_by    text,
  last_modified_at timestamptz not null default now(),
  last_modified_by text,

  -- One answer per appliance per house.
  unique (asset_id, kind),
  -- An appliance that is not there has no plate to read, so a rating on it is
  -- a contradiction rather than a harmless leftover.
  constraint gas_appliances_absent_is_blank
    check (present is not false or (model is null and input_btuh is null and manufacturer is null))
);

comment on table public.gas_appliances is
  'What a house burns, one row per (house, appliance kind). present = null means nobody has been asked yet; false means asked and there is none. Feeds the total connected load that the generator process step 10 needs and step 20 turns on.';

create index if not exists gas_appliances_asset_idx on public.gas_appliances (asset_id);

-- ---- a plate photograph now has somewhere to hang -------------------------
alter table public.file_links
  add column if not exists gas_appliance_id uuid references public.gas_appliances(id) on delete cascade;

create index if not exists file_links_gas_appliance_idx
  on public.file_links (gas_appliance_id) where gas_appliance_id is not null;

-- file_links' RLS resolves a row to a project and asks whether you are in it.
-- An appliance belongs to a HOUSE, which may carry several projects, so it
-- resolves to the oldest live project on that house - being on any job at the
-- address is what earns you sight of the water heater's plate.
do $mig$
declare
  src text; n int;
  a constant text := $q$    (select si.project_id from public.project_scope_items si where si.id = p_link.project_scope_item_id)$q$;
  b constant text := $q$    (select si.project_id from public.project_scope_items si where si.id = p_link.project_scope_item_id),
    (select pr.id from public.gas_appliances ga
       join public.projects pr on pr.asset_id = ga.asset_id and pr.trashed_at is null
      where ga.id = p_link.gas_appliance_id
      order by pr.created_at limit 1)$q$;
begin
  src := pg_get_functiondef('public.file_link_project_id(public.file_links)'::regprocedure);
  n := (length(src) - length(replace(src, a, ''))) / length(a);
  if n <> 1 then raise exception 'The scope-item clause matched % times, expected 1.', n; end if;
  execute replace(src, a, b);
end $mig$;

-- ---- who may see it -------------------------------------------------------
-- Being on ANY live job at the address. The survey is the house's, so it
-- cannot hang off one project's membership.
create or replace function public.is_asset_member(p_asset uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select exists (
    select 1
      from public.projects pr
      join public.project_members pm on pm.project_id = pr.id
     where pr.asset_id = p_asset
       and pr.trashed_at is null
       and pm.app_user_id = public.current_app_user_id()
       and pm.status = 'active');
$fn$;

revoke all on function public.is_asset_member(uuid) from public, anon;
grant execute on function public.is_asset_member(uuid) to authenticated, service_role;

alter table public.gas_appliances enable row level security;
alter table public.gas_appliance_kinds enable row level security;

-- The eight questions are not a secret; the answers are.
drop policy if exists gas_kind_read on public.gas_appliance_kinds;
create policy gas_kind_read on public.gas_appliance_kinds for select to authenticated using (true);

drop policy if exists gas_appliance_read on public.gas_appliances;
create policy gas_appliance_read on public.gas_appliances for select to authenticated
  using (public.is_asset_member(asset_id) or public.is_superadmin());

-- NO WRITE POLICY, deliberately. Writing goes through the portal functions in
-- 229, which decide who may answer and stamp who did (rulebook 71).

grant select on public.gas_appliance_kinds to authenticated;
grant select on public.gas_appliances to authenticated;
