-- ============================================================================
-- Homeowner app, part 1 of 3: SCHEMA (schema_version 216 -> 217)
--
-- Additive only. Six blueprint_ tables (the package catalogue - templates,
-- rulebook 31), one project_ instance table (a booking), and two columns.
-- Nothing existing is altered in meaning. Apply with 002 (seed) and 003
-- (functions) in the same sitting; 003 grants the function surface.
--
-- WHY NEW TABLES AND NOT promotions / bid_packages / blueprint_trade
-- (rulebook 30, search before you create):
--   promotions      = a neighbourhood GROUP offer with signups and dates.
--                     A package is an always-on, pre-priced scope with levers.
--   bid_packages    = one scope put out to bid on ONE project. Reused as-is
--                     for the OFFER a booking makes to contractors (below).
--   blueprint_trade = what a trade delivers across a whole house, copied
--                     into project_scope_items. A package is a consumer
--                     product (name, tile, price, photos, milestones) whose
--                     scope lines are copied into project_scope_items the
--                     same way - the template sits one level above.
-- ============================================================================
begin;

-- ---------------------------------------------------------------- catalogue
create table public.blueprint_packages (
  code               text primary key,
  name               text not null,
  tile_title         text not null,
  tile_line2         text,
  trade              text references public.trades(trade),
  tile_group         text not null default 'front'
                     constraint chk_blueprint_packages_group check (tile_group in ('front','more')),
  availability       text not null default 'priced'
                     constraint chk_blueprint_packages_availability check (availability in ('priced','coming_soon','quote','custom')),
  base_price_cents   integer constraint chk_blueprint_packages_price check (base_price_cents is null or base_price_cents >= 0),
  config_label       text,
  requires_permit    boolean not null default false,
  permit_deposit_pct numeric constraint chk_blueprint_packages_deposit check (permit_deposit_pct is null or (permit_deposit_pct >= 0 and permit_deposit_pct <= 100)),
  instant_book       boolean not null default true,
  approval_note      text,
  illustration       text,
  description        text,
  sort_order         integer not null default 100,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  created_by         text,
  last_modified_at   timestamptz,
  last_modified_by   text,
  constraint chk_blueprint_packages_priced_has_price check (availability <> 'priced' or base_price_cents is not null)
);
comment on table public.blueprint_packages is
'THE PACKAGE CATALOGUE of the homeowner app (v217, 2026-09-07): one row per pre-priced, pre-negotiated home-improvement package - "Water heater replacement", "EV charger install". blueprint_ prefix per rulebook 31: a TEMPLATE, project-independent, the same for every house in Bergen. WHY NOT promotions: a promotion is a neighbourhood group offer with signups, dates and clusters; a package is always on and booked one house at a time. WHY NOT blueprint_trade: that is what a trade delivers across a whole house, for builders; a package is a consumer product - tile, illustration, ONE price for the most common configuration, levers that move it, the photos we need before a contractor can confirm, and the milestone line the job will run on. Its scope lines (blueprint_package_items) are copied into project_scope_items at booking exactly as blueprint_trade rows are (rulebook 41: copy down, do not link). base_price_cents is the community price of config_label; the formula behind it (base + option deltas) is NEVER shown to a homeowner - people compare a number, not a rate card. availability: priced = tile opens a package page; coming_soon = greyed, unclickable, taps are demand data; quote = routes to the get-a-quote track (kitchen, bath); custom = the "something else" escape hatch. instant_book false = the booking is HELD for a contractor to confirm a measurement first (driveway area). Read through homeowner_catalogue(); never edit the list inside a function (rulebook 34).';
comment on column public.blueprint_packages.base_price_cents is 'Community price of the most common configuration (config_label), in CENTS. Every price the app shows carries the same label: Estimate pending contractor confirmation.';
comment on column public.blueprint_packages.instant_book is 'true: the job goes to contractors the moment it is booked. false: held for contractor approval (a measurement must be confirmed first); the homeowner approves any change.';
comment on column public.blueprint_packages.illustration is 'Key of the line illustration the app draws for this package (illustrations, never photos).';

create table public.blueprint_package_items (
  id           uuid primary key default gen_random_uuid(),
  package_code text not null references public.blueprint_packages(code) on delete cascade,
  label        text not null,
  detail       text,
  sort_order   integer not null default 100
);
comment on table public.blueprint_package_items is
'The SCOPE of a package, one included service per row, listed plainly on the package page above the price ("Town permits - filed by the contractor", "Warranty" named only, no terms). Copied into project_scope_items at booking (origin blueprint copy, authority unassigned, audience both) so the job owns its scope text from that moment - rulebook 41. Separate from blueprint_package_levers because a scope line is included regardless of configuration; a lever changes the price, not the list.';

create table public.blueprint_package_levers (
  id           uuid primary key default gen_random_uuid(),
  package_code text not null references public.blueprint_packages(code) on delete cascade,
  key          text not null,
  label        text not null,
  control      text not null default 'seg' constraint chk_blueprint_package_levers_control check (control in ('seg','radio')),
  question     text,
  sort_order   integer not null default 100,
  unique (package_code, key)
);
comment on table public.blueprint_package_levers is
'The LEVERS of a package - the few things a homeowner can adjust (tank size, fuel, location, access). One row per lever; its choices live in blueprint_package_lever_options. question is the same lever asked conversationally by the Adjust panel''s chat tab: a fixed question set per package, a smart form that talks, not an open chatbot. control is how the levers tab draws it (segmented control or radio group).';

create table public.blueprint_package_lever_options (
  id                uuid primary key default gen_random_uuid(),
  lever_id          uuid not null references public.blueprint_package_levers(id) on delete cascade,
  key               text not null,
  label             text not null,
  price_delta_cents integer not null default 0,
  is_default        boolean not null default false,
  chip              text,
  sort_order        integer not null default 100,
  unique (lever_id, key)
);
comment on table public.blueprint_package_lever_options is
'One choice of one lever with the price it adds or removes, in cents. The package price is base_price_cents plus the chosen deltas - computed by homeowner_book() on the server, never trusted from the browser. Exactly one option per lever should be is_default (the most common configuration the base price describes). chip is the short quick-reply the chat tab offers for this option.';

create table public.blueprint_package_photos (
  id           uuid primary key default gen_random_uuid(),
  package_code text not null references public.blueprint_packages(code) on delete cascade,
  key          text not null,
  label        text not null,
  hint         text,
  sort_order   integer not null default 100,
  unique (package_code, key)
);
comment on table public.blueprint_package_photos is
'The PHOTO GATE of a package: the set of pictures a homeowner takes before booking, one row each (water heater: the unit and the space around it; generator: panel, gas meter, proposed spot). The answer to "I don''t know my panel''s amperage" is "photograph it" - the contractor reads it off the photo. The photos land in the job folder as files + file_links (project-media, path under the job project id).';

create table public.blueprint_package_milestones (
  id                  uuid primary key default gen_random_uuid(),
  package_code        text not null references public.blueprint_packages(code) on delete cascade,
  key                 text not null,
  kind                text not null constraint chk_blueprint_package_milestones_kind check (kind in ('booked','accepted','payment','task','done')),
  name                text not null,
  sequence_no         integer not null,
  percent_of_contract numeric constraint chk_blueprint_package_milestones_pct check (percent_of_contract is null or (percent_of_contract > 0 and percent_of_contract <= 100)),
  typical_range       text,
  trigger_description text,
  unique (package_code, key),
  unique (package_code, sequence_no)
);
comment on table public.blueprint_package_milestones is
'The PROGRESS LINE of a package - the milestones a job of this kind runs through, generated per package, not fixed (permit packages: Booked, Accepted, Permit meeting (10% due), Permit issued, Work done, Inspection passed, Done; non-permit: Booked, Accepted, Work done, Done). kind says what each node IS in data, so progress is DERIVED and never a hand-moved stage field (rulebook 34): booked = project_bookings.posted_at; accepted = the contract exists; payment = a payment_stages row created at booking, done when it is paid or approved; task = an actions row created at booking, done when close_action closes it; done = the project is Closed - Completed (which the close gate only allows with zero open tasks). typical_range is shown as a projection ("permit: typically 2-4 weeks") until real data tightens it.';

-- ---------------------------------------------------------------- instance
create table public.project_bookings (
  id                     uuid primary key default gen_random_uuid(),
  project_id             uuid not null unique references public.projects(id) on delete cascade,
  home_project_id        uuid not null references public.projects(id),
  package_code           text not null references public.blueprint_packages(code),
  price_cents            integer not null constraint chk_project_bookings_price check (price_cents >= 0),
  base_price_cents       integer not null,
  selections             jsonb not null default '{}'::jsonb,
  config_label           text,
  unit                   text,
  facts                  jsonb,
  budget_band            text,
  note                   text,
  state                  text not null default 'posted' constraint chk_project_bookings_state check (state in ('planned','posted','accepted','closed','done')),
  created_at             timestamptz not null default now(),
  posted_at              timestamptz,
  target_window          text constraint chk_project_bookings_target_window check (target_window is null or target_window in ('asap','1_3_months','3_6_months','this_year','someday')),
  reply_by               timestamptz,
  repost_count           integer not null default 0,
  bid_package_id         uuid references public.bid_packages(id),
  offered_count          integer not null default 0,
  contract_id            uuid references public.contracts(id),
  contractor_contact_id  uuid references public.contacts(id),
  accepted_at            timestamptz,
  closed_at              timestamptz,
  close_reason           text,
  done_at                timestamptz,
  share_slug             text unique,
  shared_at              timestamptz,
  share_quote            text,
  share_hide_address     boolean not null default true,
  share_after_file_id    uuid references public.files(id) on delete set null,
  created_by             text,
  last_modified_at       timestamptz,
  constraint chk_project_bookings_posted check ((state = 'planned') = (posted_at is null))
);
comment on table public.project_bookings is
'A HOMEOWNER''S BOOKING of one package on one home (v217): the instance half of blueprint_packages, one row per job project. WHY A ROW OF ITS OWN when the job already has a projects row, a bid_packages offer, payment_stages and a contract: this is the one place that holds what the HOMEOWNER chose and the matching clock - the package, the levers they picked (selections) and the price they were quoted, the property facts they confirmed, the budget band, the 24-hour window (reply_by) and how many contractors were offered the job. Everything else stays where it belongs: the work is the project (a CHILD of the home container, so membership inherits through project_ancestry()), the offer is a bid_packages row with one invited bids row per contractor, the award is a contracts row plus a bounded project_members seat, the money is payment_stages, the photos are files + file_links, the conversation is messages. state: planned (the owner wants it done some day and has NOT ordered it - no offer, no stages, no tasks, no contractor; posted_at is null and target_window says roughly when), posted (out to contractors), accepted (a contractor took it), closed (nobody did and the owner let it go, or they cancelled), done (project closed complete). A plan becomes an order through homeowner_booking_action(''post''), which re-prices from the live catalogue and runs the same posting as a fresh booking. No-taker is DERIVED: state posted and reply_by < now(). budget_band is NEVER returned by any function a contractor can call - it exists to suggest a smarter approach to the owner and never changes the price. share_slug + shared_at make the finished job a public card (homeowner_share) that carries the owner''s invite; the card never shows the street address unless share_hide_address is false, and never shows photos publicly (project-media is private).';
comment on column public.project_bookings.budget_band is 'Optional, asked AFTER scoping. Owner-only: never shown to contractors, never changes the price.';
comment on column public.project_bookings.facts is 'What the owner confirmed about the home at booking: {sqft, year_built, beds, baths, source}. A snapshot for this job; a later pass may promote it to the home asset.';
comment on column public.project_bookings.target_window is 'For a PLANNED booking only: when the owner has in mind - asap, 1_3_months, 3_6_months, this_year, someday. Never a date the contractor is held to; it orders the owner''s own list and lets Green Bergen nudge at the right time.';
comment on column public.project_bookings.reply_by is 'The matching window. Contractors accept at the stated price or pass; when this passes with no contract the owner is offered a higher price (repost) or a graceful close.';

alter table public.messages add column file_id uuid references public.files(id) on delete set null;
comment on column public.messages.file_id is 'v217: the one attachment a timeline message carries (a photo or a voice note), already recorded in files + file_links against the project so it lands in the job folder too. One per message on purpose - the composer sends one thing at a time.';

alter table public.app_users add column home_zip text;
comment on column public.app_users.home_zip is 'v217: the ZIP code given at homeowner-app registration (three fields: name, email, ZIP). Bergen-only at launch; the town is derived from it into home_town.';

-- ---------------------------------------------------------------- hygiene
create trigger trg_log_blueprint_packages after insert or delete or update on public.blueprint_packages for each row execute function public.fn_log_change('code');
create trigger trg_log_project_bookings   after insert or delete or update on public.project_bookings   for each row execute function public.fn_log_change('id');
create trigger trg_project_bookings_modified before update on public.project_bookings for each row execute function public.set_last_modified_at();

create index idx_project_bookings_home on public.project_bookings (home_project_id);
create index idx_project_bookings_state on public.project_bookings (state, reply_by);

-- ---------------------------------------------------------------- RLS
-- Templates: readable by every signed-in user (rulebook 70: the blueprint
-- family IS the product), writable by superadmin only. anon reads them
-- through homeowner_catalogue() - a deliberate anon function (003).
alter table public.blueprint_packages              enable row level security;
alter table public.blueprint_package_items         enable row level security;
alter table public.blueprint_package_levers        enable row level security;
alter table public.blueprint_package_lever_options enable row level security;
alter table public.blueprint_package_photos        enable row level security;
alter table public.blueprint_package_milestones    enable row level security;
alter table public.project_bookings                enable row level security;

create policy blueprint_packages_read on public.blueprint_packages for select to authenticated using (true);
create policy blueprint_packages_admin on public.blueprint_packages for all to authenticated using (public.is_superadmin()) with check (public.is_superadmin());
create policy blueprint_package_items_read on public.blueprint_package_items for select to authenticated using (true);
create policy blueprint_package_items_admin on public.blueprint_package_items for all to authenticated using (public.is_superadmin()) with check (public.is_superadmin());
create policy blueprint_package_levers_read on public.blueprint_package_levers for select to authenticated using (true);
create policy blueprint_package_levers_admin on public.blueprint_package_levers for all to authenticated using (public.is_superadmin()) with check (public.is_superadmin());
create policy blueprint_package_lever_options_read on public.blueprint_package_lever_options for select to authenticated using (true);
create policy blueprint_package_lever_options_admin on public.blueprint_package_lever_options for all to authenticated using (public.is_superadmin()) with check (public.is_superadmin());
create policy blueprint_package_photos_read on public.blueprint_package_photos for select to authenticated using (true);
create policy blueprint_package_photos_admin on public.blueprint_package_photos for all to authenticated using (public.is_superadmin()) with check (public.is_superadmin());
create policy blueprint_package_milestones_read on public.blueprint_package_milestones for select to authenticated using (true);
create policy blueprint_package_milestones_admin on public.blueprint_package_milestones for all to authenticated using (public.is_superadmin()) with check (public.is_superadmin());

-- A booking is visible to the job's members (the owner, and the contractor
-- once seated). All writes go through the homeowner_* functions.
create policy project_bookings_member_read on public.project_bookings for select to authenticated using (public.is_project_member(project_id));

-- ---------------------------------------------------------------- record
update public.config
   set schema_version = 217,
       schema_updated_at = current_date,
       release_notes = 'v217 (2026-09-07): homeowner app - blueprint_packages catalogue (items, levers, options, photos, milestones), project_bookings, messages.file_id, app_users.home_zip; homeowner_* function surface.';

insert into public.help (doc_type, topic, title, content, applies_to, sort_order, created_by)
values ('how_to', 'homeowner_app',
  'Homeowner app (apps/homeowner) - packages, bookings and the matching clock: what hangs where',
  'BUILT 2026-09-07 (v217). A second Next.js app in the same repo (apps/homeowner, its own Vercel project, root directory apps/homeowner) for homeowners and residents who want something fixed: pick a pre-priced package, add the address and two photos, book. Same database, same auth, no service key.

THE CATALOGUE is blueprint_packages plus its five children (items = scope lines, levers + lever_options = what moves the price, photos = the per-package photo gate, milestones = the progress line). Read by homeowner_catalogue(), which anon may call so the grid can be browsed before joining. Adding a package is an INSERT; retiring one is is_active = false. The app ships the same launch set as JSON (src/lib/catalogue.data.json) and db/gen-seed.mjs regenerates 002_homeowner_seed.sql from it - edit the JSON, regenerate, apply; never hand-edit both.

A PLAN (homeowner_book with p_mode = plan) writes only the home container if needed, the child project and the scope, and a project_bookings row in state planned (target_window, no posted_at). Nothing goes to contractors until the owner posts it (homeowner_booking_action post), which re-prices from the live catalogue and then does everything a booking does. A plan can be removed (homeowner_booking_action remove) - the child project is trashed, never deleted.
HOMES. homeowner_me() returns homes[] (every container the member owns, with live / planned / done counts) and home_quota {allowed, have, can_add} from the live customer agreement, so the booking wizard can ask WHICH HOME before the address, and the My home screen can list them. homeowner_book takes p_home_project_id for a chosen home; homeowner_home_add(address) claims another home without ordering anything (create_home_asset under the same quota).
A BOOKING (homeowner_book) writes: the home container if the owner has none yet (create_home_asset, governed by the customer agreement); a CHILD project for the job; project_scope_items copied from the package items (rulebook 41); one payment_stages row per money milestone (percent of contract, amount from the quoted price); one actions row per hand-marked milestone (permit issued, inspection passed; created_by system:package-blueprint); a project_billing_plan mirrored from the home so stage_payment_quote can price a milestone on the child; a bid_packages OFFER with one invited bids row per contractor who has a login and the package trade in contact_trade_roles; and the project_bookings row itself with the selections, the server-computed price and reply_by = now + 24 h.

MATCHING. Contractors accept at the stated price or pass - no counter-offers (homeowner_offer_accept / homeowner_offer_decline; the first accept wins, the row is locked). Accept writes the contract (construction trade contract, awarded, amount = price), binds the payment stages to it, seats the contractor (project_members, role collaborator, project_role contractor, bounded by the contract) and posts a message onto the timeline. No taker by reply_by is DERIVED (state posted, reply_by past); homeowner_booking_action offers bump (repost at +9 % rounded to $10, new bid package superseding the old, same bidders), wait (+48 h) or close.

PROGRESS IS DERIVED (rulebook 34) by homeowner_progress(): booked = posted_at; accepted = contract exists; payment nodes = the stage is Paid (record_manual_payment for check / cash / Zelle - card is not wired, the app says so) or Approved (met, not settled yet); task nodes = the action is closed via close_action; done = project Closed - Completed, which the close gate allows only with zero open tasks. The line therefore cannot say Done while a permit task is open.

THE TIMELINE is messages between the two contacts on the job (channel in app) plus files on the project; a message carries at most one attachment (messages.file_id). Photos go browser -> project-media (path under the JOB project id) -> record_project_file -> file_links, exactly as the portal does. Voice notes are audio files the same way.

SHARE. When the job is done the owner publishes a card (homeowner_share_publish): a slug on the booking, a quote, address hidden by default. homeowner_share(slug) is anon and returns the package, town, dates, community price, contractor name and rating, and the owner''s app_users id as the referral (?ref=) the join page carries silently into contacts.referred_by_contact_id via homeowner_register. It returns NO photos: project-media is private and public-media is superadmin-write; making before/after photos public is a decision for Shahar, not a default.

ANON SURFACE (rulebook 71): homeowner_catalogue, homeowner_share, homeowner_ref_preview - three deliberate additions, read-only, leaking only what is public by design.

NOT BUILT IN v1, by the spec: card payments in-app (processor rail exists in payment_methods; nothing collects), the contractor app (offers are visible through homeowner_offers() for a signed-in contractor and can be accepted via SQL / Claude for a demo), property-record lookup (source TBD - the confirm screen is drawn source-agnostic; today the owner types the facts), pre-filled permit forms (the form library links the NJ UCC PDFs).',
  'blueprint_packages, blueprint_package_items, blueprint_package_levers, blueprint_package_lever_options, blueprint_package_photos, blueprint_package_milestones, project_bookings, bid_packages, bids, payment_stages, actions, messages, files, homeowner_*',
  100, 'claude_code 2026-09-07');

commit;
