-- AN AWARD CAN BE UNDONE - WHILE IT IS STILL ONLY A DECISION.
--
-- Shahar, 2026-09-21, on the bid lifecycle: "fix all gaps."
--
-- portal_bid_award refuses a second award with "This package is already
-- awarded", and nothing in the database could clear that. Award the wrong
-- bidder and the room was finished: no un-award, no reopen. The only way
-- back was portal_bid_package_save, which takes a status and has no awarded
-- guard - a back door that silently leaves a contract, a seat and a set of
-- losing bids all still pointing at the award you thought you had undone.
--
-- WHAT MAKES THIS SAFE IS THE REFUSAL, NOT THE UNDO. An award is reversible
-- only while it is still a decision. The moment money moves against the
-- contract it made, or work is filed under it, the award is a fact about
-- the world and no button should pretend otherwise. So this checks three
-- things and names the number it found rather than saying "cannot".
--
-- THE PRIOR STATUS IS READ, NOT GUESSED. Awarding sets the winner to
-- 'awarded' and every other replied bid to 'not awarded' - losing whether
-- each one had been 'received' or 'under negotiation'. change_events already
-- records every status change with its from_value and its actor, so the undo
-- restores exactly what was there (rulebook 34: derive it rather than store
-- a second copy). Failing a log entry it falls back to 'received', which is
-- the only status a bid must have had to be awardable at all.
--
-- THE SEAT IS LEFT ALONE, deliberately. Awarding seats the winner on the job
-- through portal_award_trade, and by the time you are undoing this they may
-- already have been assigned work. Quietly revoking a seat is how tasks end
-- up owned by nobody. The reply says whose seat stayed so it can be dealt
-- with on the team screen, as a decision rather than a side effect.
--
-- NOTE: this version compares change_events.row_id (TEXT) against a uuid and
-- throws 42883 on its first real call. 211 adds the casts. Kept as applied,
-- because a migration is a record of what happened.
create or replace function public.portal_bid_unaward(p_pkg uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  pk        public.bid_packages;
  b         public.bids;
  v_why     text := nullif(btrim(coalesce(p_reason, '')), '');
  v_paid    numeric;
  v_txns    int;
  v_stages  int;
  v_tasks   int;
  v_back    text;
  v_who     text;
  v_seat    boolean := false;
  v_restored int := 0;
  r         record;
begin
  perform public.assert_own_hands();

  select * into pk from public.bid_packages where id = p_pkg for update;
  if pk.id is null or not public.bid_can_manage(pk.project_id) then
    return jsonb_build_object('ok', false, 'reason', 'Undoing an award on this package is not yours to do.');
  end if;
  if pk.awarded_bid_id is null then
    return jsonb_build_object('ok', false, 'reason', 'This package has not been awarded, so there is nothing to undo.');
  end if;
  -- Undoing a commercial decision without saying why leaves the next person
  -- reading the room with no idea what happened.
  if v_why is null then
    return jsonb_build_object('ok', false, 'reason', 'Say why the award is being undone - it goes on the record.');
  end if;

  select * into b from public.bids where id = pk.awarded_bid_id;
  select coalesce(c.person_name, c.name) into v_who
    from public.contacts c where c.id = b.bidder_contact_id;

  -- ONCE MONEY HAS MOVED, THE AWARD IS A FACT. Each refusal names what it
  -- found, because "cannot undo" with no number is the least useful thing a
  -- screen can say to somebody who knows they picked the wrong man.
  if b.contract_id is not null then
    select count(*), coalesce(sum(t.amount), 0) into v_txns, v_paid
      from public.transactions t where t.contract_id = b.contract_id;
    if v_txns > 0 then
      return jsonb_build_object('ok', false, 'reason',
        format('%s %s already logged against this contract, totalling $%s. The award cannot be undone - end the contract instead.',
               v_txns, case when v_txns = 1 then 'payment is' else 'payments are' end, round(v_paid)));
    end if;

    select count(*) into v_stages
      from public.payment_stages s
     where s.contract_id = b.contract_id and coalesce(s.status, '') ilike '%paid%';
    if v_stages > 0 then
      return jsonb_build_object('ok', false, 'reason',
        format('%s payment stage%s on this contract %s already been claimed. End the contract rather than undoing the award.',
               v_stages, case when v_stages = 1 then '' else 's' end,
               case when v_stages = 1 then 'has' else 'have' end));
    end if;

    select count(*) into v_tasks
      from public.actions a
     where a.contract_id = b.contract_id
       and a.status not in ('Cancelled', 'Force Cancelled');
    if v_tasks > 0 then
      return jsonb_build_object('ok', false, 'reason',
        format('%s task%s filed under this contract. Move or cancel %s first - undoing the award would leave %s with no contract behind %s.',
               v_tasks, case when v_tasks = 1 then ' is' else 's are' end,
               case when v_tasks = 1 then 'it' else 'them' end,
               case when v_tasks = 1 then 'it' else 'them' end,
               case when v_tasks = 1 then 'it' else 'them' end));
    end if;
  end if;

  -- THE WINNER GOES BACK TO WHERE HE WAS. change_events knows: awarding
  -- wrote one row per bid with the status it came from.
  select ce.from_value into v_back
    from public.change_events ce
   where ce.table_name = 'bids' and ce.row_id = b.id and ce.field = 'status'
     and ce.actor = 'portal:award' and ce.to_value = 'awarded'
   order by ce.at desc limit 1;

  update public.bids
     set won = false,
         status = coalesce(v_back, 'received'),
         notes = coalesce(notes || E'\n\n', '') || 'AWARD UNDONE ' || to_char(current_date, 'YYYY-MM-DD') || ': ' || v_why,
         contract_id = null,
         last_modified_at = now(), last_modified_by = 'portal:unaward'
   where id = b.id;

  -- AND SO DOES EVERYONE THIS AWARD KNOCKED OUT. Only the ones this award
  -- itself set to 'not awarded' - a bidder who lost on his own merits before
  -- the award, or who was marked lost by hand, stays lost.
  for r in
    select ce.row_id, ce.from_value
      from public.change_events ce
      join public.bids x on x.id = ce.row_id
     where ce.table_name = 'bids' and ce.field = 'status'
       and ce.actor = 'portal:award' and ce.to_value = 'not awarded'
       and x.package_id = pk.id and x.status = 'not awarded'
       and ce.at >= (select max(y.at) from public.change_events y
                      where y.table_name = 'bids' and y.row_id = b.id
                        and y.actor = 'portal:award' and y.to_value = 'awarded')
  loop
    update public.bids
       set status = coalesce(r.from_value, 'received'),
           not_awarded_reason = case when not_awarded_reason like 'Another bid was awarded on %'
                                     then null else not_awarded_reason end,
           last_modified_at = now(), last_modified_by = 'portal:unaward'
     where id = r.row_id;
    v_restored := v_restored + 1;
  end loop;

  -- THE ROOM REOPENS.
  update public.bid_packages
     set awarded_bid_id = null, contract_id = null, status = 'open',
         last_modified_at = now(), last_modified_by = 'portal:unaward'
   where id = pk.id;

  -- THE CONTRACT THE AWARD MADE IS CANCELLED, NOT DELETED. Nothing hangs off
  -- it - the guards above proved that - but it was signed into existence by
  -- a decision that has been withdrawn, and the record of that is worth more
  -- than a tidy table.
  if b.contract_id is not null then
    update public.contracts
       set status = 'Cancelled',
           notes = coalesce(notes || E'\n\n', '') || 'Cancelled ' || to_char(current_date, 'YYYY-MM-DD')
                   || ' when the bid award behind it was undone: ' || v_why,
           last_modified_at = now(), last_modified_by = 'portal:unaward'
     where id = b.contract_id;
  end if;

  v_seat := exists (
    select 1 from public.project_members m
     where m.project_id = pk.project_id and m.contact_id = b.bidder_contact_id
       and m.status = 'active');

  return jsonb_build_object(
    'ok', true, 'package_id', pk.id, 'bid_id', b.id, 'bidder', v_who,
    'restored_to', coalesce(v_back, 'received'),
    'others_restored', v_restored,
    'contract_cancelled', b.contract_id,
    'seat_kept', v_seat,
    'note', case when v_seat
                 then coalesce(v_who, 'The bidder') || ' keeps their seat on this job. Undoing an award does not take it away, because work may already be assigned - remove it from the team screen if that is wrong.'
                 else null end);
end $fn$;

comment on function public.portal_bid_unaward(uuid, text) is
  'Undo a bid award while it is still only a decision. Refuses once a payment, a claimed payment stage or an open task hangs off the contract it created - and names how many it found. Restores every bid to the status change_events says it held before the award, reopens the room, cancels the contract, and deliberately leaves the winner''s project seat in place.';

revoke all on function public.portal_bid_unaward(uuid, text) from public, anon;
grant execute on function public.portal_bid_unaward(uuid, text) to authenticated, service_role;
