-- 023 - a tile knows whether anyone can actually do the job, and two new
-- packages: the garage heater and the sprinkler blow-out.
--
-- WHY "COVERED" IS DERIVED AND NOT A COLUMN SOMEONE TICKS. The home screen
-- now dims a package nobody is approved to do. The temptation is a
-- hand-set is_bookable flag, and it would be wrong within a week: the answer
-- changes every time a contractor is approved, and a flag would have to be
-- remembered. So covered is computed, and computed with EXACTLY the predicate
-- homeowner_post_internal uses to pick who gets the offer:
--
--     an approved contractor, with an active app_users row, whose contact OR
--     company carries the package's trade
--
-- Any other test would let a tile promise something the offer would not
-- deliver. When the two agree, a live tile means the offer reaches someone
-- and a dim tile means it would reach nobody - which is the whole point.
--
-- Two trades, not one, because contact_trade_roles and company_trade_roles
-- are both real: a one-man shop carries trades on the contact, a company
-- carries them on the company, and the offer loop already reads both.

-- ---------------------------------------------------------------------------
-- The garage heater. Named by Shahar alongside the generator and the EV
-- charger, and it belongs with them: a fixed, mechanical install that has a
-- number before anyone visits. HVAC, so it is one of the two trades an
-- approved contractor actually covers today.
insert into public.blueprint_packages (
  code, name, tile_title, tile_line2, trade, tile_group, category, availability,
  base_price_cents, config_label, requires_permit, permit_deposit_pct, instant_book,
  approval_note, illustration, description, sort_order, is_active, created_by
) values (
  'garage_heater',
  'Garage heater install',
  'Garage heater',
  'install',
  'HVAC',
  'front',
  'systems',
  'priced',
  265000,
  '45,000 BTU gas unit heater, 2-car garage, gas line already within 15 ft',
  false, null, true, null,
  'garage_heater',
  'A ceiling-hung gas unit heater turns the garage into a room you can use in January - the workshop, the gym, the place the car does not freeze. Mounted, vented, wired to a thermostat on the wall, and the gas line run from the nearest tie-in. Two to four hours for most garages.',
  75, true, 'claude:home-owner-flows'
)
on conflict (code) do update set
  name = excluded.name, tile_title = excluded.tile_title, tile_line2 = excluded.tile_line2,
  trade = excluded.trade, category = excluded.category, availability = excluded.availability,
  base_price_cents = excluded.base_price_cents, config_label = excluded.config_label,
  instant_book = excluded.instant_book, illustration = excluded.illustration,
  description = excluded.description, sort_order = excluded.sort_order, is_active = true;

-- The sprinkler blow-out. October and November only - it is the one job with
-- a hard deadline in it, because the freeze does not wait.
insert into public.blueprint_packages (
  code, name, tile_title, tile_line2, trade, tile_group, category, availability,
  base_price_cents, config_label, requires_permit, permit_deposit_pct, instant_book,
  approval_note, illustration, description, sort_order, is_active, season_months, created_by
) values (
  'sprinklers',
  'Sprinkler winterization',
  'Sprinklers',
  'winterize',
  'Irrigation',
  'front',
  'upkeep',
  'priced',
  12000,
  'up to 6 zones, blown out with a compressor, backflow drained',
  false, null, true, null,
  'sprinklers',
  'Water left in the lines freezes, and a cracked backflow preventer or a split lateral costs many times what the blow-out does. A compressor clears every zone, the backflow is drained and the controller is shut down for the winter. Half an hour to an hour, and it has to happen before the first hard freeze.',
  76, true, array[10,11], 'claude:home-owner-flows'
)
on conflict (code) do update set
  name = excluded.name, tile_title = excluded.tile_title, tile_line2 = excluded.tile_line2,
  trade = excluded.trade, category = excluded.category, availability = excluded.availability,
  base_price_cents = excluded.base_price_cents, config_label = excluded.config_label,
  instant_book = excluded.instant_book, illustration = excluded.illustration,
  description = excluded.description, sort_order = excluded.sort_order,
  season_months = excluded.season_months, is_active = true;

delete from public.blueprint_package_items    where package_code in ('garage_heater','sprinklers');
delete from public.blueprint_package_photos   where package_code in ('garage_heater','sprinklers');
delete from public.blueprint_package_milestones where package_code in ('garage_heater','sprinklers');
delete from public.blueprint_package_lever_options
 where lever_id in (select id from public.blueprint_package_levers where package_code in ('garage_heater','sprinklers'));
delete from public.blueprint_package_levers   where package_code in ('garage_heater','sprinklers');

insert into public.blueprint_package_items (package_code, label, detail, sort_order) values
  ('garage_heater', 'Unit heater supplied and hung',        '45,000 BTU, natural gas', 10),
  ('garage_heater', 'Gas line run and tied in',             'up to 15 ft from the nearest tie-in', 20),
  ('garage_heater', 'Vented through the wall',              null, 30),
  ('garage_heater', 'Thermostat mounted and wired',         null, 40),
  ('garage_heater', 'Fired, tested and left running',       null, 50),
  ('garage_heater', 'Insurance coverage',                   null, 60),
  ('garage_heater', 'Warranty',                             '1 year labour, manufacturer on the unit', 70),
  ('sprinklers',    'Every zone blown out with a compressor', null, 10),
  ('sprinklers',    'Backflow preventer drained',           null, 20),
  ('sprinklers',    'Controller shut down for the season',  null, 30),
  ('sprinklers',    'Heads checked as the air goes through', 'anything broken is reported, not repaired', 40),
  ('sprinklers',    'Insurance coverage',                   null, 50);

with l as (
  insert into public.blueprint_package_levers (package_code, key, label, control, question, sort_order) values
    ('garage_heater', 'garage', 'Garage size',  'seg',   'How big is the garage?', 10),
    ('garage_heater', 'gasline','Gas line',     'radio', 'Is there a gas line within about 15 ft?', 20),
    ('sprinklers',    'zones',  'Zones',        'seg',   'How many zones does the system have?', 10)
  returning id, package_code, key
)
insert into public.blueprint_package_lever_options (lever_id, key, label, price_delta_cents, is_default, chip, sort_order)
select l.id, o.key, o.label, o.delta, o.is_default, o.chip, o.sort_order
from l join (values
  ('garage_heater','garage', '1',   '1-car',                          -40000, false, 'One car',   10),
  ('garage_heater','garage', '2',   '2-car',                               0, true,  'Two cars',  20),
  ('garage_heater','garage', '3',   '3-car or oversized',              55000, false, 'Three',     30),
  ('garage_heater','gasline','yes', 'Yes, within about 15 ft',             0, true,  'Gas is close', 10),
  ('garage_heater','gasline','no',  'No, it needs a longer run',       65000, false, 'Longer run',   20),
  ('sprinklers',   'zones',  '6',   'Up to 6',                             0, true,  'Up to 6',   10),
  ('sprinklers',   'zones',  '10',  '7 to 10',                          4000, false, '7-10',      20),
  ('sprinklers',   'zones',  '11',  '11 or more',                       9000, false, '11+',       30)
) as o(pkg, lever, key, label, delta, is_default, chip, sort_order)
  on o.pkg = l.package_code and o.lever = l.key;

insert into public.blueprint_package_photos (package_code, key, label, hint, sort_order) values
  ('garage_heater', 'garage',  'The garage, wide',      'Stand at the door. We need the ceiling height and where the walls are.', 10),
  ('garage_heater', 'gas',     'Nearest gas line',      'The meter, the furnace or wherever gas already runs. Skip if you cannot find it.', 20),
  ('sprinklers',    'backflow','The backflow preventer', 'Usually near the front of the house or in the basement.', 10);

insert into public.blueprint_package_milestones (package_code, key, kind, name, sequence_no, percent_of_contract, typical_range, trigger_description) values
  ('garage_heater', 'booked',    'booked',   'Booked',              1, null, null,          'You booked the package.'),
  ('garage_heater', 'accepted',  'accepted', 'Contractor accepted', 2, null, '24-48 h',     'An HVAC contractor took the job.'),
  ('garage_heater', 'installed', 'payment',  'Heater in and running',3, 100, '2-4 hours',   'Hung, vented, gas run, thermostat wired, fired and tested. Paid to the contractor on completion.'),
  ('garage_heater', 'done',      'done',     'Done',                4, null, null,          'Done.'),
  ('sprinklers',    'booked',    'booked',   'Booked',              1, null, null,          'You booked the package.'),
  ('sprinklers',    'accepted',  'accepted', 'Contractor accepted', 2, null, '24-48 h',     'An irrigation contractor took the job.'),
  ('sprinklers',    'blown',     'payment',  'System blown out',    3, 100, '30-60 minutes','Every zone cleared, backflow drained, controller off. Paid to the contractor on completion.'),
  ('sprinklers',    'done',      'done',     'Done',                4, null, null,          'Done.');

-- ---------------------------------------------------------------------------
-- Coverage. One helper so the tile grid, the package page and anything later
-- all ask the same question in the same words.
create or replace function public.homeowner_trade_covered(p_trade text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
      from public.contacts ct
      join public.app_users u on u.contact_id = ct.id and u.is_active
      join public.contractor_approvals ca on ca.contact_id = ct.id and ca.status = 'approved'
     where exists (select 1 from public.contact_trade_roles r where r.contact_id = ct.id and r.trade = p_trade)
        or exists (select 1 from public.company_trade_roles r where r.company_id = ct.company_id and r.trade = p_trade)
  );
$$;

comment on function public.homeowner_trade_covered(text) is
  'Is there anyone we could actually send this trade to? The SAME predicate homeowner_post_internal uses to choose who receives an offer - approved, with an active account, carrying the trade on the contact or the company. Keep the two in step: a tile that says bookable while the offer would reach nobody is the one lie this screen must not tell.';

revoke all on function public.homeowner_trade_covered(text) from public;
grant execute on function public.homeowner_trade_covered(text) to anon, authenticated, service_role;

-- The grid gains trade and covered. It stays anon-readable and cached: the
-- answer is the same for every visitor, and it changes when someone is
-- approved, not per request.
create or replace function public.homeowner_catalogue_tiles()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'code', p.code, 'tile_title', p.tile_title, 'tile_line2', p.tile_line2,
    'tile_group', p.tile_group, 'availability', p.availability,
    'illustration', p.illustration, 'sort_order', p.sort_order,
    'category', p.category, 'season_months', p.season_months,
    'trade', p.trade,
    'covered', public.homeowner_trade_covered(p.trade))
    order by p.sort_order, p.name), '[]'::jsonb)
  from public.blueprint_packages p
  where p.is_active;
$$;

revoke all on function public.homeowner_catalogue_tiles() from public;
grant execute on function public.homeowner_catalogue_tiles() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- "Tell me when someone covers this." The dim tile still opens, and its
-- turn-key button becomes this - which would be an empty promise if it went
-- nowhere, so it writes a task. Tasks live in actions (rulebook: one unified
-- list), assigned to Bobby, exactly where homeowner_quote_request puts its
-- own. Deduped: asking twice does not make two rows, it just tells you we
-- already have it.
create or replace function public.homeowner_notify_when_covered(p_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  me uuid := public.current_app_user_id();
  u public.app_users; pkg public.blueprint_packages;
  v_home uuid; v_persona uuid; v_id uuid;
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.'); end if;
  select * into pkg from public.blueprint_packages where code = p_code and is_active;
  if pkg.code is null then return jsonb_build_object('ok', false, 'reason', 'We do not have that package.'); end if;
  if public.homeowner_trade_covered(pkg.trade) then
    return jsonb_build_object('ok', true, 'already_covered', true);
  end if;

  select * into u from public.app_users where id = me;

  if exists (select 1 from public.actions a
              where a.source = 'homeowner_app_waitlist'
                and a.notes like '%[waitlist:' || p_code || ':' || me::text || ']%'
                and a.status not in ('Completed','Cancelled','Force Cancelled'))
  then
    return jsonb_build_object('ok', true, 'already_asked', true);
  end if;

  select p.id into v_home from public.projects p
   where p.id in (select public.homeowner_home_ids(me)) order by p.created_at limit 1;
  if v_home is null then select id into v_home from public.projects where project_name = 'Master Template' limit 1; end if;
  select id into v_persona from public.personas where name = 'Bobby';

  insert into public.actions (action, domain, status, priority, project_id, source, created_by,
                              assigned_to, assigned_to_persona_id, depth_level, notes, desired_outcome)
  values ('Waiting on a ' || pkg.trade || ' contractor: ' || pkg.name || ' for ' || coalesce(u.full_name, u.email, 'a member'),
          'construction', 'Not Started', 'Medium', v_home, 'homeowner_app_waitlist', 'homeowner-app',
          'Bobby', v_persona, 2,
          'A member opened ' || pkg.name || ' and asked to be told when we can do it. Nobody approved carries ' ||
          pkg.trade || ' yet, so the tile is dim and no offer would reach anyone.' ||
          E'\nMember: ' || coalesce(u.full_name, '?') || ' <' || coalesce(u.email, '?') || '>' ||
          coalesce(' - ZIP ' || u.home_zip, '') ||
          E'\n\nThis row is the demand signal for recruiting: count them by trade before deciding who to go after next.' ||
          E'\n[waitlist:' || p_code || ':' || me::text || ']',
          'A ' || pkg.trade || ' contractor is approved, and this member is told the day it happens.')
  returning id into v_id;

  return jsonb_build_object('ok', true, 'action_id', v_id);
end $$;

revoke all on function public.homeowner_notify_when_covered(text) from public, anon;
grant execute on function public.homeowner_notify_when_covered(text) to authenticated, service_role;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
