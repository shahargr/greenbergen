-- 064 - a bid is negotiated twice before it is awarded, and the rounds show.
--
-- Shahar (2026-09-11), on the Professionals project screen: "bid does not
-- allow me to click in." The bid packages were a list of dead rows; the only
-- screen that opens one is the portal's. The Professionals app now has its
-- own at /project/[id]/bids/[pkg], and this is the write path it needs that
-- the database did not have yet.
--
-- The standing rule (help topic contractors, "Always negotiate every bid"):
-- no number is ever accepted first time. Round one is the open ask - "is
-- that the best you can do?" - and round two is best-and-final against a
-- named gap. portal_bid_reply records a number but never says a round
-- happened: it overwrites the amount and leaves bids.round at 1, so the
-- history of the negotiation is lost and nothing on the screen can tell
-- whether the rule was run.
--
-- portal_bid_negotiate records one round: what was asked, what came back,
-- and the new number if it moved. The amount is optional - a contractor who
-- holds his price has still been asked, and that is the fact worth keeping.
-- The bid moves to 'under negotiation', which portal_bid_award accepts, so
-- the award still goes through the one function that owns that rule.
create or replace function public.portal_bid_negotiate(
  p_bid uuid, p_amount numeric default null, p_note text default null
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  b       public.bids;
  bp      public.bid_packages;
  v_round int;
  v_actor text;
  v_line  text;
begin
  perform public.assert_own_hands();
  select * into b from public.bids where id = p_bid;
  if b.id is null then return jsonb_build_object('ok', false, 'reason', 'No such bid.'); end if;
  if not public.bid_can_manage(b.project_id) then
    return jsonb_build_object('ok', false, 'reason', 'Negotiating on this package is not yours to do.');
  end if;
  select * into bp from public.bid_packages where id = b.package_id;
  if b.status in ('awarded', 'not awarded', 'withdrawn', 'declined') then
    return jsonb_build_object('ok', false, 'reason', 'That bid is settled - there is nothing left to negotiate.');
  end if;
  if b.status = 'invited' and p_amount is null then
    return jsonb_build_object('ok', false, 'reason', 'Record their first number before negotiating it.');
  end if;

  select coalesce(au.full_name, au.email) into v_actor
    from public.app_users au where au.id = public.current_app_user_id();
  v_round := coalesce(b.round, 1) + 1;

  -- The round, in the words of the rule: round one is the open ask, round
  -- two is best and final. Anything past two is a third conversation and
  -- says so plainly rather than pretending to be part of the rule.
  --
  -- bids.round counts the numbers on the table and starts at 1, so the first
  -- NEGOTIATION round is bids.round 2. The note counts negotiations, because
  -- that is what the rule counts and what a person reading this later means.
  v_line := 'NEGOTIATION ROUND ' || (v_round - 1) || ' (' || to_char(current_date, 'YYYY-MM-DD') || ', ' || coalesce(v_actor, 'portal') || '): '
            || case v_round - 1 when 1 then 'open ask - is that the best you can do?'
                                when 2 then 'best and final, against the target'
                                else 'further negotiation' end
            || coalesce(' - ' || nullif(btrim(p_note), ''), '')
            || case when p_amount is null then '. Price unchanged at ' || coalesce('$' || round(b.amount)::text, 'no number yet') || '.'
                    when b.amount is null then '. Number given: $' || round(p_amount)::text || '.'
                    when p_amount < b.amount then '. Came down from $' || round(b.amount)::text || ' to $' || round(p_amount)::text || '.'
                    when p_amount > b.amount then '. Went UP from $' || round(b.amount)::text || ' to $' || round(p_amount)::text || '.'
                    else '. Held at $' || round(p_amount)::text || '.' end;

  update public.bids
     set amount = coalesce(p_amount, amount),
         round = v_round,
         status = 'under negotiation',
         received_on = coalesce(received_on, current_date),
         notes = coalesce(notes || E'\n\n', '') || v_line,
         last_modified_at = now(), last_modified_by = 'portal:negotiate'
   where id = p_bid;

  return jsonb_build_object('ok', true, 'bid_id', p_bid, 'round', v_round,
    'amount', coalesce(p_amount, b.amount),
    -- Two rounds is the rule; the screen says so until they are both run.
    'rounds_run', v_round - 1,
    'rule_met', v_round - 1 >= 2);
end $$;
revoke all on function public.portal_bid_negotiate(uuid, numeric, text) from public, anon;
grant execute on function public.portal_bid_negotiate(uuid, numeric, text) to authenticated, service_role;

-- The package screen needs to know how far the negotiation got before it
-- offers an Award button, so portal_bid_package carries each reply's round
-- and its notes. Nothing else about the function changes.
CREATE OR REPLACE FUNCTION public.portal_bid_package(p_pkg uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select case when bp.id is null or not public.is_project_member(bp.project_id) then null else jsonb_build_object(
    'id', bp.id, 'project_id', bp.project_id,
    'project_name', (select p.project_name from projects p where p.id = bp.project_id),
    'phase', bp.phase, 'category', bp.category, 'trade', bp.trade, 'scope_summary', bp.scope_summary,
    'budget_amount', case when bp.budget_visible or public.can_view_project_financials(bp.project_id) then bp.budget_amount end,
    'budget_visible', bp.budget_visible,
    'deposit_pct', bp.deposit_pct, 'retainage_pct', bp.retainage_pct, 'retainage_release_trigger', bp.retainage_release_trigger,
    'net_days', bp.net_days, 'consumables_by', bp.consumables_by, 'finish_material_by', bp.finish_material_by,
    'insurance_gl_per_occurrence', bp.insurance_gl_per_occurrence, 'insurance_gl_aggregate', bp.insurance_gl_aggregate,
    'insurance_workers_comp', bp.insurance_workers_comp, 'coi_required', bp.coi_required,
    'reply_by', bp.reply_by, 'status', bp.status, 'awarded_bid_id', bp.awarded_bid_id,
    'can_edit', public.bid_can_manage(bp.project_id),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'scope_item_id', i.scope_item_id, 'item', s.item,
                'category', s.category, 'is_required', i.is_required, 'sort', i.sort) order by i.sort, s.item)
              from bid_package_items i join project_scope_items s on s.id = i.scope_item_id where i.package_id = bp.id), '[]'::jsonb),
    'candidates', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'item', s.item, 'category', s.category) order by s.item)
              from project_scope_items s where s.project_id = bp.project_id
                and (bp.trade is null or lower(s.trade) = lower(bp.trade))
                and not exists (select 1 from bid_package_items i where i.package_id = bp.id and i.scope_item_id = s.id)), '[]'::jsonb),
    'docs', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'file_name', f.file_name, 'kind', f.kind, 'bucket', f.bucket, 'path', f.path) order by f.created_at desc)
              from file_links fl join files f on f.id = fl.file_id where fl.bid_package_id = bp.id), '[]'::jsonb),
    'bids', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'bidder', coalesce(c.person_name, c.name), 'bidder_contact_id', b.bidder_contact_id,
                'status', b.status, 'amount', b.amount, 'received_on', b.received_on, 'valid_until', b.valid_until,
                'is_like_for_like', b.is_like_for_like, 'scope_gaps', b.scope_gaps,
                -- How far the two-round rule got, and what was said each time.
                'round', coalesce(b.round, 1), 'rounds_run', greatest(coalesce(b.round, 1) - 1, 0), 'notes', b.notes
                ) order by b.status, coalesce(c.person_name, c.name))
              from bids b left join contacts c on c.id = b.bidder_contact_id where b.package_id = bp.id), '[]'::jsonb),
    'members', coalesce((select jsonb_agg(jsonb_build_object('contact_id', c.id, 'name', coalesce(c.person_name, c.name),
                'trade', (select r.trade from contact_trade_roles r where r.contact_id = c.id order by r.created_at limit 1)) order by coalesce(c.person_name, c.name))
              from (select distinct pm.contact_id from project_members pm where pm.project_id = bp.project_id and pm.status = 'active' and pm.contact_id is not null) m
              join contacts c on c.id = m.contact_id), '[]'::jsonb)
  ) end
  from bid_packages bp where bp.id = p_pkg;
$function$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
