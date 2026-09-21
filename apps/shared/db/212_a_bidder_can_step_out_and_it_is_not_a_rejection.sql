-- A BIDDER CAN STEP OUT, AND THAT IS NOT THE SAME AS BEING TURNED DOWN.
--
-- chk_bid_status has allowed 'declined' and 'withdrawn' since the table was
-- made, and the bid room even COLOURS them - tag-neutral, beside 'not
-- awarded' and 'expired'. Nothing has ever set them. The only button was
-- "mark lost", which writes 'not awarded'.
--
-- So a roofer who rings to say he is too busy until spring is filed as a man
-- whose price you rejected. Next year you look at the room to decide who to
-- ask again, and the record lies to you about what happened - which is the
-- whole reason a bid room exists.
--
--   declined  - he never priced it. Too busy, too far, not his kind of work.
--   withdrawn - he priced it and then pulled the price.
--
-- Told apart on the evidence rather than trusted: a bid with no amount and
-- no reply cannot be withdrawn, because there was nothing to withdraw.
--
-- AND THE LINK CLOSES. Someone who has stepped out should not still be able
-- to post a price through a link sent last week - the room would show a
-- reply from a man who told you he was out.
create or replace function public.portal_bid_step_out(p_bid uuid, p_how text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  b        public.bids;
  pk       public.bid_packages;
  v_how    text := lower(nullif(btrim(coalesce(p_how, '')), ''));
  v_why    text := nullif(btrim(coalesce(p_reason, '')), '');
  v_who    text;
  v_replied boolean;
begin
  perform public.assert_own_hands();

  if v_how is null or v_how not in ('declined', 'withdrawn') then
    return jsonb_build_object('ok', false, 'reason',
      'Say which it was: declined (he never priced it) or withdrawn (he pulled a price he had given).');
  end if;

  select * into b from public.bids where id = p_bid;
  if b.id is null then return jsonb_build_object('ok', false, 'reason', 'No such bid.'); end if;
  select * into pk from public.bid_packages where id = b.package_id;
  if pk.id is null or not public.bid_can_manage(pk.project_id) then
    return jsonb_build_object('ok', false, 'reason', 'Changing this room is not yours to do.');
  end if;

  if coalesce(b.won, false) then
    return jsonb_build_object('ok', false, 'reason',
      'This is the bid that won. Undo the award first if he is stepping out.');
  end if;
  if pk.awarded_bid_id is not null then
    return jsonb_build_object('ok', false, 'reason',
      'This room is already decided. Who stepped out before the award is history now - undo the award if it needs changing.');
  end if;

  -- Withdrawing means taking something back, so there has to be something.
  v_replied := b.amount is not null or b.received_on is not null
               or b.status in ('received', 'under negotiation');
  if v_how = 'withdrawn' and not v_replied then
    return jsonb_build_object('ok', false, 'reason',
      'He never gave a price, so there is nothing to withdraw. Mark him declined instead.');
  end if;

  select coalesce(c.person_name, c.name) into v_who from public.contacts c where c.id = b.bidder_contact_id;

  update public.bids
     set status = v_how,
         won = false,
         not_awarded_reason = coalesce(v_why,
           case when v_how = 'declined' then 'Declined to bid.' else 'Withdrew the price given.' end),
         -- The link closes with him. A price arriving after this would be a
         -- reply from somebody who has already said he is out.
         token_revoked_at = coalesce(token_revoked_at, now()),
         last_modified_at = now(),
         last_modified_by = 'portal:step-out'
   where id = b.id;

  return jsonb_build_object('ok', true, 'bid_id', b.id, 'bidder', v_who, 'status', v_how,
    'had_priced', v_replied, 'link_closed', b.token_revoked_at is null and b.reply_token is not null);
end $fn$;

comment on function public.portal_bid_step_out(uuid, text, text) is
  'Record that a bidder took himself out - declined (never priced it) or withdrawn (pulled a price he had given) - rather than filing him under "not awarded", which says you rejected him. Refuses to call it withdrawn when no price was ever given, refuses on the winning bid and on a decided room, and revokes the reply link so a price cannot arrive after he has said he is out.';

revoke all on function public.portal_bid_step_out(uuid, text, text) from public, anon;
grant execute on function public.portal_bid_step_out(uuid, text, text) to authenticated, service_role;
