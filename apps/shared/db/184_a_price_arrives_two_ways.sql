-- 184: A PRICE ARRIVES TWO WAYS, AND ONE OF THEM NEEDS NO ACCOUNT.
--
-- Shahar (2026-09-17), settling how a bid gets answered:
--   "Path 1: PM/GC document on his behalf the pricing
--    Path 2: Link is shared with the contractor where he can log his price
--            even without loging into the system"
--
-- PATH 1 ALREADY WORKED - portal_bid_reply, from the room. PATH 2 did not
-- exist at all: the only door for a bidder was /my/bid/<id>, which needs an
-- account, so the man you met this morning could not answer and you typed his
-- number in for him. That is why the comparison table has been fed by you
-- rather than by them.
--
-- THE SHAPE IS ONE THIS DATABASE ALREADY USES TWICE - site check-in
-- (checkin_context / checkin_submit) and vendor self-service: a uuid in a
-- link, anon functions that take that uuid, and nothing else. The token IS
-- the credential, so everything below follows from that:
--
--   * it is per BID, not per package - Diego's link shows Diego's bid and
--     cannot become Blaka's;
--   * it never returns another bidder's price, the budget, or the ADDRESS
--     (migration 008: the address waits for the award). The town, always;
--   * it dies when you revoke it, and it refuses once the room is closed;
--   * opening it is recorded, so "sent, not opened" and "opened, no answer"
--     are different facts on the board - the second is a person deciding not
--     to price it, which is worth knowing.
--
-- ONE PIECE OF LOGIC, TWO DOORS. The rule that a reply missing a required
-- scope line is not like for like lived inside portal_bid_reply. If the token
-- door re-implemented it the two would drift, and the comparison would be
-- honest about one kind of reply and not the other. So it moves into
-- bid_record_reply, which is granted to NOBODY: both doors check who is
-- knocking in their own way and then call the same body.

alter table public.bids
  add column if not exists reply_token     uuid,
  add column if not exists token_created_at timestamptz,
  add column if not exists token_sent_at    timestamptz,
  add column if not exists token_opened_at  timestamptz,
  add column if not exists token_revoked_at timestamptz;

create unique index if not exists uq_bids_reply_token on public.bids (reply_token) where reply_token is not null;

comment on column public.bids.reply_token is
  'The bearer credential in a shared link: whoever holds it may price THIS bid without an account. Never returns the address or another bidder. Revoke by setting token_revoked_at.';

-- ---------------------------------------------------------------------------
-- THE ONE BODY BOTH DOORS CALL. No permission check of its own on purpose -
-- it is granted to nobody and reachable only from the two functions that do
-- check. Everything about what a reply MEANS lives here.
create or replace function public.bid_record_reply(
  p_bid uuid, p_line_items jsonb, p_terms_reply jsonb, p_insurance_reply jsonb,
  p_amount numeric, p_valid_until date, p_notes text, p_by text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare b public.bids; bp public.bid_packages; gaps text;
begin
  select * into b from public.bids where id = p_bid;
  if b.id is null then return jsonb_build_object('ok', false, 'reason', 'No such bid.'); end if;
  select * into bp from public.bid_packages where id = b.package_id;
  if coalesce(bp.status, 'open') <> 'open' or bp.awarded_bid_id is not null then
    return jsonb_build_object('ok', false, 'code', 'CLOSED',
      'reason', 'This package is not open for replies.');
  end if;
  if b.status in ('not awarded', 'awarded') then
    return jsonb_build_object('ok', false, 'code', 'SETTLED',
      'reason', 'This bid is already settled.');
  end if;

  -- A required line nobody ticked is a gap, and gaps are what make a price
  -- something other than like for like.
  select string_agg(s.item, '; ') into gaps
    from public.bid_package_items i
    join public.project_scope_items s on s.id = i.scope_item_id
   where i.package_id = bp.id and i.is_required
     and not coalesce((select (li->>'included')::boolean
                         from jsonb_array_elements(coalesce(p_line_items, '[]'::jsonb)) li
                        where li->>'scope_item_id' = i.scope_item_id::text limit 1), false);

  update public.bids set
    line_items = coalesce(p_line_items, line_items),
    terms_reply = coalesce(p_terms_reply, terms_reply),
    insurance_reply = coalesce(p_insurance_reply, insurance_reply),
    amount = coalesce(p_amount, amount),
    valid_until = coalesce(p_valid_until, valid_until),
    notes = coalesce(nullif(btrim(p_notes), ''), notes),
    status = case when status = 'invited' then 'received' else status end,
    received_on = coalesce(received_on, current_date),
    is_like_for_like = (gaps is null), scope_gaps = gaps,
    last_modified_at = now(), last_modified_by = coalesce(p_by, 'portal:bid')
  where id = p_bid;

  return jsonb_build_object('ok', true, 'like_for_like', gaps is null, 'gaps', gaps);
end $$;
revoke all on function public.bid_record_reply(uuid, jsonb, jsonb, jsonb, numeric, date, text, text) from public, anon, authenticated;

-- PATH 1, unchanged from the outside: the bidder themselves signed in, or
-- whoever runs the job writing it down for them.
create or replace function public.portal_bid_reply(
  p_bid uuid, p_line_items jsonb, p_terms_reply jsonb, p_insurance_reply jsonb,
  p_amount numeric, p_valid_until date, p_notes text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare b public.bids;
begin
  select * into b from public.bids where id = p_bid;
  if b.id is null then return jsonb_build_object('ok', false, 'reason', 'No such bid.'); end if;
  if not (b.bidder_contact_id = public.bid_my_contact() or public.bid_can_manage(b.project_id)) then
    return jsonb_build_object('ok', false, 'reason', 'Replying here is not yours to do.');
  end if;
  return public.bid_record_reply(p_bid, p_line_items, p_terms_reply, p_insurance_reply,
                                 p_amount, p_valid_until, p_notes, 'portal:bid');
end $$;
revoke all on function public.portal_bid_reply(uuid, jsonb, jsonb, jsonb, numeric, date, text) from public, anon;
grant execute on function public.portal_bid_reply(uuid, jsonb, jsonb, jsonb, numeric, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- THE LINK. Minted on demand by whoever runs the bid, and the same link every
-- time until it is revoked - so a text sent twice does not create two doors.
create or replace function public.portal_bid_link(p_bid uuid, p_revoke boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare b public.bids; bp public.bid_packages; v_token uuid; v_who text; v_town text;
begin
  perform public.assert_own_hands();
  select * into b from public.bids where id = p_bid;
  if b.id is null or not public.bid_can_manage(b.project_id) then
    return jsonb_build_object('ok', false, 'reason', 'That bid is not yours to send.');
  end if;
  select * into bp from public.bid_packages where id = b.package_id;

  if p_revoke then
    update public.bids set token_revoked_at = now(), last_modified_at = now(),
                           last_modified_by = 'portal:bid-link'
     where id = p_bid;
    return jsonb_build_object('ok', true, 'revoked', true);
  end if;

  v_token := b.reply_token;
  if v_token is null or b.token_revoked_at is not null then
    v_token := gen_random_uuid();
    update public.bids set reply_token = v_token, token_created_at = now(), token_revoked_at = null,
                           last_modified_at = now(), last_modified_by = 'portal:bid-link'
     where id = p_bid;
  end if;

  v_who := coalesce((select co.company_name from public.companies co where co.id = b.bidder_company_id),
                    (select coalesce(ct.person_name, ct.name) from public.contacts ct where ct.id = b.bidder_contact_id));
  v_town := public.project_town(b.project_id);

  return jsonb_build_object('ok', true, 'token', v_token, 'who', v_who,
    'trade', coalesce(b.trade, bp.trade), 'town', v_town,
    'reply_by', bp.reply_by,
    'phone', (select ct.phone from public.contacts ct where ct.id = b.bidder_contact_id),
    'email', (select ct.email_a from public.contacts ct where ct.id = b.bidder_contact_id),
    'sent_at', b.token_sent_at, 'opened_at', b.token_opened_at,
    -- The words to send. Written here so every door says the same thing.
    'message', 'Hi' || coalesce(' ' || (select coalesce(ct.person_name, ct.name) from public.contacts ct where ct.id = b.bidder_contact_id), '')
               || ' - here is the ' || lower(coalesce(b.trade, bp.trade, 'work')) || ' scope for the job in '
               || coalesce(v_town, 'Bergen County') || '. You can put your price straight in, no login needed'
               || coalesce(', by ' || to_char(bp.reply_by, 'Mon DD'), '') || '.');
end $$;
revoke all on function public.portal_bid_link(uuid, boolean) from public, anon;
grant execute on function public.portal_bid_link(uuid, boolean) to authenticated;

-- Marking it sent is a separate act from minting it: you can copy a link and
-- never send it, and the board should not claim otherwise.
create or replace function public.portal_bid_link_sent(p_bid uuid, p_how text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare b public.bids;
begin
  perform public.assert_own_hands();
  select * into b from public.bids where id = p_bid;
  if b.id is null or not public.bid_can_manage(b.project_id) then
    return jsonb_build_object('ok', false, 'reason', 'That bid is not yours to send.');
  end if;
  update public.bids set token_sent_at = now(), last_modified_at = now(),
                         last_modified_by = coalesce('portal:bid-link:' || p_how, 'portal:bid-link')
   where id = p_bid;
  return jsonb_build_object('ok', true, 'sent_at', now());
end $$;
revoke all on function public.portal_bid_link_sent(uuid, text) from public, anon;
grant execute on function public.portal_bid_link_sent(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- PATH 2, THE ANON READ. Everything the person pricing the work needs, and
-- nothing that belongs to anybody else: no other bidder, no budget, no
-- address. The town, because a price depends on where the work is.
create or replace function public.bid_by_token(p_token uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare b public.bids; bp public.bid_packages; v_open boolean;
begin
  select * into b from public.bids where reply_token = p_token and token_revoked_at is null;
  if b.id is null then return null; end if;
  select * into bp from public.bid_packages where id = b.package_id;
  if bp.id is null then return null; end if;

  -- Opening it is a fact worth keeping: sent-and-never-opened and
  -- opened-and-never-answered are different problems.
  if b.token_opened_at is null then
    update public.bids set token_opened_at = now() where id = b.id;
  end if;

  v_open := coalesce(bp.status, 'open') = 'open' and bp.awarded_bid_id is null
            and b.status not in ('not awarded', 'awarded');

  return jsonb_build_object(
    'open', v_open,
    'settled', b.status in ('not awarded', 'awarded'),
    'you', coalesce((select co.company_name from public.companies co where co.id = b.bidder_company_id),
                    (select coalesce(ct.person_name, ct.name) from public.contacts ct where ct.id = b.bidder_contact_id)),
    'person', (select coalesce(ct.person_name, ct.name) from public.contacts ct where ct.id = b.bidder_contact_id),
    'from', coalesce((select c.company_name from public.companies c
                       join public.projects p on p.entity_company_id = c.id where p.id = b.project_id),
                     'Green Bergen'),
    'job', public.project_label_no_address(b.project_id),
    'town', public.project_town(b.project_id),
    'trade', coalesce(b.trade, bp.trade),
    'reply_by', bp.reply_by,
    'scope_summary', bp.scope_summary,
    'terms', jsonb_build_object('deposit_pct', bp.deposit_pct, 'retainage_pct', bp.retainage_pct,
                                'net_days', bp.net_days, 'workers_comp', bp.insurance_workers_comp,
                                'coi', bp.coi_required),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
                'scope_item_id', i.scope_item_id, 'item', s.item, 'is_required', i.is_required,
                'included', coalesce((select (li->>'included')::boolean
                                        from jsonb_array_elements(coalesce(b.line_items, '[]'::jsonb)) li
                                       where li->>'scope_item_id' = i.scope_item_id::text limit 1), true))
              order by i.sort, s.item)
              from public.bid_package_items i
              join public.project_scope_items s on s.id = i.scope_item_id
             where i.package_id = bp.id), '[]'::jsonb),
    'said', case when b.amount is not null or b.notes is not null then jsonb_build_object(
              'amount', b.amount, 'valid_until', b.valid_until, 'notes', b.notes,
              'on', b.received_on) end);
end $$;
revoke all on function public.bid_by_token(uuid) from public;
grant execute on function public.bid_by_token(uuid) to anon, authenticated;

-- PATH 2, THE ANON WRITE. The token is the credential; everything else is the
-- same rule as path 1, because it is literally the same body.
create or replace function public.bid_reply_by_token(
  p_token uuid, p_amount numeric, p_valid_until date default null,
  p_notes text default null, p_line_items jsonb default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare b public.bids;
begin
  select * into b from public.bids where reply_token = p_token and token_revoked_at is null;
  if b.id is null then
    return jsonb_build_object('ok', false, 'reason', 'This link is no longer live. Ask for a new one.');
  end if;
  if p_amount is null or p_amount < 0 then
    return jsonb_build_object('ok', false, 'reason', 'Put your price in first.');
  end if;
  if length(coalesce(p_notes, '')) > 2000 then
    return jsonb_build_object('ok', false, 'reason', 'That note is too long.');
  end if;

  return public.bid_record_reply(b.id, p_line_items, null, null,
                                 p_amount, p_valid_until, p_notes, 'link:bidder');
end $$;
revoke all on function public.bid_reply_by_token(uuid, numeric, date, text, jsonb) from public;
grant execute on function public.bid_reply_by_token(uuid, numeric, date, text, jsonb) to anon, authenticated;

comment on function public.bid_reply_by_token(uuid, numeric, date, text, jsonb) is
  'Path 2: a contractor prices the work from a shared link with no account. The token is the credential; the body is bid_record_reply, the same one the signed-in door uses, so a reply means the same thing whichever way it arrived.';

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);

-- ---------------------------------------------------------------------------
-- APPLIED AS 184a-184f. What the later letters added, and why:
--
-- 184c THE ENTITY IS NAMED AFTER THE HOUSE. The first cut said who the bid was
-- from by naming the project's paying entity - which on 55 Walnut is
-- "NP 55 Walnut DR, Tenafly LLC". That put the street address on the one page
-- migration 008 exists to keep it off. Caught by asking the read whether its
-- own output contained the street. It now names the PERSON who runs the job
-- (Diego met Shahar, not an LLC) and the platform as the company.
--
-- 184d WHAT SILENCE ON THE TICKS MEANS. bid_record_reply reads a missing line
-- as not included, which is right for the signed-in form - it sends one entry
-- per line, ticked, so an absent one was deliberately unticked. Through the
-- link the same silence means the opposite: a man who typed a number and
-- touched nothing is pricing the scope as written. The link door fills the
-- ticks in before handing over.
--
-- 184e EVERY BID GETS ITS LINK AT BIRTH, from a trigger rather than from each
-- door that creates a bid - four places to forget became one that cannot be
-- gone round. Existing bids were backfilled. The same patch made the room name
-- the FIRM with the person beside it, which is what the comparison already did.
--
-- 184f THE WORDS TO SEND come from the database, beside the token, so the room
-- and any later door say the same sentence.
