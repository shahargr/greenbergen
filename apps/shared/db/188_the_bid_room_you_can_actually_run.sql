-- 188: THE BID ROOM YOU CAN ACTUALLY RUN.
--
-- Shahar (2026-09-18), with three screenshots of the roofing room:
--
--   "edit the bidding room capability is lacking. edit / remove people for
--    example is needed, as well being able to manually upload their
--    proposals. people in the room should be listed in a table on top, with
--    their pricing. when asking for pricing i would like to create the
--    template the vendors will complete so it is easier to compare them.
--    this capability is not listed. when adding someone to the bid room,
--    search all contacts for that particular trade required. note that some
--    jobs may have 2 trades or more, so account for it. where bill negotiator
--    was created, as well as handy man. need to have a way to delete them
--    from this screen if i have the right permissions."
--
-- Applied as 188a..188e. Five things the room could not do:
--
--   a  take somebody out, or correct a name and a number typed wrong
--   b  ask for a price against every line instead of one lump sum
--   c  find who does this trade, rather than listing everybody on the job
--   d  take a stray trade off the board
--   e  say all of the above in the reads the screens draw from
--
-- The sixth - uploading their proposal by hand - was already there (186) and
-- only needed a way in from the roster; that is screen work, not schema.

-- ---------------------------------------------------------------------------
-- 188a  A room's roster can be corrected
-- ---------------------------------------------------------------------------
-- You could put somebody in a room and never take them out, and a name typed
-- wrong stayed wrong. Both are ordinary: you add the wrong Luis, a firm says
-- they are not bidding, somebody's number was a digit short.
--
-- WHAT REMOVING MEANS: the bid row goes, and with it the reply link and the
-- documents LINKED to that bid (file_links cascades) - never the files
-- themselves, which belong to the project. A bidder who has already priced
-- is not removed silently: this refuses unless the caller says so out loud,
-- because a price somebody gave you is evidence, and "mark them lost" is
-- almost always the right move instead.
create or replace function public.portal_bid_room_remove(p_bid uuid, p_even_if_priced boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare b public.bids; pk public.bid_packages; v_who text; v_docs integer;
begin
  perform public.assert_own_hands();
  select * into b from public.bids where id = p_bid;
  if b.id is null then
    return jsonb_build_object('ok', false, 'reason', 'That bidder is not in this room.');
  end if;
  select * into pk from public.bid_packages where id = b.package_id;
  if pk.id is null or not public.bid_can_manage(pk.project_id) then
    return jsonb_build_object('ok', false, 'reason', 'That room is not yours to change.');
  end if;

  if pk.awarded_bid_id = b.id or b.won then
    return jsonb_build_object('ok', false, 'code', 'AWARDED',
      'reason', 'This is the bid that won. Taking it out would leave the job without the price it was let at.');
  end if;
  if coalesce(pk.status, '') = 'closed' then
    return jsonb_build_object('ok', false, 'code', 'CLOSED',
      'reason', 'This room is closed. The record of who was asked and what they said stays as it was.');
  end if;

  if b.amount is not null and not coalesce(p_even_if_priced, false) then
    return jsonb_build_object('ok', false, 'code', 'PRICED',
      'reason', format('%s has already given you a number. Marking them lost keeps the price on the record; removing them throws it away.',
        coalesce((select co.company_name from public.companies co where co.id = b.bidder_company_id),
                 (select coalesce(ct.person_name, ct.name) from public.contacts ct where ct.id = b.bidder_contact_id),
                 'They')));
  end if;

  v_who := coalesce((select co.company_name from public.companies co where co.id = b.bidder_company_id),
                    (select coalesce(ct.person_name, ct.name) from public.contacts ct where ct.id = b.bidder_contact_id),
                    'that bidder');
  select count(*) into v_docs from public.file_links fl where fl.bid_id = b.id;

  -- The contact and the company stay: they are the address book, not this
  -- room. Only their place in this room goes.
  delete from public.bids where id = b.id;

  return jsonb_build_object('ok', true, 'who', v_who, 'docs_unlinked', v_docs,
    'in_room', (select count(*) from public.bids where package_id = pk.id));
end $$;
revoke all on function public.portal_bid_room_remove(uuid, boolean) from public, anon;
grant execute on function public.portal_bid_room_remove(uuid, boolean) to authenticated;

comment on function public.portal_bid_room_remove(uuid, boolean) is
  'Takes a bidder out of a room. Refuses the awarded bid and a closed room; refuses a priced bid unless told twice. The contact and company stay - only their place in this room goes.';

-- FIXING WHO THEY ARE. A bidder added by hand carries a company and a person
-- made on the spot (portal_bid_room_add), and the numbers get typed wrong.
-- This edits the PARTY, which is the address book - so a corrected phone is
-- corrected everywhere, which is the point of having one.
create or replace function public.portal_bid_room_edit(
  p_bid uuid, p_company_name text default null, p_person_name text default null,
  p_phone text default null, p_email text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare b public.bids; pk public.bid_packages;
        v_cname text := nullif(btrim(coalesce(p_company_name, '')), '');
        v_pname text := nullif(btrim(coalesce(p_person_name, '')), '');
        v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
        v_email text := nullif(btrim(coalesce(p_email, '')), '');
begin
  perform public.assert_own_hands();
  select * into b from public.bids where id = p_bid;
  if b.id is null then
    return jsonb_build_object('ok', false, 'reason', 'That bidder is not in this room.');
  end if;
  select * into pk from public.bid_packages where id = b.package_id;
  if pk.id is null or not public.bid_can_manage(pk.project_id) then
    return jsonb_build_object('ok', false, 'reason', 'That room is not yours to change.');
  end if;

  if b.bidder_company_id is not null and v_cname is not null then
    update public.companies set company_name = v_cname,
           main_phone = coalesce(v_phone, main_phone), main_email = coalesce(v_email, main_email),
           last_modified_by = 'portal:bid-room'
     where id = b.bidder_company_id;
  end if;
  if b.bidder_contact_id is not null then
    update public.contacts set
           person_name = coalesce(v_pname, person_name),
           name = coalesce(v_pname, name),
           phone = coalesce(v_phone, phone),
           email_a = coalesce(v_email, email_a),
           last_modified_by = 'portal:bid-room'
     where id = b.bidder_contact_id;
  end if;
  -- Nowhere to write it: a bid with neither a company nor a contact behind it
  -- cannot exist (portal_bid_room_add refuses), but say so rather than
  -- pretending the edit landed.
  if b.bidder_company_id is null and b.bidder_contact_id is null then
    return jsonb_build_object('ok', false, 'reason', 'There is nobody behind this row to correct.');
  end if;

  return jsonb_build_object('ok', true,
    'who', coalesce((select co.company_name from public.companies co where co.id = b.bidder_company_id),
                    (select coalesce(ct.person_name, ct.name) from public.contacts ct where ct.id = b.bidder_contact_id)));
end $$;
revoke all on function public.portal_bid_room_edit(uuid, text, text, text, text) from public, anon;
grant execute on function public.portal_bid_room_edit(uuid, text, text, text, text) to authenticated;

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);

-- ---------------------------------------------------------------------------
-- 188b  The sheet they fill in
-- ---------------------------------------------------------------------------
-- Until now a base line was a TICK - in or out - and the whole job was one
-- lump sum. Three roofers come back with 41,000 / 38,500 / 44,000 and the
-- only honest thing you can say is which is smaller. Where the money
-- actually went is the question, and nobody could ask it.
--
-- So the room can ask for A PRICE ON EVERY LINE. It is the room's choice,
-- not a rule: a small job wants one number, and a roof with thirteen lines
-- wants thirteen. A line may also carry a QUANTITY and a UNIT - 32 squares,
-- 140 linear feet - which is what turns three quotes into a rate you can
-- compare, and is the difference between a bid sheet and a wish.
alter table public.bid_packages
  add column if not exists price_per_line boolean not null default false;
alter table public.bid_package_items
  add column if not exists qty numeric,
  add column if not exists unit text;

comment on column public.bid_packages.price_per_line is
  'The room asks for a price against every base line, not one lump sum. The bidder''s total is the sum of the lines and the screen says so.';
comment on column public.bid_package_items.qty is
  'How much of this line there is - 32, 140. Shown to the bidder so everybody prices the same quantity.';
comment on column public.bid_package_items.unit is
  'What the quantity is counted in - squares, linear feet, each. Free text: the trade''s own word is the right one.';

-- The room's own switch, and a line's measurement. Two small writes rather
-- than one wide one: the switch is the room's shape and the measurement is
-- one row's fact, and they are edited at different moments.
create or replace function public.portal_bid_template_set(p_package uuid, p_price_per_line boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare pk public.bid_packages;
begin
  perform public.assert_own_hands();
  select * into pk from public.bid_packages where id = p_package;
  if pk.id is null or not public.bid_can_manage(pk.project_id) then
    return jsonb_build_object('ok', false, 'reason', 'That room is not yours to change.');
  end if;
  if coalesce(pk.status, '') = 'closed' or pk.awarded_bid_id is not null then
    return jsonb_build_object('ok', false, 'code', 'CLOSED',
      'reason', 'This room is closed. Changing what it asked for now would rewrite the question the prices answered.');
  end if;
  update public.bid_packages set price_per_line = coalesce(p_price_per_line, false),
         last_modified_by = 'portal:bid-room' where id = p_package;
  return jsonb_build_object('ok', true, 'price_per_line', coalesce(p_price_per_line, false));
end $$;
revoke all on function public.portal_bid_template_set(uuid, boolean) from public, anon;
grant execute on function public.portal_bid_template_set(uuid, boolean) to authenticated;

create or replace function public.portal_bid_item_measure(p_item uuid, p_qty numeric, p_unit text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_pkg uuid; v_project uuid;
begin
  perform public.assert_own_hands();
  select i.package_id, bp.project_id into v_pkg, v_project
    from public.bid_package_items i join public.bid_packages bp on bp.id = i.package_id
   where i.id = p_item;
  if v_pkg is null or not public.bid_can_manage(v_project) then
    return jsonb_build_object('ok', false, 'reason', 'That line is not yours to change.');
  end if;
  update public.bid_package_items
     set qty = p_qty, unit = nullif(btrim(coalesce(p_unit, '')), '')
   where id = p_item;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.portal_bid_item_measure(uuid, numeric, text) from public, anon;
grant execute on function public.portal_bid_item_measure(uuid, numeric, text) to authenticated;

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);

-- ---------------------------------------------------------------------------
-- 188c  Who can I ask for this trade?
-- ---------------------------------------------------------------------------
-- portal_bid_candidates never looked at the trade at all. It returned
-- everybody holding a seat on any project you can edit - so the roofing room
-- offered you the surveyor, the insurance broker and the portable toilet
-- company, and the roofer you have used twice was only there if he happened
-- to be on a project already. On 55 Walnut it returned nothing useful at all.
--
-- This asks the right question: who does this trade. contact_trade_roles is
-- where that is written, and portal_bid_room_add has been stamping it on
-- every hand-added bidder since the room was built, so the answer improves
-- every time you use it.
--
-- THE JOB'S OTHER TRADES come back too. A room is opened on one trade, but a
-- job needs several - the generator needs a plumber AND an electrician (187)
-- - and the person standing in the roofing room often wants the plumber they
-- just met. Naming the trades the job needs lets the screen offer them rather
-- than making somebody remember which ones they were.
--
-- (Applied as 188c + 188c2, which took out a leftover line that called a
-- function - project_ancestry_up - that does not exist. Written here as the
-- one function it ended up being.)
create or replace function public.portal_bid_room_people(p_package uuid, p_q text default null, p_trade text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare pk public.bid_packages; v_q text := nullif(btrim(coalesce(p_q, '')), '');
        v_trade text;
begin
  select * into pk from public.bid_packages where id = p_package;
  if pk.id is null or not public.bid_can_manage(pk.project_id) then
    return null;
  end if;
  -- The trade being searched: the one asked for, else the room's own.
  v_trade := coalesce(nullif(btrim(coalesce(p_trade, '')), ''), pk.trade);

  return jsonb_build_object(
    'package', pk.id,
    'room_trade', pk.trade,
    'searching', v_trade,
    'q', v_q,
    -- Every trade this job needs, so a room opened on one can reach the rest.
    'job_trades', coalesce((select jsonb_agg(distinct n.trade order by n.trade)
                              from public.project_bid_needs n
                             where n.project_id in (select f.id from public.project_ancestry_down(
                                     (select p.id from public.projects p where p.id = pk.project_id)) f)
                               and n.kind = 'trade' and n.trade is not null), '[]'::jsonb),
    'people', coalesce((
      select jsonb_agg(x order by
               (x->>'in_room')::boolean,            -- already here: last
               (x->>'does_this_trade')::boolean desc,
               (x->>'bids_with_us')::integer desc,
               x->>'name')
      from (
        select jsonb_build_object(
          'contact_id', ct.id,
          'company_id', ct.company_id,
          'name', coalesce(ct.person_name, ct.name),
          'company', (select co.company_name from public.companies co where co.id = ct.company_id),
          'phone', ct.phone,
          'email', ct.email_a,
          'trades', coalesce((select jsonb_agg(r.trade order by r.trade)
                                from public.contact_trade_roles r where r.contact_id = ct.id), '[]'::jsonb),
          'does_this_trade', v_trade is not null and exists (
              select 1 from public.contact_trade_roles r where r.contact_id = ct.id and r.trade = v_trade),
          -- How often we have put them in a room before: the honest proxy for
          -- "do we know this person", and what sorts the list under the trade.
          'bids_with_us', (select count(*) from public.bids b where b.bidder_contact_id = ct.id),
          'in_room', exists (select 1 from public.bids b
                              where b.package_id = pk.id
                                and (b.bidder_contact_id = ct.id
                                  or (ct.company_id is not null and b.bidder_company_id = ct.company_id)))
        ) as x
        from public.contacts ct
        where ct.disabled_at is null
          and (
            -- A NAME SEARCH REACHES EVERYBODY. You are standing in front of
            -- somebody whose trade nobody has recorded yet; the search must
            -- not hide them because of our own bookkeeping.
            (v_q is not null and (coalesce(ct.person_name, ct.name) ilike '%' || v_q || '%'
               or exists (select 1 from public.companies co
                           where co.id = ct.company_id and co.company_name ilike '%' || v_q || '%')))
            -- With no search, the trade is the filter.
            or (v_q is null and v_trade is not null
                and exists (select 1 from public.contact_trade_roles r
                             where r.contact_id = ct.id and r.trade = v_trade))
          )
        limit 60
      ) q), '[]'::jsonb));
end $$;
revoke all on function public.portal_bid_room_people(uuid, text, text) from public, anon;
grant execute on function public.portal_bid_room_people(uuid, text, text) to authenticated;

comment on function public.portal_bid_room_people(uuid, text, text) is
  'Who to put in a bid room: contacts who do the trade, best-known first, with a name search that reaches every contact. Carries the job''s other trades so a multi-trade job can be searched across from one room.';

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);

-- ---------------------------------------------------------------------------
-- 188d  A trade can come off the board
-- ---------------------------------------------------------------------------
-- The bid board's trade list is project_bid_needs, and things land in it by
-- hand and by blueprint. "Handy man" is not even a trade the catalogue knows
-- - somebody typed it - and it has sat in NOT STARTED ever since, next to
-- "Bill Negotiator", asking to be acted on forever.
--
-- Two halves. The board has to SAY which rows are behind a trade, because a
-- trade the family needs twice is two rows; and there has to be one call that
-- takes them all off. It refuses when the trade is actually being used - a
-- room with somebody in it, or a contract - because that is not a tidy-up,
-- that is deleting the record of work.
do $patch$
declare src text; out_ text;
begin
  src := pg_get_functiondef('public.portal_bid_board(uuid)'::regprocedure);
  out_ := replace(src,
    $old$        'note', (select pp.notes from public.project_participants pp$old$,
    $new$        'need_ids', coalesce((select jsonb_agg(n2.id) from public.project_bid_needs n2
                       where n2.project_id in (select id from fam) and n2.kind = 'trade' and n2.trade = t.trade), '[]'::jsonb),
        'note', (select pp.notes from public.project_participants pp$new$);
  if out_ = src then raise exception 'portal_bid_board has drifted - the note line was not found.'; end if;
  execute out_;
end $patch$;

create or replace function public.portal_bid_trade_drop(p_project uuid, p_trade text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_trade text := nullif(btrim(coalesce(p_trade, '')), '');
        v_rooms integer; v_bids integer; v_contracts integer; v_gone integer;
begin
  perform public.assert_own_hands();
  if not public.bid_can_manage(p_project) then
    return jsonb_build_object('ok', false, 'reason', 'This job is not yours to change.');
  end if;
  if v_trade is null then
    return jsonb_build_object('ok', false, 'reason', 'Say which trade.');
  end if;

  -- IS IT ACTUALLY IN USE? A room somebody is standing in, or a contract that
  -- was signed, is not a stray line - taking it off would hide real work.
  select count(*) into v_rooms from public.bid_packages bp
   where bp.project_id in (select f.id from public.project_ancestry_down(p_project) f)
     and bp.trade = v_trade;
  select count(*) into v_bids from public.bids b
    join public.bid_packages bp on bp.id = b.package_id
   where bp.project_id in (select f.id from public.project_ancestry_down(p_project) f)
     and bp.trade = v_trade;
  select count(*) into v_contracts from public.contracts c
   where c.project_id in (select f.id from public.project_ancestry_down(p_project) f)
     and c.trade = v_trade and c.direction = 'payable';

  if v_bids > 0 or v_contracts > 0 then
    return jsonb_build_object('ok', false, 'code', 'IN_USE',
      'reason', case
        when v_contracts > 0 then format('%s is on a contract. Taking it off the board would hide work that was let.', v_trade)
        else format('%s has %s in its room. Close the room first, or take them out of it.',
                    v_trade, case when v_bids = 1 then 'somebody' else v_bids || ' people' end) end,
      'rooms', v_rooms, 'bids', v_bids, 'contracts', v_contracts);
  end if;

  -- An empty room is just a heading somebody opened; it goes with the trade.
  delete from public.bid_packages bp
   where bp.project_id in (select f.id from public.project_ancestry_down(p_project) f)
     and bp.trade = v_trade;

  delete from public.project_bid_needs n
   where n.project_id in (select f.id from public.project_ancestry_down(p_project) f)
     and n.kind = 'trade' and n.trade = v_trade;
  get diagnostics v_gone = row_count;

  return jsonb_build_object('ok', true, 'trade', v_trade, 'removed', v_gone, 'rooms_removed', v_rooms);
end $$;
revoke all on function public.portal_bid_trade_drop(uuid, text) from public, anon;
grant execute on function public.portal_bid_trade_drop(uuid, text) to authenticated;

comment on function public.portal_bid_trade_drop(uuid, text) is
  'Takes a trade off the job''s bid board - every project_bid_needs row for it across the family, and its room when the room is empty. Refuses when anybody has bid or a contract names the trade.';

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);

-- ---------------------------------------------------------------------------
-- 188e  The reads carry the template
-- ---------------------------------------------------------------------------
-- Three functions have to say what the room is asking for, or 188b is a
-- column nobody can see: the room's own read, the bidder's read through his
-- link, and the comparison.

-- 1. THE ROOM. price_per_line on the package, qty and unit on each line.
do $patch$
declare src text; out_ text;
begin
  src := pg_get_functiondef('public.portal_bid_package(uuid)'::regprocedure);
  out_ := replace(src,
    $old$'is_required', i.is_required, 'sort', i.sort$old$,
    $new$'is_required', i.is_required, 'sort', i.sort, 'qty', i.qty, 'unit', i.unit$new$);
  if out_ = src then raise exception 'portal_bid_package has drifted - the item line was not found.'; end if;
  out_ := replace(out_,
    $old$'budget_visible', bp.budget_visible$old$,
    $new$'budget_visible', bp.budget_visible, 'price_per_line', coalesce(bp.price_per_line, false)$new$);
  execute out_;
end $patch$;

-- 2. THE BIDDER. When the room asks for a price per line, each base line
-- carries the quantity, the unit and whatever he last put against it - so
-- coming back to change one number does not mean typing them all again.
do $patch$
declare src text; out_ text;
begin
  src := pg_get_functiondef('public.bid_by_token(uuid)'::regprocedure);
  out_ := replace(src,
    $old$    'reply_by', bp.reply_by,$old$,
    $new$    'reply_by', bp.reply_by,
    'price_per_line', coalesce(bp.price_per_line, false),$new$);
  if out_ = src then raise exception 'bid_by_token has drifted - reply_by was not found.'; end if;
  out_ := replace(out_,
    $old$                'scope_item_id', i.scope_item_id, 'item', s.item, 'is_required', i.is_required,
                'included', coalesce((select (li->>'included')::boolean$old$,
    $new$                'scope_item_id', i.scope_item_id, 'item', s.item, 'is_required', i.is_required,
                'qty', i.qty, 'unit', i.unit,
                'price', (select nullif(li->>'price', '')::numeric
                            from jsonb_array_elements(coalesce(b.line_items, '[]'::jsonb)) li
                           where li->>'scope_item_id' = i.scope_item_id::text limit 1),
                'included', coalesce((select (li->>'included')::boolean$new$);
  execute out_;
end $patch$;

-- 3. THE COMPARISON. It already reads a price off every base line; it only
-- needs to say whether the room asked for them, so the table knows to show a
-- price column rather than a tick, and what each bidder's lines add up to.
do $patch$
declare src text; out_ text;
begin
  src := pg_get_functiondef('public.portal_bid_compare(uuid)'::regprocedure);
  out_ := replace(src,
    $old$'coi_required', coi_required, 'status', status,$old$,
    $new$'coi_required', coi_required, 'status', status,
        'price_per_line', coalesce(price_per_line, false),$new$);
  if out_ = src then raise exception 'portal_bid_compare has drifted - coi_required was not found.'; end if;
  -- What his lines add up to, beside what he said the job costs. When the two
  -- disagree the screen says so: that is the whole reason for asking per line.
  out_ := replace(out_,
    $old$        'options_quoted', (select count(*) from opts o$old$,
    $new$        'lines_total', (select sum(c.price) from cell c where c.bid_id = bb.id and c.price is not null),
        'lines_priced', (select count(*) from cell c where c.bid_id = bb.id and c.price is not null),
        'options_quoted', (select count(*) from opts o$new$);
  execute out_;
end $patch$;

-- The items the comparison hands back need the measurement too, so a rate can
-- be read off the table rather than worked out on paper.
do $patch$
declare src text; out_ text;
begin
  src := pg_get_functiondef('public.portal_bid_compare(uuid)'::regprocedure);
  out_ := replace(src,
    $old$    select i.scope_item_id, s.item, i.is_required, i.sort
    from bid_package_items i join project_scope_items s on s.id = i.scope_item_id
    where i.package_id = p_pkg and coalesce(i.kind, 'base') = 'base'),$old$,
    $new$    select i.scope_item_id, s.item, i.is_required, i.sort, i.qty, i.unit
    from bid_package_items i join project_scope_items s on s.id = i.scope_item_id
    where i.package_id = p_pkg and coalesce(i.kind, 'base') = 'base'),$new$);
  if out_ = src then raise exception 'portal_bid_compare has drifted - the items CTE was not found.'; end if;
  out_ := replace(out_,
    $old$        'scope_item_id', it.scope_item_id, 'item', it.item, 'is_required', it.is_required,$old$,
    $new$        'scope_item_id', it.scope_item_id, 'item', it.item, 'is_required', it.is_required,
        'qty', it.qty, 'unit', it.unit,$new$);
  execute out_;
end $patch$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
