-- 178: A BIDDER CAN BE CLOSED AS LOST WITHOUT AWARDING ANYBODY, AND A ROOM
--      ADOPTS THE BIDS THAT PREDATE IT.
--
-- Shahar (2026-09-17), on HVAC: "Jacob / Mario is closed as lost on the
-- bidding."
--
-- Two gaps this found. There was no way to say "this one is out" except by
-- awarding somebody else, which is the wrong order: a bidder drops out, or
-- never comes back with a number, long before the winner is picked. And the
-- HVAC bids predate bid_packages entirely - three rows on the project with
-- no room to belong to, invisible to every screen that reads a room.
--
-- WHAT THE DATA SAID BACK. The participant note read "Luis - Fusion Heating
-- & Cooling $38,740; Jacob pending; Mario pending", but the bid rows name
-- Luis, Jacob and ESTUARDO of Flex Plumbing & HVAC. Mario is a real contact
-- who does HVAC and plumbing and has no bid on this job. Jacob was closed as
-- lost on Shahar's word; the third was left alone until he says which.

create or replace function public.portal_bid_lost(p_bid uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare b public.bids; v_who text;
begin
  perform public.assert_own_hands();
  select * into b from public.bids where id = p_bid;
  if b.id is null or not public.bid_can_manage(b.project_id) then
    return jsonb_build_object('ok', false, 'reason', 'That bid is not yours to close.');
  end if;
  if b.won then
    return jsonb_build_object('ok', false, 'code', 'IS_WINNER',
      'reason', 'That is the awarded bid. Award it elsewhere rather than marking the winner lost.');
  end if;
  v_who := coalesce((select co.company_name from public.companies co where co.id = b.bidder_company_id),
                    (select coalesce(ct.person_name, ct.name) from public.contacts ct where ct.id = b.bidder_contact_id),
                    'That bidder');

  update public.bids
     set won = false,
         status = 'not awarded',
         not_awarded_reason = coalesce(nullif(btrim(p_reason), ''),
                                       'Closed as lost on ' || to_char(current_date, 'Mon DD, YYYY')),
         last_modified_at = now(), last_modified_by = 'portal:bid-lost'
   where id = p_bid;

  return jsonb_build_object('ok', true, 'who', v_who,
    'still_in', (select count(*) from public.bids x
                  where x.package_id is not distinct from b.package_id
                    and x.project_id = b.project_id and x.trade is not distinct from b.trade
                    and x.status in ('invited','received','under negotiation')));
end $$;
revoke all on function public.portal_bid_lost(uuid, text) from public, anon;
grant execute on function public.portal_bid_lost(uuid, text) to authenticated;

-- A room takes in the bids for its trade that were written before rooms
-- existed, so nothing has to be typed twice.
create or replace function public.portal_bid_room_adopt(p_package uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare pk public.bid_packages; v_n integer;
begin
  perform public.assert_own_hands();
  select * into pk from public.bid_packages where id = p_package;
  if pk.id is null or not public.bid_can_manage(pk.project_id) then
    return jsonb_build_object('ok', false, 'reason', 'That room is not yours to change.');
  end if;
  update public.bids b
     set package_id = pk.id,
         package = coalesce(b.package, pk.category, pk.trade),
         last_modified_at = now(), last_modified_by = 'portal:bid-room-adopt'
   where b.project_id = pk.project_id
     and b.package_id is null
     and lower(coalesce(b.trade, '')) = lower(coalesce(pk.trade, ''));
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'adopted', v_n,
    'in_room', (select count(*) from public.bids where package_id = pk.id));
end $$;
revoke all on function public.portal_bid_room_adopt(uuid) from public, anon;
grant execute on function public.portal_bid_room_adopt(uuid) to authenticated;

-- Applied live on 55 Walnut's New build: an HVAC room opened, the three
-- orphan bids adopted into it, and Jacob closed as lost.
