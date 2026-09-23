-- A BID ROOM NEEDS A REAL TRADE.
--
-- Shahar, 2026-09-23: "error trying to launch a bid for tree removal." The
-- line "Tree / Shade" carried no trade, so package creation fell back to
-- the category text as the trade and hit the trades foreign key as a raw
-- 23503 instead of a sentence. Patched at one anchor (203-style, against
-- the LIVE body so nothing drifts): before the insert, refuse in words
-- when the resolved trade is not in the vocabulary. The finance screen's
-- "Start a bid" also now opens the line's editor instead, when the line
-- has no trade yet.
do $$
declare
  src text := pg_get_functiondef('public.portal_bid_package_save(uuid,uuid,uuid,text,text,boolean,numeric,numeric,text,integer,text,text,numeric,numeric,boolean,boolean,date,text)'::regprocedure);
  anchor constant text := 'insert into bid_packages (project_id';
begin
  if (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'anchor matched % times, expected 1',
      (length(src) - length(replace(src, anchor, ''))) / length(anchor);
  end if;
  execute replace(src, anchor,
    E'if not exists (select 1 from trades tr where tr.trade = coalesce(p_trade, v_cat)) then\n'
    '      return jsonb_build_object(''ok'', false, ''reason'',\n'
    '        ''Give this line a trade first - a bid room needs a real trade to invite.'');\n'
    '    end if;\n'
    '    insert into bid_packages (project_id');
end $$;
