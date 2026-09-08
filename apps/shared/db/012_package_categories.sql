-- 012 - the catalogue gets sections, and seasonality moves onto the package.
--
-- Until now the only grouping was blueprint_packages.tile_group: front or
-- more. That is a LAYOUT axis - above the fold, or behind the More tile - and
-- it was doing duty as a meaning axis it cannot carry. Seventeen packages fit
-- in "front and more"; forty will not.
--
-- WHY A LOOKUP TABLE AND NOT A CHECK CONSTRAINT (rulebook 03): a vocabulary
-- is a table, not a list in anyone's head. Sections carry a label, a blurb and
-- an order that Shahar will want to tune, and none of that belongs in a
-- deploy.
--
-- WHY tile_group SURVIVES (rulebook 30/31): it is not the same idea wearing a
-- different name. tile_group answers "does this show on the home screen"; the
-- category answers "what kind of thing is this". Both are real, and merging
-- them would lose one.
--
-- SEASONALITY IS A WINDOW, NOT A SECTION. Gutter cleaning is seasonal AND
-- maintenance; filing it under "Seasonal" would delete it from where people
-- look in June. So a package carries the months it makes sense in, and the
-- app surfaces "in season now" as a rail across the top of any section.
-- src/lib/seasons.ts already does this per TRADE for the portal; that stays
-- for trades, but a trade is too coarse for a package - Gutters runs all year
-- while gutter CLEANING is autumn.

create table if not exists public.blueprint_package_categories (
  key          text primary key,
  label        text not null,
  blurb        text,
  sort_order   integer not null default 100,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  last_modified_at timestamptz
);

comment on table public.blueprint_package_categories is
  'Sections of the homeowner catalogue, grouped by what is going on in the owner''s life rather than by trade. Template data (rulebook 31: blueprint_ = template).';

insert into public.blueprint_package_categories (key, label, blurb, sort_order) values
  ('fix',      'Fix something',      'It broke. Get it working again.',                 10),
  ('upkeep',   'Keep it up',         'The recurring jobs that stop bigger ones.',       20),
  ('inside',   'Inside',             'Rooms, surfaces and everything under the roof.',  30),
  ('outside',  'Outside',            'The yard, the drive and the shell of the house.', 40),
  ('systems',  'Power, safety & tech','Electricity, back-up, charging and what watches the house.', 50),
  ('services', 'Bills & services',   'The last mile: what the house pays for every month.', 60),
  ('other',    'Something else',     'Not on the list? Describe it and we will price it.', 900)
on conflict (key) do update
  set label = excluded.label, blurb = excluded.blurb, sort_order = excluded.sort_order;

alter table public.blueprint_packages
  add column if not exists category text references public.blueprint_package_categories(key),
  -- null = all year. Month numbers 1-12, as src/lib/seasons.ts already uses.
  add column if not exists season_months integer[];

comment on column public.blueprint_packages.season_months is
  'Months (1-12) this package is worth doing in Bergen County; null means all year. A WINDOW, not a section - the package keeps its category and the app surfaces "in season now" separately.';

-- Every package placed. Nothing lands in a section bigger than six.
update public.blueprint_packages set category = case code
    when 'water_heater'      then 'fix'
    when 'toilet'            then 'fix'
    when 'faucet'            then 'fix'
    when 'gutters'           then 'upkeep'
    when 'interior_painting' then 'inside'
    when 'blinds'            then 'inside'
    when 'windows_doors'     then 'inside'
    when 'kitchen'           then 'inside'
    when 'bathroom'          then 'inside'
    when 'basement'          then 'inside'
    when 'driveway'          then 'outside'
    when 'deck_fence'        then 'outside'
    when 'siding'            then 'outside'
    when 'ev_charger'        then 'systems'
    when 'generator'         then 'systems'
    when 'solar'             then 'systems'
    when 'something_else'    then 'other'
    else category
  end
where category is distinct from (case code
    when 'water_heater' then 'fix' when 'toilet' then 'fix' when 'faucet' then 'fix'
    when 'gutters' then 'upkeep'
    when 'interior_painting' then 'inside' when 'blinds' then 'inside' when 'windows_doors' then 'inside'
    when 'kitchen' then 'inside' when 'bathroom' then 'inside' when 'basement' then 'inside'
    when 'driveway' then 'outside' when 'deck_fence' then 'outside' when 'siding' then 'outside'
    when 'ev_charger' then 'systems' when 'generator' then 'systems' when 'solar' then 'systems'
    when 'something_else' then 'other' else category end);

-- The windows that are true today. Gutter cleaning is the clear one: leaves
-- are down from October and you want them out before the first freeze.
-- Driveway asphalt cannot be laid cold. Everything else is all year.
update public.blueprint_packages set season_months = array[9,10,11,12] where code = 'gutters';
update public.blueprint_packages set season_months = array[4,5,6,7,8,9,10] where code = 'driveway';

-- The grid read gains both fields. Still the small payload the home screen
-- caches deployment-wide (2.9 kB against the full catalogue's 37 kB).
create or replace function public.homeowner_catalogue_tiles()
returns jsonb
language sql
stable security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'code', p.code, 'tile_title', p.tile_title, 'tile_line2', p.tile_line2,
    'tile_group', p.tile_group, 'availability', p.availability,
    'illustration', p.illustration, 'sort_order', p.sort_order,
    'category', p.category, 'season_months', p.season_months)
    order by p.sort_order, p.name), '[]'::jsonb)
  from public.blueprint_packages p
  where p.is_active;
$$;

-- The sections themselves, so labels and order are editable without a deploy.
create or replace function public.homeowner_catalogue_sections()
returns jsonb
language sql
stable security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', c.key, 'label', c.label, 'blurb', c.blurb, 'sort_order', c.sort_order)
    order by c.sort_order, c.label), '[]'::jsonb)
  from public.blueprint_package_categories c
  where c.is_active;
$$;

-- The catalogue is template data read by signed-out visitors through the
-- publishable key, exactly as the tiles already are - so anon keeps EXECUTE
-- here, deliberately, unlike the portal_* functions revoked in 010.
revoke all on function public.homeowner_catalogue_tiles() from public;
grant execute on function public.homeowner_catalogue_tiles() to anon, authenticated, service_role;
revoke all on function public.homeowner_catalogue_sections() from public;
grant execute on function public.homeowner_catalogue_sections() to anon, authenticated, service_role;

alter table public.blueprint_package_categories enable row level security;
drop policy if exists bpc_read on public.blueprint_package_categories;
create policy bpc_read on public.blueprint_package_categories for select using (true);
drop policy if exists bpc_admin on public.blueprint_package_categories;
create policy bpc_admin on public.blueprint_package_categories for all
  using (public.is_superadmin()) with check (public.is_superadmin());

-- rulebook 02: a schema change bumps the version in the same migration.
update public.config set schema_version = schema_version + 1, schema_updated_at = now();
