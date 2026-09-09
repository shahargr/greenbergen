-- 025 - the front row is six, and one of them is the general contractor.
--
-- Shahar named the set for "Ready to take on a new project?": EV charger,
-- standby generator, water heater, garage heater, internet & TV, and a
-- general contractor. Five of the six already existed. tile_group was stale -
-- ten packages carried 'front' - so it is reset to exactly his six.
--
-- WHAT tile_group MEANS NOW. The home screen used to sort by it; since the
-- catalogue became one list it sorts by coverage and then by sort_order, and
-- tile_group had no reader left. This gives it back a job, and a narrower
-- one: front is the HEADLINE SET - what we lead with, chosen by us. It is not
-- "what is bookable" (homeowner_trade_covered answers that, from live data)
-- and not "what is popular" (nothing measures that yet). Two different
-- questions, two different answers, and the screen shows both: the six lead,
-- and each still carries its own live-or-dim state honestly.
--
-- THE GENERAL CONTRACTOR TILE is the quote track, not a fixed price - the
-- same shape as kitchen and bathroom, which stay as their own tiles because
-- people look for them by name. It is the one trade an approved contractor
-- actually carries today, so it is also the one tile in the six that is live.

insert into public.blueprint_packages (
  code, name, tile_title, tile_line2, trade, tile_group, category, availability,
  base_price_cents, config_label, requires_permit, permit_deposit_pct, instant_book,
  approval_note, illustration, description, sort_order, is_active, created_by
) values (
  'general_contractor',
  'General contractor',
  'General',
  'contractor',
  'General Contractor',
  'front',
  'inside',
  'quote',
  null,
  'a person comes and looks',
  false, null, false,
  'Bigger work does not have one number, and pretending otherwise is how people get surprised. A GC comes, looks, and comes back with a scope and a price you can hold them to.',
  'general_contractor',
  'A kitchen, a bathroom, a finished basement, an addition, or the pile of jobs that only make sense done together - work that needs one person holding the whole thing rather than four trades booked separately. Tell us in a sentence what you have in mind and a general contractor comes back to you with a scope and a price. Nothing is charged for the conversation.',
  6, true, 'claude:home-owner-flows'
)
on conflict (code) do update set
  name = excluded.name, tile_title = excluded.tile_title, tile_line2 = excluded.tile_line2,
  trade = excluded.trade, tile_group = excluded.tile_group, category = excluded.category,
  availability = excluded.availability, approval_note = excluded.approval_note,
  config_label = excluded.config_label, illustration = excluded.illustration,
  description = excluded.description, sort_order = excluded.sort_order, is_active = true;

-- Everything that used to be front steps back first, then the six take it.
-- Two statements rather than one clever one: an UPDATE ... FROM whose join
-- matches a row more than once picks a winner non-deterministically, and
-- "which six lead the catalogue" is not a thing to leave to chance.
update public.blueprint_packages
   set tile_group = 'more', last_modified_by = 'claude:home-owner-flows'
 where tile_group = 'front';

-- sort_order 1-6 so the headline set sorts ahead of the whole catalogue
-- without renumbering everything underneath it. The order is the order
-- Shahar said them in.
update public.blueprint_packages p
   set tile_group = 'front', sort_order = v.ord, last_modified_by = 'claude:home-owner-flows'
  from (values
          ('ev_charger', 1), ('generator', 2), ('water_heater', 3),
          ('garage_heater', 4), ('internet_tv', 5), ('general_contractor', 6)
       ) as v(code, ord)
 where v.code = p.code;

comment on column public.blueprint_packages.tile_group is
  'front = the headline set the home screen leads with, chosen by us; more = the rest of the catalogue. It is NOT a bookability signal - homeowner_trade_covered answers that from live approvals, and a front tile is dimmed like any other when nobody covers its trade.';

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
