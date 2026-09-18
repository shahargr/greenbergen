-- 191: HOW THE WORK WAS LET.
--
-- A contract says who is doing the work and for how much. It has never said
-- HOW they came to be the one doing it - and those are different questions
-- with different consequences. Three routes:
--
--   bid          they won a room: others were asked, and the comparison is
--                on file next to the price
--   direct       we went straight to somebody we have used before. Shahar
--                (2026-09-17): "often times we work with the same people and
--                already secured price." Legitimate and common - it is not a
--                lesser route, it is a different one.
--   sole_source  nobody else could have done it: the only firm who carries
--                the licence, the manufacturer's own installer, the utility.
--                Worth its own word because it needs a REASON, and because
--                "we only asked one" and "only one exists" are not the same
--                sentence when somebody reads this back in a year.
--
-- WHY IT MATTERS. This is the row an owner, a lender or an insurer asks
-- about. A direct award with the reason written down is a decision; the same
-- award with nothing written is a hole in the record.
--
-- Applied as 191a and 191b.

-- ---------------------------------------------------------------------------
-- 191a  The column, and the backfill
-- ---------------------------------------------------------------------------
alter table public.contracts
  add column if not exists award_route text,
  add column if not exists award_route_note text,
  add column if not exists award_route_source text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_contract_award_route') then
    alter table public.contracts add constraint chk_contract_award_route
      check (award_route is null or award_route in ('bid', 'direct', 'sole_source'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'chk_contract_award_route_source') then
    alter table public.contracts add constraint chk_contract_award_route_source
      check (award_route_source is null or award_route_source in ('stated', 'backfilled'));
  end if;
end $$;

comment on column public.contracts.award_route is
  'How this work came to this firm: bid (won a room), direct (went straight to somebody we use), sole_source (nobody else could have done it). NULL on a contract nobody has said.';
comment on column public.contracts.award_route_source is
  'stated = somebody said so when the work was awarded. backfilled = migration 191 inferred it from the record, and it is a guess worth re-checking.';
comment on column public.contracts.award_route_note is
  'Why this route - required in spirit for sole_source, where "nobody else could have done it" is a claim somebody has to stand behind.';

-- THE BACKFILL, and it is honest about what it does not know.
--
-- A contract carrying a bid_package_id demonstrably won a room, so it is a
-- bid and that is a fact. Everything else is marked DIRECT and SOURCE
-- BACKFILLED - because what we actually know is "not let through a room in
-- this system", which is not the same as "we chose not to compete it". The
-- source column is what keeps that distinction readable instead of letting a
-- guess harden into a fact.
--
-- On the day it ran: 40 payable contracts, 0 of them carrying a
-- bid_package_id - every award ever made here was let outside a bid room.
-- 36 live awards were marked; the 3 placeholders and 1 cancelled were left
-- alone, because nothing was awarded on those.
update public.contracts
   set award_route = 'bid', award_route_source = 'backfilled'
 where direction = 'payable' and bid_package_id is not null and award_route is null;

update public.contracts
   set award_route = 'direct', award_route_source = 'backfilled'
 where direction = 'payable' and bid_package_id is null and award_route is null
   and lower(coalesce(status, '')) in ('signed', 'awarded', 'active', 'complete');

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);

-- ---------------------------------------------------------------------------
-- 191b  A new award states its own route
-- ---------------------------------------------------------------------------
-- The backfill above is a guess with its own word for "guess". From here on
-- the route is stated, and the two paths state it differently:
--
--   through a bid room  nobody needs to be asked. Winning a room IS the
--                       route, the comparison is on file beside it, and the
--                       contract can say so itself.
--   everywhere else     somebody has to say. That is a screen question, and
--                       portal_award_route_set is what the screen calls.

-- 1. A ROOM STAMPS ITSELF. portal_bid_award already builds the contract
-- through portal_award_trade; it only has to mark how it got there. Done at
-- the same moment it writes the amount, so a contract never exists in a state
-- where it won a bid and does not know it.
do $patch$
declare src text; out_ text;
begin
  src := pg_get_functiondef('public.portal_bid_award(uuid,uuid,text)'::regprocedure);
  out_ := replace(src,
    $old$      if b.amount is not null then
        update public.contracts set amount = coalesce(amount, b.amount) where id = v_contract;
      end if;$old$,
    $new$      if b.amount is not null then
        update public.contracts set amount = coalesce(amount, b.amount) where id = v_contract;
      end if;
      -- HOW IT WAS LET (191). Winning a room is the route, and the room this
      -- bid belongs to is the evidence - no screen has to ask.
      update public.contracts
         set award_route = 'bid', award_route_source = 'stated',
             bid_package_id = coalesce(bid_package_id, pk.id)
       where id = v_contract;$new$);
  if out_ = src then raise exception 'portal_bid_award has drifted - the amount line was not found.'; end if;
  execute out_;
end $patch$;

-- 2. EVERYWHERE ELSE, SOMEBODY SAYS. Small and on its own rather than four
-- more arguments through portal_award_trade, which is already long: the route
-- is a fact ABOUT the award, recorded the moment it is made, and it stays
-- correctable afterwards without re-running the award itself.
create or replace function public.portal_award_route_set(
  p_contract uuid, p_route text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.contracts; v_route text := nullif(btrim(coalesce(p_route, '')), '');
begin
  perform public.assert_own_hands();
  select * into c from public.contracts where id = p_contract;
  if c.id is null then
    return jsonb_build_object('ok', false, 'reason', 'That contract is not on file.');
  end if;
  if not public.can_edit_project(c.project_id) then
    return jsonb_build_object('ok', false, 'reason', 'This job is not yours to change.');
  end if;
  if v_route is null or v_route not in ('bid', 'direct', 'sole_source') then
    return jsonb_build_object('ok', false, 'reason',
      'Say how it was let: won a bid, straight to somebody we use, or nobody else could do it.');
  end if;
  -- SOLE SOURCE IS A CLAIM. "Nobody else could have done it" is the one
  -- route somebody may have to stand behind later, so it does not get to be
  -- a bare word.
  if v_route = 'sole_source' and nullif(btrim(coalesce(p_note, '')), '') is null then
    return jsonb_build_object('ok', false, 'code', 'NEEDS_REASON',
      'reason', 'Say why nobody else could have done it. That is the whole difference between sole source and a direct award.');
  end if;

  update public.contracts
     set award_route = v_route,
         award_route_note = nullif(btrim(coalesce(p_note, '')), ''),
         award_route_source = 'stated',
         last_modified_by = 'portal:award'
   where id = p_contract;

  return jsonb_build_object('ok', true, 'route', v_route);
end $$;
revoke all on function public.portal_award_route_set(uuid, text, text) from public, anon;
grant execute on function public.portal_award_route_set(uuid, text, text) to authenticated;

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
