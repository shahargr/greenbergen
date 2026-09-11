-- 067 - a package page tells the story before it shows the price.
--
-- Shahar (2026-09-11), with a link to starlink.com: "when we land on a
-- package, this should be the package page setup. build this page as a
-- template for packages, starting with Generator, EV Charger, Water heater."
--
-- The shape that page has, and that ours now takes: a full-bleed hero with
-- the name, one promise and the price; then a run of blocks that each make
-- ONE claim in a headline and a sentence or two; then the specifics (what is
-- included, what you buy); then the price and the configurator; then the
-- questions people actually ask; then the order button again. The order
-- button is never more than a thumb away the whole way down.
--
-- Everything on that page except the claims and the questions already exists
-- in the catalogue. This adds the two that did not:
--
--   claim - a headline and a line or two. The middle of the page.
--   faq   - a question and its answer. The end of it.
--
-- One table, because they are the same shape and they interleave in one
-- ordered list per package. Content, not structure: a package with no rows
-- renders the same page with those bands missing, which is what every other
-- package does until someone writes them.
create table if not exists public.blueprint_package_sections (
  id            uuid primary key default gen_random_uuid(),
  package_code  text not null references public.blueprint_packages(code) on update cascade on delete cascade,
  kind          text not null check (kind in ('claim', 'faq')),
  headline      text not null,
  body          text,
  image_url     text,
  sort_order    int  not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  created_by    text,
  last_modified_at timestamptz,
  last_modified_by text
);
create index if not exists idx_package_sections_code on public.blueprint_package_sections (package_code, kind, sort_order);

alter table public.blueprint_package_sections enable row level security;
drop policy if exists blueprint_package_sections_read on public.blueprint_package_sections;
drop policy if exists blueprint_package_sections_admin on public.blueprint_package_sections;
-- Same as the rest of the catalogue: everyone signed in reads it, only a
-- superadmin writes it, and the page itself reads through the definer
-- function below, which is what serves a visitor with no session at all.
create policy blueprint_package_sections_read on public.blueprint_package_sections
  for select to authenticated using (true);
create policy blueprint_package_sections_admin on public.blueprint_package_sections
  for all to authenticated using (public.is_superadmin()) with check (public.is_superadmin());

-- ---------------------------------------------------------------------------
-- THE CONTENT, for the three Shahar named. Every line is checked against what
-- the package actually sells: the scope lines, the levers and their prices,
-- and the hardware rows. Nothing here promises a timeline we do not control
-- or a number the configurator would contradict.
delete from public.blueprint_package_sections where package_code in ('generator', 'ev_charger', 'water_heater');

insert into public.blueprint_package_sections (package_code, kind, headline, body, sort_order, created_by) values

-- ---- Standby generator --------------------------------------------------
('generator', 'claim', 'The lights come back on without you',
 'The transfer switch watches the street. When the power drops it starts the generator and moves the house over to it, then moves it back when the utility returns. Nothing to wheel out, nothing to start, no cords through a window.', 10, 'migration:067'),
('generator', 'claim', 'One price, published, the same for everyone',
 'Community price. It covers the pad, the generator set and connected, the gas line from your meter, the automatic transfer switch, the start-up and load test, and the town permits from filing to closing. No quote visit to sit through, no number that moves depending on who is asking.', 20, 'migration:067'),
('generator', 'claim', 'You buy the machine. We tell you which one.',
 'The generator is yours to order and have delivered, which is why the install price is what it is. Our contractors install the Generac Guardian 22 kW most often and the transfer switch comes in its box. Order it to the house before the crew comes.', 30, 'migration:067'),
('generator', 'claim', 'Three permits, none of them yours',
 'Electrical, plumbing and zoning. The contractor files them, meets the inspectors and closes them out. You sign the papers once, in person.', 40, 'migration:067'),
('generator', 'faq', 'What size do I need?',
 '22 kW runs a whole house and is what most people here take. 14 kW covers the essentials - heat, the fridge, some lights, a few outlets. 26 kW is for a large home. All three are the same install price, so the choice is about the machine you buy, not about us.', 100, 'migration:067'),
('generator', 'faq', 'What if I am on propane rather than natural gas?',
 'Propane adds $1,200 to the install. Say so in Refine scope and the price updates before you order anything.', 110, 'migration:067'),
('generator', 'faq', 'How far can the generator be from the gas meter?',
 'Up to 25 feet is in the price. Further than that is still doable - the photo of your meter tells the contractor before they ever come out, and anything beyond the standard run is agreed with you first.', 120, 'migration:067'),
('generator', 'faq', 'Do I need a concrete pad poured?',
 'No. The composite pad our contractors use sets level on grade, so there is no pour and no cure time. If you already have a pad, they set it on yours.', 130, 'migration:067'),
('generator', 'faq', 'How long does the whole thing take?',
 'Matching a contractor usually takes a day or two. Permits take a few weeks, and that part is the town''s clock, not ours. The install itself is a short job once the permits are in hand.', 140, 'migration:067'),

-- ---- EV charger ---------------------------------------------------------
('ev_charger', 'claim', 'Leave in the morning full, every morning',
 'A dedicated 240 volt circuit from your panel to a Level 2 charger where you park. Overnight is enough for a normal day of driving, and you stop planning your week around a public plug.', 10, 'migration:067'),
('ev_charger', 'claim', 'One price, published, the same for everyone',
 'Community price. It covers the town electrical permit, a new 50 amp breaker and dedicated circuit, mounting and wiring your charger, testing, and the inspection that closes the permit out.', 20, 'migration:067'),
('ev_charger', 'claim', 'Bring your own charger, or have one brought',
 'Most people already have the unit that came with the car or the one they picked. If you would rather not think about it, the contractor supplies one for $600 more.', 30, 'migration:067'),
('ev_charger', 'claim', 'Permitted and inspected, not just wired',
 'An EV charger is a permitted job in this town. The contractor files it, the inspector signs it off, and the permit is closed - which is the part that matters when you sell the house.', 40, 'migration:067'),
('ev_charger', 'faq', 'How do I know how far my panel is from the car?',
 'Pace it out roughly. Under 25 feet is the price as shown; 25 to 60 feet adds $450 and over 60 feet adds $950, because it is more wire and more labour. The photos you send of the panel and the parking spot settle it before anyone is booked.', 100, 'migration:067'),
('ev_charger', 'faq', 'Does my panel have enough capacity?',
 'That is what the photo of your panel is for. The electrician reads the amperage off it before accepting the job, so you are told early rather than on the day.', 110, 'migration:067'),
('ev_charger', 'faq', 'Which charger should I buy?',
 'Any Level 2 unit works. Our contractors see the VEVOR Level 2, 40 amp, 25 foot cable with a NEMA 14-50 plug most often, and it is the one the basic setup assumes. A different brand changes nothing about the install.', 120, 'migration:067'),
('ev_charger', 'faq', 'Can it go outside?',
 'Yes, on a wall or a post, as long as the unit is rated for outdoors - most are. Put the parking spot in the photo and the contractor will tell you where it should sit.', 130, 'migration:067'),

-- ---- Water heater -------------------------------------------------------
('water_heater', 'claim', 'Hot water back the same day it goes',
 'A like-for-like replacement: the old unit decommissioned and hauled away, the new one in, tested, and the permit filed and closed by the contractor.', 10, 'migration:067'),
('water_heater', 'claim', 'One price, published, the same for everyone',
 'Community price. Permits, removal, disposal, the install, testing and the inspection are all in it. Nobody arrives to look at your basement and then invent a number.', 20, 'migration:067'),
('water_heater', 'claim', 'Sized by how many people live here',
 'Not by guesswork. One or two people take a 40 gallon tank; three or four take 50; five or more take 75. Pick the household and the price moves with it.', 30, 'migration:067'),
('water_heater', 'claim', 'The old one leaves with them',
 'Haul-away and disposal are part of the job. Nothing rusting in the driveway waiting for a trip to the dump.', 40, 'migration:067'),
('water_heater', 'faq', 'Is mine gas or electric?',
 'Look at the top. A metal flue pipe running out of it means gas. No pipe means electric, which is $120 less. If you are not sure, the photo of the unit tells the plumber.', 100, 'migration:067'),
('water_heater', 'faq', 'Should I go tankless?',
 'You can. It is $1,450 more and it changes the venting and the gas line, which is why it costs what it does. It pays back in space and in never running out; it does not pay back quickly in money.', 110, 'migration:067'),
('water_heater', 'faq', 'Can I move it somewhere else while we are at it?',
 'Yes - moving it is $650, because it means new lines, new venting and a new drain path. Leaving it where it stands is the price as shown.', 120, 'migration:067'),
('water_heater', 'faq', 'Mine is in a crawlspace. Does that matter?',
 'It does, and it is priced honestly: tight access adds $180. Step back far enough in the second photo that the walls, the pipes and any stairs are in frame.', 130, 'migration:067'),
('water_heater', 'faq', 'What if mine is leaking right now?',
 'Order it anyway and say so in the note. A tank that is actively leaking is the one case where the matching moves fast - the contractors on this side are local, and the job is a day.', 140, 'migration:067');

-- ---------------------------------------------------------------------------
-- The package page reads one function, so the sections belong in it.
CREATE OR REPLACE FUNCTION public.homeowner_package(p_code text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'code', p.code, 'name', p.name, 'tile_title', p.tile_title, 'tile_line2', p.tile_line2,
    'trade', p.trade, 'tile_group', p.tile_group, 'availability', p.availability,
    'base_price_cents', p.base_price_cents, 'config_label', p.config_label,
    'requires_permit', p.requires_permit, 'permit_deposit_pct', p.permit_deposit_pct,
    'instant_book', p.instant_book, 'approval_note', p.approval_note,
    'illustration', p.illustration, 'description', p.description, 'sort_order', p.sort_order,
    'photo_url', p.photo_url, 'promote', p.promote,
    'items', coalesce((select jsonb_agg(jsonb_build_object('label', i.label, 'detail', i.detail, 'kind', i.kind, 'links', i.links) order by i.sort_order)
                         from public.blueprint_package_items i where i.package_code = p.code), '[]'::jsonb),
    'levers', coalesce((select jsonb_agg(jsonb_build_object(
                 'key', l.key, 'label', l.label, 'control', l.control, 'question', l.question,
                 'options', coalesce((select jsonb_agg(jsonb_build_object(
                     'key', o.key, 'label', o.label, 'price_delta_cents', o.price_delta_cents,
                     'is_default', o.is_default, 'chip', o.chip) order by o.sort_order)
                   from public.blueprint_package_lever_options o where o.lever_id = l.id), '[]'::jsonb))
                 order by l.sort_order)
               from public.blueprint_package_levers l where l.package_code = p.code), '[]'::jsonb),
    'photos', coalesce((select jsonb_agg(jsonb_build_object('key', ph.key, 'label', ph.label, 'hint', ph.hint) order by ph.sort_order)
                         from public.blueprint_package_photos ph where ph.package_code = p.code), '[]'::jsonb),
    'milestones', coalesce((select jsonb_agg(jsonb_build_object(
                 'key', m.key, 'kind', m.kind, 'name', m.name, 'sequence_no', m.sequence_no,
                 'percent_of_contract', m.percent_of_contract, 'typical_range', m.typical_range,
                 'trigger_description', m.trigger_description) order by m.sequence_no)
               from public.blueprint_package_milestones m where m.package_code = p.code), '[]'::jsonb),
    'videos', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'label', v.label, 'url', v.url) order by v.sort_order, v.created_at)
                         from public.blueprint_package_videos v where v.package_code = p.code and v.is_active), '[]'::jsonb),
    -- The page's middle and end (migration 067). Empty is a fine answer: the
    -- template simply has no claim bands and no questions for that package.
    'sections', coalesce((select jsonb_agg(jsonb_build_object(
                 'kind', s.kind, 'headline', s.headline, 'body', s.body, 'image_url', s.image_url)
                 order by s.sort_order)
               from public.blueprint_package_sections s
              where s.package_code = p.code and s.is_active), '[]'::jsonb))
  from public.blueprint_packages p
  where p.code = p_code and p.is_active;
$function$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
