-- A PACKAGE THAT WAS AWARDED SAYS 'awarded'.
--
-- bid_packages_status_check has allowed draft / open / reviewing / awarded /
-- closed since the table was made. In seven real packages the data only ever
-- held 'open' and 'closed' - because portal_bid_award wrote 'closed', so the
-- one status named after the thing that just happened was unreachable.
--
-- Worse, 'closed' was carrying two different meanings. One of the five
-- closed packages was awarded; the other four were abandoned. Nothing could
-- tell them apart except by joining to awarded_bid_id, which is exactly the
-- kind of thing a status column exists to save you from.
--
-- So award writes 'awarded', and 'closed' goes back to meaning "this room is
-- finished and nobody won it".
--
-- FOUR READERS HAD TO MOVE WITH IT, and they were found rather than
-- remembered: eight functions mention 'closed' near bid_packages, and four
-- already ask `status = 'closed' or awarded_bid_id is not null` - those are
-- safe, because awarded_bid_id is the real fact and they were already
-- reading it. The other four tested the status alone and would have silently
-- treated an awarded room as live.
--
-- Patched at anchors with a match count on each, so a function that has
-- drifted fails loudly instead of being quietly missed (the lesson of 203).
do $$
declare
  p jsonb;
  src text; out_sql text; n int;
  patches constant jsonb := jsonb_build_array(
    jsonb_build_object('fn', 'portal_bid_award(uuid,uuid,text)',
      'from', 'set awarded_bid_id = b.id, status = ''closed''',
      'to',   'set awarded_bid_id = b.id, status = ''awarded'''),
    jsonb_build_object('fn', 'portal_bid_board(uuid)',
      'from', 'coalesce(r.status, '''') <> ''closed''',
      'to',   'coalesce(r.status, '''') not in (''closed'', ''awarded'')'),
    jsonb_build_object('fn', 'portal_bid_room_open(uuid,text,date,text)',
      'from', 'and coalesce(bp.status, '''') <> ''closed''',
      'to',   'and coalesce(bp.status, '''') not in (''closed'', ''awarded'')'),
    jsonb_build_object('fn', 'portal_bid_room_remove(uuid,boolean)',
      'from', 'if coalesce(pk.status, '''') = ''closed'' then',
      'to',   'if coalesce(pk.status, '''') in (''closed'', ''awarded'') or pk.awarded_bid_id is not null then'),
    jsonb_build_object('fn', 'project_progress(uuid)',
      'from', 'coalesce(status,'''') <> ''closed''',
      'to',   'coalesce(status,'''') not in (''closed'', ''awarded'')')
  );
begin
  for p in select value from jsonb_array_elements(patches) loop
    src := pg_get_functiondef((p->>'fn')::regprocedure);
    n := (length(src) - length(replace(src, p->>'from', ''))) / length(p->>'from');
    if n <> 1 then
      raise exception 'Anchor matched % times in %, expected 1. It has drifted - patch it by hand.', n, p->>'fn';
    end if;
    out_sql := replace(src, p->>'from', p->>'to');
    execute out_sql;
  end loop;
end $$;

-- The one package this has already happened to. The other four closed rooms
-- were abandoned, not awarded, and stay exactly as they are.
update public.bid_packages
   set status = 'awarded', last_modified_by = 'migration:213'
 where awarded_bid_id is not null and status = 'closed';

do $$
declare n int;
begin
  select count(*) into n from public.bid_packages where awarded_bid_id is not null and status <> 'awarded';
  if n <> 0 then raise exception '% awarded packages still do not say so', n; end if;
end $$;
