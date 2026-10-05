-- 245 AN AWARD GOES THROUGH THE AWARD
--
-- Shahar (2026-10-05): Claude Chat "created a bid for stairs and also
-- awarded" it - and nothing showed. It had INSERTed the contract straight
-- into contracts: no trade, no link to the open Stairs room, the contractor
-- written as OUR signer, no created_by, no seat - while the room stayed
-- open with the winner still "invited". Repaired the same day through
-- portal_award_trade + portal_bid_award. Asked "what guardrails can be
-- implemented so chat cannot bypass this?" he chose two: checks in the
-- database that refuse such a write from anyone (this file), and a rulebook
-- rule (section 72, below).
--
-- THE CHECKS, on a payable construction trade contract that is past
-- placeholder (a placeholder is a shell waiting for its award; a change
-- order has its own path, change_order_request):
--   1. it names a catalogue trade - screens find contracts by trade;
--   2. its signer is not its own counterparty - the signer is our side;
--   3. INSERTED already awarded while an open room exists for that trade on
--      the job, it must carry that room (bid_package_id) - otherwise the room
--      is left open with its winner "invited"; award the bid instead;
--   4. INSERTED with a created_by - every function stamps one, so a row
--      without it came in by hand.
-- And on bid_packages: a room marked awarded names the winning bid
-- (awarded_bid_id) - the only thing portal_bid_award ever writes.
--
-- Measured before enforcing (2026-10-05): zero existing rows break 1-3 or
-- the room rule; the one contract missing created_by is the stairs repair,
-- stamped below. Every function that inserts contracts already satisfies
-- all four (homeowner_offer_accept carries trade, room and created_by;
-- the shells and seat triggers insert placeholders).

-- RULEBOOK 72, FULL TEXT (the live row holds the first sentence and a pointer
-- here - long writes to rulebook hung the connector on 2026-10-05):
--   Contracts, bid rooms, bids, seats and payments are written ONLY through
--   the functions the screens use. Chat and Code hold a connection that can
--   write any table; that is a tool for repairs and migrations, not a way to
--   do business. One award touches the room, every bid in it, the contract,
--   the trade, the seat, the budget line and the working line; a hand-written
--   row does one of those and leaves the rest lying.
--   THE MAP: start a bid - portal_bid_room_open. Award a room -
--   portal_bid_award(package, bid). Award with no room - portal_award_trade.
--   Shell contract - portal_contract_shell. Change order -
--   change_order_request. Payment - the ledger functions (help: transactions).
--   If no function does the job, SAY SO to Shahar and build one; do not write
--   the rows. A repair that must touch rows directly is announced first,
--   stamps last_modified_by, and calls the functions wherever one exists.
--
update public.contracts set created_by = 'claude-chat (direct insert, repaired 2026-10-05)'
 where id = 'ebe14a78-4d6b-4b54-956b-30c4e323978b' and created_by is null;

create or replace function public.fn_contracts_award_guard()
returns trigger language plpgsql set search_path to 'public' as $function$
declare v_room uuid;
begin
  if new.direction <> 'payable'
     or new.contract_type is distinct from 'construction trade contract'
     or coalesce(new.status, '') in ('placeholder', 'Cancelled') then
    return new;
  end if;

  if new.trade is null or not exists (select 1 from public.trades t where t.trade = new.trade) then
    raise exception 'A % trade contract must name a catalogue trade (got %).', coalesce(new.status, 'live'), coalesce('"' || new.trade || '"', 'none')
      using errcode = 'check_violation',
            hint = 'Award through portal_award_trade / portal_bid_award, which set the trade. Never insert a contract by hand (rulebook 72).';
  end if;

  if new.signer_contact_id is not null
     and new.signer_contact_id in (coalesce(new.counterparty_contact_id, '00000000-0000-0000-0000-000000000000'::uuid),
                                   coalesce(new.contractor_id, '00000000-0000-0000-0000-000000000000'::uuid)) then
    raise exception 'The signer of "%" is its own counterparty. The signer is our side - the entity paying.', new.title
      using errcode = 'check_violation', hint = 'Rulebook 72.';
  end if;

  if tg_op = 'INSERT' then
    if nullif(btrim(coalesce(new.created_by, '')), '') is null then
      raise exception 'Contract "%" was inserted with no created_by - only the portal functions create contracts.', new.title
        using errcode = 'check_violation',
              hint = 'Use portal_award_trade (direct award) or portal_bid_award (award a bid room). Rulebook 72.';
    end if;
    if new.bid_package_id is null and new.project_id is not null then
      select bp.id into v_room from public.bid_packages bp
       where bp.project_id = new.project_id and lower(bp.trade) = lower(new.trade)
         and coalesce(bp.status, '') = 'open'
       limit 1;
      if v_room is not null then
        raise exception 'A % bid room is open on this job (%). Award its bid instead of writing a contract beside it.', new.trade, v_room
          using errcode = 'check_violation',
                hint = 'Record the winner''s price on the bid, then portal_bid_award(package, bid). Rulebook 72.';
      end if;
    end if;
  end if;
  return new;
end $function$;

drop trigger if exists trg_contracts_award_guard on public.contracts;
-- Named to sort after trg_contracts_canonical_trade, so the trade it checks
-- is already the catalogue spelling.
create trigger trg_contracts_award_guard before insert or update on public.contracts
  for each row execute function public.fn_contracts_award_guard();

create or replace function public.fn_bid_packages_award_guard()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if new.status = 'awarded' and new.awarded_bid_id is null then
    raise exception 'The % room cannot be marked awarded without a winning bid.', coalesce(new.trade, 'bid')
      using errcode = 'check_violation',
            hint = 'portal_bid_award(package, bid) marks the room, the bids, the contract and the seat together. Rulebook 72.';
  end if;
  return new;
end $function$;

drop trigger if exists trg_bid_packages_award_guard on public.bid_packages;
create trigger trg_bid_packages_award_guard before insert or update of status, awarded_bid_id on public.bid_packages
  for each row execute function public.fn_bid_packages_award_guard();

revoke execute on function public.fn_contracts_award_guard() from public, anon, authenticated;
revoke execute on function public.fn_bid_packages_award_guard() from public, anon, authenticated;

-- RULEBOOK 72 (security family, next free number).
insert into public.rulebook (section_key, title, body, sort_order, created_by, updated_at)
values ('72_write_through_functions',
  'Business records are written through their functions - never by hand',
  'CONTRACTS, BID ROOMS, BIDS, SEATS AND PAYMENTS ARE WRITTEN ONLY THROUGH THE FUNCTIONS THE SCREENS USE. Chat and Code hold a connection that can write any table; that is a tool for repairs and migrations, not a way to do business. The functions are where the rules live - one award touches the room, every bid in it, the contract, the trade, the seat, the budget line and the working line, and a hand-written row does one of those and leaves the rest lying.' || E'\n\n' ||
  'THE MAP. Start a bid: portal_bid_room_open. Record a reply: the bid room screen (its price goes on the bid). Award a room: portal_bid_award(package, bid). Award without a room: portal_award_trade. A shell contract: portal_contract_shell. A change order: change_order_request. A payment: the ledger functions (help topic transactions). If no function does what is needed, SAY SO to Shahar and build one - do not write the rows.' || E'\n\n' ||
  'THE EVIDENCE (2026-10-05). Chat was asked for a stairs bid and award, and inserted the contract by hand: no trade, no link to the open Stairs room, the contractor written as OUR signer, no created_by, no seat. It reported success; the screens showed nothing, and the room stayed open with the winner still invited. It took the award functions to repair it.' || E'\n\n' ||
  'THE DATABASE NOW REFUSES THE WORST OF IT (migration 245): a live trade contract with no catalogue trade, a signer who is the counterparty, a contract inserted without created_by, one inserted awarded beside an open room for the same trade, and a room marked awarded with no winning bid. The error says which function to use. Those checks are a floor, not the rule - the rule is this section. A REPAIR that must touch rows directly is announced to Shahar first, stamps last_modified_by, and calls the functions wherever one exists.',
  '72', 'claude-code', now())
on conflict (section_key) do nothing;

-- The family ranges named in 00 and 01 grow with it.
update public.rulebook set body = replace(body, '70-71 security', '70-72 security'), updated_at = now()
 where section_key in ('00_purpose', '01_session_start') and body like '%70-71 security%';

update public.config set schema_version = schema_version + 1, schema_updated_at = current_date;
