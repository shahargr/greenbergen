-- THE BACK DOOR ONTO AN AWARDED PACKAGE CLOSES.
--
-- portal_bid_award refuses a second award on an awarded package. Until 210
-- there was no un-award, so the only way back was portal_bid_package_save,
-- which takes p_status and never looked at awarded_bid_id: set the package
-- to 'open' and you could award somebody else.
--
-- It looked like an escape hatch and it was a trap. It moves one column.
-- The winning bid still says 'awarded' and won = true, every losing bid
-- still says 'not awarded', the contract the award created is still live
-- with its seat and its payment schedule, and awarded_bid_id still points at
-- the first man. Award a second bidder over the top of that and the job has
-- two winners, two contracts and no way to tell which one is real.
--
-- Now that undoing an award is a thing the database can actually do
-- properly (210), the hatch can be shut. Only a STATUS CHANGE is refused -
-- everything else on the package (its terms, its reply-by, its wording)
-- stays editable after an award, because those are the things you legitimately
-- correct afterwards.
do $$
declare
  src text; out_sql text; n int;
  a constant text := '  update bid_packages set
    trade = coalesce(p_trade, trade), scope_summary = coalesce(p_scope_summary, scope_summary),';
  b constant text := '  -- AN AWARDED PACKAGE''S STATUS IS NOT A FIELD (215). Changing it here
  -- moved one column and left the award, the losing bids, the contract and
  -- the seat all standing - which is how a job ends up with two winners.
  if p_status is not null
     and exists (select 1 from bid_packages bp
                  where bp.id = p_pkg and bp.project_id = p_project
                    and bp.awarded_bid_id is not null
                    and coalesce(bp.status, '''') is distinct from p_status) then
    return jsonb_build_object(''ok'', false, ''reason'',
      ''This package is awarded. Undo the award in the bid room instead - that puts every bid back where it stood, reopens the room and cancels the contract the award created.'');
  end if;

  update bid_packages set
    trade = coalesce(p_trade, trade), scope_summary = coalesce(p_scope_summary, scope_summary),';
begin
  src := pg_get_functiondef('public.portal_bid_package_save(uuid,uuid,uuid,text,text,boolean,numeric,numeric,text,integer,text,text,numeric,numeric,boolean,boolean,date,text)'::regprocedure);
  n := (length(src) - length(replace(src, a, ''))) / length(a);
  if n <> 1 then
    raise exception 'The update block matched % times, expected 1. portal_bid_package_save has drifted.', n;
  end if;
  out_sql := replace(src, a, b);
  execute out_sql;
end $$;
