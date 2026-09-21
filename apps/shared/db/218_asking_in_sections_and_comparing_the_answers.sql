-- ASKING IN SECTIONS, ANSWERING IN SECTIONS, AND COMPARING THE TWO.
--
-- Three functions on the shape 217 added.
--
-- A SEPARATE READ RATHER THAN A BIGGER portal_bid_compare, for the reason
-- 196 gives: that function is the comparison table's whole read and already
-- computes per-line cells, gap costs and normalised totals. Growing it to
-- carry a second grain would put the risk of a rewrite on every column that
-- already works, for a block only a sectioned room renders.
--
-- NOTE: portal_bid_sections_set below has the JSON-null bug that 219 fixes.
-- Kept as applied, because a migration is a record of what happened.

-- 1. HOW THE ASK IS ORGANISED.
--
-- Sections arrive as an ORDERED array, each naming its lines, so the order
-- on the screen is the order in the argument and nobody passes a sort number
-- by hand:
--
--   [{"section": "EXTERIOR TRIM",       "lines": ["<item-id>", ...]},
--    {"section": "GUTTERS AND LEADERS", "lines": [...]}]
--
-- A line left out of every section keeps whatever it had; passing an empty
-- array is how you go back to an unsectioned ask.
create or replace function public.portal_bid_sections_set(
  p_package uuid, p_sections jsonb, p_basis text default 'section')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  pk    public.bid_packages;
  sec   jsonb;
  ix    int := 0;
  v_set int := 0;
  v_ids uuid[];
  v_all uuid[] := '{}';
begin
  perform public.assert_own_hands();
  select * into pk from public.bid_packages where id = p_package;
  if pk.id is null or not public.bid_can_manage(pk.project_id) then
    return jsonb_build_object('ok', false, 'reason', 'Changing this ask is not yours to do.');
  end if;
  if pk.awarded_bid_id is not null then
    return jsonb_build_object('ok', false, 'reason',
      'This package is awarded. The sections are what the winning price was given against, so they stand.');
  end if;
  if p_basis is not null and p_basis not in ('lump', 'section', 'line') then
    return jsonb_build_object('ok', false, 'reason', 'A price is asked for as a lump, by section, or by line.');
  end if;

  for sec in select value from jsonb_array_elements(coalesce(p_sections, '[]'::jsonb)) loop
    ix := ix + 1;
    select array_agg((v)::uuid) into v_ids
      from jsonb_array_elements_text(coalesce(sec->'lines', '[]'::jsonb)) v;
    if v_ids is not null then
      update public.bid_package_items
         set section = nullif(btrim(sec->>'section'), ''), section_sort = ix
       where package_id = p_package and id = any(v_ids);
      v_set := v_set + coalesce(array_length(v_ids, 1), 0);
      v_all := v_all || v_ids;
    end if;
  end loop;

  -- Anything the caller did not place comes OUT of its section rather than
  -- keeping a stale heading - a line quietly left under "ROOFING" after
  -- being moved is worse than one with no section at all.
  update public.bid_package_items
     set section = null, section_sort = null
   where package_id = p_package and not (id = any(v_all)) and section is not null;

  update public.bid_packages
     set price_basis = coalesce(p_basis, price_basis),
         -- price_per_line stays in step for everything still reading it.
         price_per_line = (coalesce(p_basis, price_basis) = 'line'),
         last_modified_at = now(), last_modified_by = 'portal:sections'
   where id = p_package;

  return jsonb_build_object('ok', true, 'sections', ix, 'lines_placed', v_set,
                            'basis', coalesce(p_basis, pk.price_basis));
end $fn$;

comment on function public.portal_bid_sections_set(uuid, jsonb, text) is
  'Organise a bid ask into ordered priced sections, each naming its lines. A line left out of every section loses its heading rather than keeping a stale one. Refused on an awarded package.';


-- 2. WHAT CAME BACK, BY SECTION.
--
--   [{"section": "ROOFING", "price": 32000, "included": true, "note": "..."}]
--
-- The total is the sum unless one is given: a quote that adds up is the
-- normal case, and a quote that does not is a thing worth being able to
-- record exactly as received rather than silently correcting.
create or replace function public.portal_bid_section_reply(
  p_bid uuid, p_sections jsonb, p_amount numeric default null,
  p_valid_until date default null, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  b       public.bids;
  pk      public.bid_packages;
  v_sum   numeric;
  v_n     int;
  v_total numeric;
begin
  perform public.assert_own_hands();
  select * into b from public.bids where id = p_bid;
  if b.id is null then return jsonb_build_object('ok', false, 'reason', 'No such bid.'); end if;
  select * into pk from public.bid_packages where id = b.package_id;
  if pk.id is null or not public.bid_can_manage(pk.project_id) then
    return jsonb_build_object('ok', false, 'reason', 'Recording a price here is not yours to do.');
  end if;

  select count(*), sum(nullif(s->>'price', '')::numeric)
    into v_n, v_sum
    from jsonb_array_elements(coalesce(p_sections, '[]'::jsonb)) s
   where coalesce((s->>'included')::boolean, true);

  if v_n = 0 and p_amount is null then
    return jsonb_build_object('ok', false, 'reason', 'Put a price against at least one section, or give one total.');
  end if;

  v_total := coalesce(p_amount, v_sum);
  if v_total is null or v_total <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'A price has to be a number greater than nothing.');
  end if;

  update public.bids
     set section_prices = case when v_n > 0 then p_sections else section_prices end,
         amount = v_total,
         valid_until = coalesce(p_valid_until, valid_until),
         notes = coalesce(nullif(btrim(coalesce(p_notes, '')), ''), notes),
         received_on = coalesce(received_on, current_date),
         status = case when status in ('invited', 'no response', 'expired') then 'received' else status end,
         last_modified_at = now(), last_modified_by = 'portal:section-reply'
   where id = b.id;

  return jsonb_build_object('ok', true, 'bid_id', b.id, 'sections_priced', v_n,
    'total', v_total,
    -- A quote whose sections do not add up to its own total is worth saying
    -- out loud rather than quietly preferring one of the two numbers.
    'adds_up', v_sum is null or p_amount is null or round(v_sum) = round(p_amount),
    'sum_of_sections', v_sum);
end $fn$;

comment on function public.portal_bid_section_reply(uuid, jsonb, numeric, date, text) is
  'Record a bidder''s total against each section of the ask. The bid total is the sum unless one is given; when both are present and disagree, both are kept and adds_up says so.';


-- 3. SIDE BY SIDE, SECTION BY SECTION.
--
-- Every section of the ask, every bidder, and what each one put against it -
-- plus the thing the whole feature is for: who is cheapest on THIS section
-- rather than only on the whole job.
--
-- off_format is DERIVED, not stored (rulebook 34): a bid is off format when
-- the ask has sections and the bid has a number but no section split. That
-- is a fact about two columns, and storing it would be a third thing to keep
-- in step.
create or replace function public.portal_bid_sections(p_pkg uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $fn$
  with pk as (select * from bid_packages where id = p_pkg),
  secs as (
    select i.section, min(i.section_sort) as sort,
           count(*) as lines,
           jsonb_agg(jsonb_build_object('id', i.id, 'item', s.item,
                     'is_required', coalesce(i.is_required, true))
                     order by i.sort, s.item) as items
      from bid_package_items i
      join project_scope_items s on s.id = i.scope_item_id
     where i.package_id = p_pkg and coalesce(i.is_included, true) and i.section is not null
     group by i.section),
  bb as (
    select b.id, coalesce(co.company_name, c.person_name, c.name) as bidder,
           b.amount, b.status, b.section_prices
      from bids b
      left join contacts c on c.id = b.bidder_contact_id
      left join companies co on co.id = b.bidder_company_id
     where b.package_id = p_pkg
       and b.status in ('received', 'under negotiation', 'awarded', 'not awarded')),
  cell as (
    select sc.section, bb.id as bid_id,
           nullif(x.sp->>'price', '')::numeric as price,
           coalesce((x.sp->>'included')::boolean, true) as included,
           x.sp->>'note' as note
      from secs sc cross join bb
      left join lateral (
        select sp from jsonb_array_elements(coalesce(bb.section_prices, '[]'::jsonb)) sp
         where upper(btrim(sp->>'section')) = upper(btrim(sc.section)) limit 1) x on true)
  select case when (select id from pk) is null
              or not public.is_project_member((select project_id from pk)) then null
         else jsonb_build_object(
    'package_id', p_pkg,
    'price_basis', (select coalesce(price_basis, 'lump') from pk),
    'bidders', coalesce((select jsonb_agg(jsonb_build_object(
        'id', bb.id, 'bidder', bb.bidder, 'amount', bb.amount, 'status', bb.status,
        -- One number against a sectioned ask: kept, and flagged.
        'off_format', bb.section_prices is null and bb.amount is not null
                      and (select count(*) from secs) > 0,
        'sum_of_sections', (select sum(c.price) from cell c where c.bid_id = bb.id and c.included)
      ) order by bb.amount nulls last) from bb), '[]'::jsonb),
    'sections', coalesce((select jsonb_agg(jsonb_build_object(
        'section', sc.section, 'sort', sc.sort, 'lines', sc.lines, 'items', sc.items,
        'prices', (select jsonb_agg(jsonb_build_object(
                     'bid_id', c.bid_id, 'price', c.price, 'included', c.included, 'note', c.note)
                     order by c.price nulls last)
                     from cell c where c.section = sc.section),
        -- The point of the whole thing: cheapest on THIS section.
        'best_bid_id', (select c.bid_id from cell c
                         where c.section = sc.section and c.included and c.price is not null
                         order by c.price limit 1),
        'low', (select min(c.price) from cell c where c.section = sc.section and c.included),
        'high', (select max(c.price) from cell c where c.section = sc.section and c.included)
      ) order by sc.sort, sc.section) from secs sc), '[]'::jsonb)) end;
$fn$;

comment on function public.portal_bid_sections(uuid) is
  'Every priced section of an ask against every bidder: what each put on it, who is cheapest on THAT section rather than on the job as a whole, and which bids came back as one number against a sectioned ask (off_format). SECURITY DEFINER with an explicit is_project_member gate, like the compare it sits beside.';

revoke all on function public.portal_bid_sections_set(uuid, jsonb, text) from public, anon;
revoke all on function public.portal_bid_section_reply(uuid, jsonb, numeric, date, text) from public, anon;
revoke all on function public.portal_bid_sections(uuid) from public, anon;
grant execute on function public.portal_bid_sections_set(uuid, jsonb, text) to authenticated, service_role;
grant execute on function public.portal_bid_section_reply(uuid, jsonb, numeric, date, text) to authenticated, service_role;
grant execute on function public.portal_bid_sections(uuid) to authenticated, service_role;
