-- 177: THE BID ROOM - EVERY TRADE HAS ONE, AND THE AWARD PUTS SOMEBODY ON
--      THE JOB.
--
-- Shahar (2026-09-17): "every trade by default requires a bid. if work
-- started flag the bid as completed... for open bids, we need to start by
-- adding people or companies into the bid room. the bid room will have bid
-- request, and bid answers. after comparing the answers, a job get awarded
-- and all participants in the bid room are updated. only the one awarded
-- get added to the task in the project... I can easily upload the proposals
-- received and we can have a quick way to compare them one to another.
-- Table, showing cost, and things included or missing."
--
-- MOST OF THIS ALREADY EXISTED and was unreachable. bid_packages is the
-- room, bids are the answers, bid_package_items are the rows of the
-- comparison, and portal_bid_compare already builds the table he describes -
-- cost per bidder, every scope line ticked or crossed, the gaps counted and
-- priced, a normalised total. portal_bid_award already marks the others "not
-- awarded" with a reason. What was missing is the way IN and the way OUT.
--
-- THE WAY IN, three things:
--   * portal_bid_board - every trade on the job with the state of its bid,
--     derived, not stored: WON when a contract exists, OPEN when a room
--     does, NOT STARTED otherwise. "Every trade requires a bid" needs no new
--     bookkeeping because the job's trade list already IS the bid needs list
--     (migration 164).
--   * portal_bid_room_open - open a room on a trade in one call.
--   * portal_bid_room_add - put a company in the room, creating the company
--     and the person if they are new. Shahar met Diego about roofing today
--     and Diego is in nothing yet; that must not be four screens.
--
-- COMPANY FIRST, PERSON NAMED (Shahar's choice, 2026-09-17). The contract,
-- the certificate of insurance and the W-9 all belong to the company, so the
-- bid does too - and two people from one firm do not become two bidders.
--
-- THE WAY OUT: awarding now writes the contract and seats the winner
-- (portal_award_trade), so "only the one awarded gets added to the project"
-- is what actually happens rather than something to remember afterwards.

-- ---------------------------------------------------------------------------
-- EVERY TRADE, WITH THE STATE OF ITS BID.
create or replace function public.portal_bid_board(p_project uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  with fam as (select f.id from public.project_ancestry_down(p_project) f),
  trades as (
    select distinct n.trade
      from public.project_bid_needs n
     where n.project_id in (select id from fam) and n.kind = 'trade' and n.trade is not null
  ),
  won as (
    select coalesce((select t.trade from public.trades t where lower(t.trade) = lower(btrim(c.trade)) limit 1), c.trade) as trade,
           c.id as contract_id, c.title, c.amount, c.status,
           coalesce((select co.company_name from public.companies co where co.id = c.counterparty_company_id),
                    (select coalesce(ct.person_name, ct.name) from public.contacts ct
                      where ct.id = coalesce(c.contractor_id, c.counterparty_contact_id))) as who,
           coalesce(c.awarded_date, c.signed_date, c.start_date) as awarded_on
      from public.contracts c
     where c.project_id in (select id from fam)
       and c.direction = 'payable'
       and lower(coalesce(c.status, '')) in ('signed','awarded','active','complete')
       and c.trade is not null
  ),
  rooms as (
    select coalesce((select t.trade from public.trades t where lower(t.trade) = lower(btrim(bp.trade)) limit 1), bp.trade) as trade,
           bp.id as package_id, bp.status, bp.reply_by, bp.awarded_bid_id,
           (select count(*) from public.bids b where b.package_id = bp.id) as invited,
           (select count(*) from public.bids b where b.package_id = bp.id
             and b.status in ('received','under negotiation','awarded','not awarded')) as replied
      from public.bid_packages bp
     where bp.project_id in (select id from fam) and bp.trade is not null
  )
  select case when not public.bid_can_manage(p_project) then null else jsonb_build_object(
    'trades', coalesce((select jsonb_agg(jsonb_build_object(
        'trade', t.trade,
        'stage', (select tr.stage from public.trades tr where tr.trade = t.trade),
        'panel', (select s.panel from public.trades tr join public.trade_stages s on s.stage = tr.stage where tr.trade = t.trade),
        'sort_order', (select tr.sort_order from public.trades tr where tr.trade = t.trade),
        'state', case when w.contract_id is not null then 'won'
                      when r.package_id is not null and coalesce(r.status, '') <> 'closed' then 'open'
                      when r.package_id is not null then 'won'
                      else 'none' end,
        'who', coalesce(w.who, null),
        'amount', w.amount,
        'awarded_on', w.awarded_on,
        'contract_id', w.contract_id,
        'package_id', r.package_id,
        'reply_by', r.reply_by,
        'invited', coalesce(r.invited, 0),
        'replied', coalesce(r.replied, 0),
        'scope_lines', (select count(*) from public.project_scope_items si
                         where si.project_id in (select id from fam) and si.trade = t.trade))
      order by (select tr.sort_order from public.trades tr where tr.trade = t.trade), t.trade)
      from trades t
      left join won w on w.trade = t.trade
      left join rooms r on r.trade = t.trade), '[]'::jsonb)) end;
$$;
revoke all on function public.portal_bid_board(uuid) from public, anon;
grant execute on function public.portal_bid_board(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- OPEN A ROOM ON A TRADE.
create or replace function public.portal_bid_room_open(
  p_project uuid, p_trade text, p_reply_by date default null, p_summary text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_trade text; v_have uuid; v_id uuid; v_entity uuid;
begin
  perform public.assert_own_hands();
  if not public.bid_can_manage(p_project) then
    return jsonb_build_object('ok', false, 'reason', 'Running a bid on this job is not yours to do.');
  end if;
  if not public.portal_task_takes_tasks(p_project) then
    return jsonb_build_object('ok', false, 'code', 'IS_PROPERTY',
      'reason', 'This is the property, not a job. Open the room on the job under it.');
  end if;
  select t.trade into v_trade from public.trades t where lower(t.trade) = lower(btrim(coalesce(p_trade, '')));
  if v_trade is null then
    return jsonb_build_object('ok', false, 'reason', format('"%s" is not a trade we know.', p_trade));
  end if;

  select bp.id into v_have from public.bid_packages bp
   where bp.project_id = p_project and lower(bp.trade) = lower(v_trade)
     and coalesce(bp.status, '') <> 'closed'
   order by bp.created_at limit 1;
  if v_have is not null then
    return jsonb_build_object('ok', true, 'id', v_have, 'existed', true, 'trade', v_trade);
  end if;

  insert into public.bid_packages (project_id, trade, category, scope_summary, reply_by, status, created_by)
  values (p_project, v_trade, v_trade, nullif(btrim(p_summary), ''),
          coalesce(p_reply_by, current_date + 10), 'open', 'portal:bid-room')
  returning id into v_id;

  -- The trade joins the job's list the moment a room opens for it (164).
  perform public.project_trade_join(p_project, v_trade, 'a bid room');

  -- Every scope line already written for this trade becomes a row of the
  -- comparison, so a room opened on a scoped trade is ready to compare.
  insert into public.bid_package_items (package_id, scope_item_id, is_required, sort)
  select v_id, si.id, true, row_number() over (order by si.id)
    from public.project_scope_items si
   where si.project_id = p_project and si.trade = v_trade
  on conflict do nothing;

  return jsonb_build_object('ok', true, 'id', v_id, 'existed', false, 'trade', v_trade,
    'lines', (select count(*) from public.bid_package_items where package_id = v_id));
end $$;
revoke all on function public.portal_bid_room_open(uuid, text, date, text) from public, anon;
grant execute on function public.portal_bid_room_open(uuid, text, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- PUT SOMEBODY IN THE ROOM. Company first, person named; both are created
-- when they are new, because the man you met this morning is in nothing yet.
create or replace function public.portal_bid_room_add(
  p_package uuid, p_company uuid default null, p_contact uuid default null,
  p_company_name text default null, p_person_name text default null,
  p_phone text default null, p_email text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  pk        public.bid_packages;
  v_company uuid := p_company;
  v_contact uuid := p_contact;
  v_cname   text := nullif(btrim(coalesce(p_company_name, '')), '');
  v_pname   text := nullif(btrim(coalesce(p_person_name, '')), '');
  v_made    boolean := false;
  v_id      uuid;
begin
  perform public.assert_own_hands();
  select * into pk from public.bid_packages where id = p_package;
  if pk.id is null or not public.bid_can_manage(pk.project_id) then
    return jsonb_build_object('ok', false, 'reason', 'That room is not yours to add to.');
  end if;
  if coalesce(pk.status, '') = 'closed' or pk.awarded_bid_id is not null then
    return jsonb_build_object('ok', false, 'code', 'CLOSED',
      'reason', 'This room is closed - the work was awarded. Open a new round if you are re-pricing it.');
  end if;

  -- Whichever half was given, find the other.
  if v_contact is not null and v_company is null then
    select ct.company_id into v_company from public.contacts ct where ct.id = v_contact;
  end if;
  if v_contact is null and v_company is not null then
    select ct.id into v_contact from public.contacts ct
     where ct.company_id = v_company and ct.disabled_at is null
     order by ct.is_primary_contact desc nulls last, ct.created_at limit 1;
  end if;

  -- NEW TO US. A name and a phone is all you have after a site walk.
  if v_company is null and v_cname is not null then
    select co.id into v_company from public.companies co
     where lower(co.company_name) = lower(v_cname) and co.disabled_at is null limit 1;
    if v_company is null then
      insert into public.companies (company_name, main_phone, main_email, source, created_by)
      values (v_cname, nullif(btrim(p_phone), ''), nullif(btrim(p_email), ''), 'portal:bid-room', 'portal:bid-room')
      returning id into v_company;
      v_made := true;
    end if;
  end if;
  if v_contact is null and v_pname is not null then
    select ct.id into v_contact from public.contacts ct
     where lower(coalesce(ct.person_name, ct.name)) = lower(v_pname)
       and (v_company is null or ct.company_id is not distinct from v_company)
       and ct.disabled_at is null limit 1;
    if v_contact is null then
      insert into public.contacts (name, person_name, company_id, phone, email_a, type, source, created_by)
      values (v_pname, v_pname, v_company, nullif(btrim(p_phone), ''), nullif(btrim(p_email), ''),
              'Service provider', 'portal:bid-room', 'portal:bid-room')
      returning id into v_contact;
      v_made := true;
    elsif v_company is not null then
      update public.contacts set company_id = coalesce(company_id, v_company) where id = v_contact;
    end if;
  end if;

  if v_company is null and v_contact is null then
    return jsonb_build_object('ok', false, 'reason', 'Say who - a company, or a name and a number.');
  end if;

  -- The trade they are bidding is theirs to be known for, next time.
  if pk.trade is not null and v_contact is not null then
    insert into public.contact_trade_roles (contact_id, trade) values (v_contact, pk.trade)
    on conflict do nothing;
  end if;

  -- ONE BIDDER PER PARTY. A second person from the same firm joins the row
  -- that is already there rather than becoming a second bid.
  select b.id into v_id from public.bids b
   where b.package_id = pk.id
     and ((v_company is not null and b.bidder_company_id = v_company)
       or (v_company is null and b.bidder_contact_id = v_contact))
   limit 1;
  if v_id is not null then
    update public.bids set bidder_contact_id = coalesce(bidder_contact_id, v_contact),
                           bidder_company_id = coalesce(bidder_company_id, v_company)
     where id = v_id;
    return jsonb_build_object('ok', true, 'id', v_id, 'existed', true,
      'who', coalesce(v_cname, v_pname), 'created_party', v_made);
  end if;

  insert into public.bids (project_id, package_id, trade, bidder_contact_id, bidder_company_id,
                           status, round, created_by)
  values (pk.project_id, pk.id, pk.trade, v_contact, v_company, 'invited', 1, 'portal:bid-room')
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'existed', false, 'created_party', v_made,
    'who', coalesce((select co.company_name from public.companies co where co.id = v_company),
                    (select coalesce(ct.person_name, ct.name) from public.contacts ct where ct.id = v_contact)),
    'in_room', (select count(*) from public.bids where package_id = pk.id));
end $$;
revoke all on function public.portal_bid_room_add(uuid, uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.portal_bid_room_add(uuid, uuid, uuid, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- WRITE THE SCOPE IN THE ROOM (Shahar's choice): the lines you type here are
-- the project's scope for that trade, and they are the rows of the table.
create or replace function public.portal_bid_scope_set(p_package uuid, p_lines text[])
returns jsonb
language plpgsql security definer set search_path = public as $$
declare pk public.bid_packages; v_line text; v_id uuid; v_n integer := 0; v_sort integer := 0;
begin
  perform public.assert_own_hands();
  select * into pk from public.bid_packages where id = p_package;
  if pk.id is null or not public.bid_can_manage(pk.project_id) then
    return jsonb_build_object('ok', false, 'reason', 'That room is not yours to change.');
  end if;
  if pk.trade is null then
    return jsonb_build_object('ok', false, 'reason', 'This room has no trade, so its lines have nowhere to live.');
  end if;

  foreach v_line in array coalesce(p_lines, '{}') loop
    v_line := nullif(btrim(v_line), '');
    continue when v_line is null;
    v_sort := v_sort + 1;
    -- The same sentence twice is one line, not two.
    select si.id into v_id from public.project_scope_items si
     where si.project_id = pk.project_id and si.trade = pk.trade and lower(btrim(si.item)) = lower(v_line)
     limit 1;
    if v_id is null then
      insert into public.project_scope_items (project_id, trade, item, origin, authority, created_by)
      values (pk.project_id, pk.trade, v_line, 'project', 'unassigned', 'portal:bid-room')
      returning id into v_id;
    end if;
    insert into public.bid_package_items (package_id, scope_item_id, is_required, sort)
    values (pk.id, v_id, true, v_sort)
    on conflict (package_id, scope_item_id) do update set sort = excluded.sort;
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('ok', true, 'lines', v_n,
    'total', (select count(*) from public.bid_package_items where package_id = pk.id));
end $$;
revoke all on function public.portal_bid_scope_set(uuid, text[]) from public, anon;
grant execute on function public.portal_bid_scope_set(uuid, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- THE COMPARISON NAMES THE COMPANY, since the company is the bidder.
do $patch$
declare src text; out_ text;
begin
  src := pg_get_functiondef('public.portal_bid_compare(uuid)'::regprocedure);
  out_ := replace(src,
    E'    select b.id, coalesce(c.person_name, c.name) as bidder, b.bidder_contact_id, b.status, b.amount, b.valid_until,\n'
 || E'           b.line_items, b.terms_reply, b.insurance_reply\n'
 || E'    from bids b left join contacts c on c.id = b.bidder_contact_id\n',
    E'    select b.id,\n'
 || E'           coalesce(co.company_name, c.person_name, c.name) as bidder,\n'
 || E'           nullif(coalesce(c.person_name, c.name), coalesce(co.company_name, '''')) as person,\n'
 || E'           b.bidder_contact_id, b.status, b.amount, b.valid_until,\n'
 || E'           b.line_items, b.terms_reply, b.insurance_reply\n'
 || E'    from bids b left join contacts c on c.id = b.bidder_contact_id\n'
 || E'                left join companies co on co.id = b.bidder_company_id\n');
  out_ := replace(out_,
    E'        ''id'', bb.id, ''bidder'', bb.bidder, ''bidder_contact_id'', bb.bidder_contact_id, ''status'', bb.status,\n',
    E'        ''id'', bb.id, ''bidder'', bb.bidder, ''person'', bb.person,\n'
 || E'        ''bidder_contact_id'', bb.bidder_contact_id, ''status'', bb.status,\n');
  if out_ = src or position('co.company_name' in out_) = 0 then
    raise exception 'portal_bid_compare has drifted - the bidder block was not found';
  end if;
  execute out_;
end $patch$;

-- ---------------------------------------------------------------------------
-- AWARDING PUTS THE WINNER ON THE JOB. "Only the one awarded gets added to
-- the task in the project" - so the award writes the contract and the seat
-- rather than leaving it as something to remember afterwards. The others
-- are already marked not awarded by the lines above it; nothing is sent to
-- them, which is Shahar's choice: you ring them.
do $patch$
declare src text; out_ text;
begin
  src := pg_get_functiondef('public.portal_bid_award(uuid, uuid, text)'::regprocedure);
  out_ := replace(src,
    E'declare pk public.bid_packages; b public.bids;\n',
    E'declare pk public.bid_packages; b public.bids; v_seat jsonb; v_contract uuid;\n');
  out_ := replace(out_,
    E'  return jsonb_build_object(''ok'', true, ''package_id'', pk.id, ''bid_id'', b.id,\n',
    E'  -- THE WINNER JOINS THE JOB (migration 177).\n'
 || E'  if b.bidder_contact_id is not null then\n'
 || E'    v_seat := public.portal_award_trade(pk.project_id, b.bidder_contact_id, pk.trade,\n'
 || E'      ''Won the bid'' || coalesce('' for '' || pk.trade, '''') || ''.'', null, true);\n'
 || E'    if coalesce((v_seat->>''ok'')::boolean, false) then\n'
 || E'      v_contract := (v_seat->>''contract_id'')::uuid;\n'
 || E'      update public.bids set contract_id = v_contract where id = b.id;\n'
 || E'      update public.bid_packages set contract_id = v_contract where id = pk.id;\n'
 || E'      if b.amount is not null then\n'
 || E'        update public.contracts set amount = coalesce(amount, b.amount) where id = v_contract;\n'
 || E'      end if;\n'
 || E'    end if;\n'
 || E'  end if;\n\n'
 || E'  return jsonb_build_object(''ok'', true, ''package_id'', pk.id, ''bid_id'', b.id,\n'
 || E'    ''contract_id'', v_contract, ''seated'', coalesce((v_seat->>''ok'')::boolean, false),\n'
 || E'    ''seat_note'', v_seat->>''reason'',\n');
  if out_ = src or position('portal_award_trade' in out_) = 0 then
    raise exception 'portal_bid_award has drifted - a block to patch was not found';
  end if;
  execute out_;
end $patch$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);

-- ---------------------------------------------------------------------------
-- Applied as follow-on steps, each its own named migration, each a thing the
-- live schema taught this file:
--
--   177b  ONE ROW PER TRADE on the board. A trade with a base contract and a
--         change order appeared twice. distinct on (trade), largest amount
--         first. Also joins Landscaping, Hardscaping and HVAC to the job -
--         three trades Shahar named as done that were not on the job at all.
--
--   177c  ONE CONTRACT CAN COVER SEVERAL TRADES. Marcel's GB The Landscapers
--         agreement carries his demo, his landscaping and his hardscaping;
--         the contract names one trade, so the board called two of the three
--         "not started". project_participants is the table for exactly this
--         (rulebook 15) and is now the board's second source AND the award's
--         second write. Marcel's two trades recorded against his contract.
--
--   177d  A BIDDER IS A SERVICE PROVIDER BY CLASS, not by contact type.
--         contact_types holds relationships (Friend, Family, Municipal);
--         what a contractor IS lives in party_class_links.
--
--   177e  bids.package is NOT NULL - the package's name in words, from
--         before bid_packages existed. It takes the room's trade.
--
-- Set up live on 55 Walnut's New build after the migration: the Roofing room
-- with Diego in it and twelve scope lines, and CH Mechanical added to the
-- Stairs room beside Blaka and Jerry. The board reads 21 won, 2 open, 2 not
-- started (HVAC, whose participant note names the bids that came in, and
-- Bill Negotiator).
