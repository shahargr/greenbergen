-- AWARDING AGAIN REVIVES THE CONTRACT THE UNDO CANCELLED.
--
-- Found by running the round trip rather than reasoning about it: award,
-- undo, award again. The package said 'awarded', the bid said 'awarded', and
-- the contract behind both still said 'Cancelled'.
--
-- The cause is that portal_award_trade matches an existing contract on
-- project + contact + trade and does not look at its status, so the second
-- award reuses the very row the undo had just cancelled. Nothing was wrong
-- with either function on its own; the pair had never been run in sequence
-- because until 210 there was no way to undo an award at all.
--
-- The status it goes back to is READ, not assumed - change_events holds what
-- it was before the undo, and these contracts are variously 'signed',
-- 'awarded' and 'Complete'. Guessing 'awarded' for a contract that had been
-- signed would quietly downgrade it.
--
-- Narrow on purpose: only a contract that portal:unaward itself cancelled is
-- revived. One cancelled for any other reason stays cancelled, and the award
-- says so in its reply rather than leaving you to find out later.
do $$
declare
  src text; out_sql text; n int;
  a constant text :=
'      update public.contracts
         set award_route = ''bid'', award_route_source = ''stated'',
             bid_package_id = coalesce(bid_package_id, pk.id)
       where id = v_contract;';
  b constant text :=
'      update public.contracts c
         set award_route = ''bid'', award_route_source = ''stated'',
             bid_package_id = coalesce(c.bid_package_id, pk.id),
             -- REVIVED, NOT LEFT FOR DEAD (214). Undoing an award cancels the
             -- contract it made; awarding again reuses that same row.
             status = case when c.status = ''Cancelled'' and exists (
                             select 1 from public.change_events ce
                              where ce.table_name = ''contracts'' and ce.row_id = c.id::text
                                and ce.field = ''status'' and ce.to_value = ''Cancelled''
                                and ce.actor = ''portal:unaward'')
                           then coalesce((select ce2.from_value from public.change_events ce2
                                           where ce2.table_name = ''contracts'' and ce2.row_id = c.id::text
                                             and ce2.field = ''status'' and ce2.to_value = ''Cancelled''
                                           order by ce2.at desc limit 1), ''awarded'')
                           else c.status end,
             notes = case when c.status = ''Cancelled'' and exists (
                            select 1 from public.change_events ce3
                             where ce3.table_name = ''contracts'' and ce3.row_id = c.id::text
                               and ce3.field = ''status'' and ce3.to_value = ''Cancelled''
                               and ce3.actor = ''portal:unaward'')
                          then coalesce(c.notes || E''\n\n'', '''') || ''Revived '' || to_char(current_date, ''YYYY-MM-DD'')
                               || '' - the award was made again.''
                          else c.notes end
       where c.id = v_contract;';
begin
  src := pg_get_functiondef('public.portal_bid_award(uuid,uuid,text)'::regprocedure);
  n := (length(src) - length(replace(src, a, ''))) / length(a);
  if n <> 1 then
    raise exception 'The contract-stamp block matched % times, expected 1. portal_bid_award has drifted.', n;
  end if;
  out_sql := replace(src, a, b);
  execute out_sql;
end $$;

-- And the award now says what state the contract is actually in, so a
-- contract that could NOT be revived is visible on the spot.
do $$
declare
  src text; out_sql text; n int;
  a constant text := '''amount'', b.amount);';
  b constant text := '''amount'', b.amount,
    ''contract_status'', (select c.status from public.contracts c where c.id = v_contract));';
begin
  src := pg_get_functiondef('public.portal_bid_award(uuid,uuid,text)'::regprocedure);
  n := (length(src) - length(replace(src, a, ''))) / length(a);
  if n <> 1 then
    raise exception 'The return block matched % times, expected 1.', n;
  end if;
  out_sql := replace(src, a, b);
  execute out_sql;
end $$;
