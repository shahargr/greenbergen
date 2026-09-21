-- A BID ASK HAS PRICED SECTIONS, BECAUSE THAT IS HOW A QUOTE COMES BACK.
--
-- Shahar, 2026-09-21, handing over a real roofing quote: "this needs to be
-- defined in a bid ask so two different proposals can be compared."
--
--   EXTERIOR TRIM:      four lines, one TOTAL PRICE
--   GUTTERS AND LEADERS: two lines, one TOTAL PRICE
--   ROOFING:            five lines, one TOTAL PRICE
--   OPTIONAL:           priced on their own
--
-- The room could express two granularities and neither is that one. A lump
-- sum for the whole trade, or a price against every single line. The
-- evidence that per-line is the wrong ask is in the data: it has existed for
-- weeks and all seven packages are price_per_line = false. Nobody prices
-- fifteen lines. Everybody prices three sections.
--
-- WHY IT MATTERS FOR COMPARING. Two roofers at $44,000 and $42,000 look like
-- a $2,000 decision. Split by section, one is $32,000 on roofing against the
-- other's $28,000, with the difference hiding in trim - which is a
-- negotiation, or a split award, and today it is invisible.
--
-- SECTION IS NOT category, and that was checked rather than assumed.
-- blueprint_trade.category and project_scope_items.category hold a taxonomy
-- of CONCERNS - Compliance, Coordination, Insurance, Payment, Sequencing.
-- They answer "what kind of requirement is this". A section answers "which
-- priced package of work does this belong to", which is a different question
-- with a different grain: the same line can sit under different headings in
-- two different asks. So it is its own column (rulebook 30: the check is
-- whether the fact already exists, and this one does not).

alter table public.bid_package_items
  add column if not exists section text,
  add column if not exists section_sort integer;

comment on column public.bid_package_items.section is
  'The priced section this line sits in within THIS ask - "EXTERIOR TRIM", "ROOFING". Null means the ask is not sectioned. Not project_scope_items.category, which is a taxonomy of concerns (Compliance, Payment) rather than a package of work.';
comment on column public.bid_package_items.section_sort is
  'Where this section comes in the ask. Held on every line of the section rather than in a table of its own: a section has no existence apart from the lines in it, and an empty one is not a thing anybody wants to keep.';

create index if not exists idx_bid_package_items_section
  on public.bid_package_items (package_id, section_sort, section)
  where section is not null;

-- THE THIRD GRANULARITY. price_per_line stays exactly as it is, so nothing
-- reading it changes behaviour; price_basis is the fuller question and is
-- backfilled from it.
alter table public.bid_packages
  add column if not exists price_basis text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_bid_packages_price_basis') then
    alter table public.bid_packages
      add constraint chk_bid_packages_price_basis
      check (price_basis is null or price_basis in ('lump', 'section', 'line'));
  end if;
end $$;

update public.bid_packages
   set price_basis = case when coalesce(price_per_line, false) then 'line' else 'lump' end
 where price_basis is null;

comment on column public.bid_packages.price_basis is
  'How this ask wants to be answered: lump (one number for the trade), section (one number per priced section - what a real quote looks like), or line (a price against every line, which no contractor has ever actually done here). Backfilled from price_per_line, which stays in step for everything still reading it.';

-- WHAT THE BIDDER SENDS BACK, one entry per section:
--   [{"section": "ROOFING", "price": 32000, "included": true, "note": "..."}]
alter table public.bids
  add column if not exists section_prices jsonb;

comment on column public.bids.section_prices is
  'This bidder''s total against each section of the ask. Null on a bid answered as a lump sum - which is allowed, and shows in the comparison as not comparable rather than being refused (Shahar 2026-09-21: never lose a real price to a formatting rule).';

-- AND THE TEMPLATE CARRIES ITS SECTIONS. blueprint_trade is already the
-- reusable per-trade scope - one row per trade and item - so the sections a
-- trade is normally asked in belong on it rather than in a new table.
alter table public.blueprint_trade
  add column if not exists section text,
  add column if not exists section_sort integer;

comment on column public.blueprint_trade.section is
  'The priced section this standard line belongs in, so a room seeded from the trade template arrives already sectioned.';

-- THE READ. Items carry their section; the package says how it wants to be
-- priced.
do $$
declare
  src text; out_sql text; n int;
  a constant text := '''origin'', s.origin, ''source'', s.source,';
  b constant text := '''origin'', s.origin, ''source'', s.source,
                ''section'', i.section, ''section_sort'', i.section_sort,';
begin
  src := pg_get_functiondef('public.portal_bid_package(uuid)'::regprocedure);
  n := (length(src) - length(replace(src, a, ''))) / length(a);
  if n <> 1 then raise exception 'The item block matched % times, expected 1.', n; end if;
  out_sql := replace(src, a, b);
  execute out_sql;
end $$;

do $$
declare
  src text; out_sql text; n int;
  a constant text := '''price_per_line''';
  b constant text := '''price_basis'', coalesce(bp.price_basis, case when coalesce(bp.price_per_line, false) then ''line'' else ''lump'' end),
    ''price_per_line''';
begin
  src := pg_get_functiondef('public.portal_bid_package(uuid)'::regprocedure);
  n := (length(src) - length(replace(src, a, ''))) / length(a);
  if n <> 1 then raise exception 'price_per_line appeared % times, expected 1.', n; end if;
  out_sql := replace(src, a, b);
  execute out_sql;
end $$;
