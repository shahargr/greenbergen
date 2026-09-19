-- 192: A LINE CAN BE TAKEN OUT OF THE PROPOSAL WITHOUT BEING FORGOTTEN.
--
-- Shahar (2026-09-19), looking at the roofing room on a NEW BUILD: "for every
-- bid, i'm looking to have an easy way to include / exclude items from the
-- proposal. for example, this image reflect a new build, so tear-off existing
-- is not needed. testing shows i have made changes, so need to have an easy
-- way to edit this from this screen, maybe a refine button."
--
-- WHAT WAS WRONG. The room's scope was one textarea: to take "Tear off the
-- existing roof and dispose" out of a new build you had to retype the other
-- twelve lines around it, and a line you had second thoughts about was gone
-- with no record that anybody had thought about it. A stray test line
-- ("Testing - adding a line") had the same problem in reverse - it could only
-- be removed by rewriting the box.
--
-- THE DISTINCTION THIS MIGRATION MAKES. Taking a line OUT OF THE PROPOSAL and
-- REMOVING IT are not the same act:
--
--   out of the proposal   is_included = false. The line stays in the room,
--                         greyed, with the reason beside it. No bidder is
--                         shown it, no bid is short for missing it, and it
--                         goes back with one tap. "We looked at tear-off and
--                         it does not apply here" is a decision worth
--                         keeping - on a new build somebody WILL ask.
--   removed               the row leaves the package (it stays on the job as
--                         a scope item, migration 180's rule). For a line
--                         that should never have been typed.
--
-- A line a bidder has already priced is never removed - his reply is judged
-- against the rows the package had when he answered. It may be taken out of
-- the proposal, because that is a change of mind about the WORK, not a
-- rewriting of what he said - and every bid's "missing" is recomputed the
-- moment it happens, which is the point: exclude tear-off and the three men
-- who left it out stop being short.

-- ---------------------------------------------------------------------------
-- 192a  The column
-- ---------------------------------------------------------------------------
alter table public.bid_package_items
  add column if not exists is_included boolean not null default true,
  add column if not exists excluded_why text;

comment on column public.bid_package_items.is_included is
  'False = this line is not part of what is being asked for in this room. It stays visible to whoever runs the bid, with the reason, and is hidden from every bidder and every comparison.';
comment on column public.bid_package_items.excluded_why is
  'Why it is out - "new build, nothing to tear off". The whole value of excluding rather than deleting.';

-- ---------------------------------------------------------------------------
-- 192b  Every read that speaks to a bidder respects it
-- ---------------------------------------------------------------------------
-- Four reads and one write see these rows. Three of them must now pretend an
-- excluded line does not exist; the fourth - the room itself - must show it,
-- because a decision you cannot see is a decision you cannot undo.

-- 1. THE ROOM SHOWS BOTH, and says which is which.
do $patch$
declare src text; out_ text;
begin
  src := pg_get_functiondef('public.portal_bid_package(uuid)'::regprocedure);
  out_ := replace(src,
    $old$'kind', coalesce(i.kind, 'base')) order by i.kind, i.sort, s.item)$old$,
    $new$'kind', coalesce(i.kind, 'base'),
                'is_included', coalesce(i.is_included, true), 'excluded_why', i.excluded_why)
                order by coalesce(i.is_included, true) desc, i.kind, i.sort, s.item)$new$);
  if out_ = src then raise exception 'portal_bid_package has drifted - the items block was not found.'; end if;
  execute out_;
end $patch$;

-- 2. THE BIDDER IS SHOWN ONLY WHAT IS BEING ASKED FOR. Both lists.
do $patch$
declare src text; out_ text;
begin
  src := pg_get_functiondef('public.bid_by_token(uuid)'::regprocedure);
  out_ := replace(src,
    $old$where i.package_id = bp.id and i.kind = 'base'), '[]'::jsonb),$old$,
    $new$where i.package_id = bp.id and i.kind = 'base' and coalesce(i.is_included, true)), '[]'::jsonb),$new$);
  out_ := replace(out_,
    $old$where i.package_id = bp.id and i.kind = 'option'), '[]'::jsonb),$old$,
    $new$where i.package_id = bp.id and i.kind = 'option' and coalesce(i.is_included, true)), '[]'::jsonb),$new$);
  if out_ = src then raise exception 'bid_by_token has drifted - neither item list was found.'; end if;
  execute out_;
end $patch$;

-- 3. THE COMPARISON HAS NO ROW FOR IT. An excluded line is not a column
-- somebody left blank; it is not part of the question.
do $patch$
declare src text; out_ text;
begin
  src := pg_get_functiondef('public.portal_bid_compare(uuid)'::regprocedure);
  out_ := replace(src,
    $old$where i.package_id = p_pkg and coalesce(i.kind, 'base') = 'base'),$old$,
    $new$where i.package_id = p_pkg and coalesce(i.kind, 'base') = 'base' and coalesce(i.is_included, true)),$new$);
  out_ := replace(out_,
    $old$where i.package_id = p_pkg and i.kind = 'option'),$old$,
    $new$where i.package_id = p_pkg and i.kind = 'option' and coalesce(i.is_included, true)),$new$);
  if out_ = src then raise exception 'portal_bid_compare has drifted - neither item list was found.'; end if;
  execute out_;
end $patch$;

-- 4. NOBODY IS SHORT FOR A LINE THAT IS NOT BEING ASKED FOR.
do $patch$
declare src text; out_ text;
begin
  src := pg_get_functiondef('public.bid_record_reply(uuid,jsonb,jsonb,jsonb,numeric,date,text,text)'::regprocedure);
  out_ := replace(src,
    $old$   where i.package_id = bp.id and i.is_required$old$,
    $old2$   where i.package_id = bp.id and i.is_required and coalesce(i.is_included, true)$old2$);
  if out_ = src then raise exception 'bid_record_reply has drifted - the gap scan was not found.'; end if;
  execute out_;
end $patch$;

-- ---------------------------------------------------------------------------
-- 192c  What "missing" means changes the moment the scope does
-- ---------------------------------------------------------------------------
-- is_like_for_like and scope_gaps are worked out when a bid ARRIVES and kept
-- on the row. That was fine while the scope could not move under a reply;
-- excluding a line moves it. So the same sentence bid_record_reply uses, on
-- its own, run over every bid in a room whenever the room's lines change.
--
-- Internal: no grant. The only callers are the definer functions below, which
-- have already asked whether the caller may be here (rulebook 71).
create or replace function public.bid_regap(p_package uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare n integer := 0;
begin
  update public.bids b
     set is_like_for_like = (g.gaps is null), scope_gaps = g.gaps
    from (
      select bb.id,
             (select string_agg(s.item, '; ')
                from public.bid_package_items i
                join public.project_scope_items s on s.id = i.scope_item_id
               where i.package_id = p_package and i.is_required and coalesce(i.is_included, true)
                 and not coalesce((select (li->>'included')::boolean
                                     from jsonb_array_elements(coalesce(bb.line_items, '[]'::jsonb)) li
                                    where li->>'scope_item_id' = i.scope_item_id::text limit 1), false)) as gaps
        from public.bids bb where bb.package_id = p_package
    ) g
   where b.id = g.id
     and b.line_items is not null
     and (b.is_like_for_like is distinct from (g.gaps is null) or b.scope_gaps is distinct from g.gaps);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.bid_regap(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 192d  The refine button
-- ---------------------------------------------------------------------------
-- One save for the whole list, because that is what the screen is: a list you
-- go down ticking, correcting a word here, striking a line there. Sending it
-- line by line would mean thirteen round trips and a half-saved scope if the
-- phone lost signal in the middle.
--
-- Each element is one row of the package:
--   {"id": <bid_package_items.id>, "in": true|false, "item": "...",
--    "kind": "base"|"option", "drop": true|false}
-- A key that is absent is a thing not being changed. p_why is the reason for
-- everything turned off in THIS save - "new build, nothing to tear off" is
-- one sentence that covers the three lines you just unticked, and asking for
-- it thirteen times is how it gets written none of them.
create or replace function public.portal_bid_lines_refine(
  p_package uuid, p_lines jsonb, p_why text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  pk       public.bid_packages;
  li       jsonb;
  it       public.bid_package_items;
  v_why    text := nullif(btrim(coalesce(p_why, '')), '');
  v_text   text;
  v_cur    text;
  v_kind   text;
  v_in     boolean;
  v_priced boolean;
  v_out    integer := 0;  -- taken out of the proposal
  v_back   integer := 0;  -- put back in
  v_gone   integer := 0;  -- removed from the room
  v_named  integer := 0;  -- reworded
  v_moved  integer := 0;  -- base <-> option
  v_held   text[] := '{}';
  v_regap  integer := 0;
begin
  perform public.assert_own_hands();
  select * into pk from public.bid_packages where id = p_package;
  if pk.id is null or not public.bid_can_manage(pk.project_id) then
    return jsonb_build_object('ok', false, 'reason', 'That room is not yours to change.');
  end if;
  -- THE SAME GUARD THE SCOPE BOX HAS (182). Work was awarded on these lines.
  if coalesce(pk.status, '') = 'closed' or pk.awarded_bid_id is not null then
    return jsonb_build_object('ok', false, 'code', 'CLOSED',
      'reason', 'This room is closed - the work was awarded on these lines, so they stand. Open a new round if the job changed.');
  end if;
  if jsonb_typeof(coalesce(p_lines, 'null'::jsonb)) <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'Nothing to save.');
  end if;

  for li in select * from jsonb_array_elements(p_lines) loop
    select * into it from public.bid_package_items
     where id = nullif(li->>'id', '')::uuid and package_id = pk.id;
    continue when it.id is null;   -- a line from another room is not ours to touch

    -- Has anybody put a price against this line? It decides what may happen
    -- to it, so it is asked once.
    v_priced := exists (
      select 1 from public.bids b
       where b.package_id = pk.id and jsonb_typeof(b.line_items) = 'array'
         and exists (select 1 from jsonb_array_elements(b.line_items) x
                      where x->>'scope_item_id' = it.scope_item_id::text));

    -- REMOVED. Only a line nobody has priced, and only from this package:
    -- the scope item stays on the job (180 - a thing somebody decided to
    -- build is not unbuilt by editing a bid).
    if coalesce((li->>'drop')::boolean, false) then
      if v_priced then
        v_held := v_held || (select s.item from public.project_scope_items s where s.id = it.scope_item_id);
      else
        delete from public.bid_package_items where id = it.id;
        v_gone := v_gone + 1;
        continue;
      end if;
    end if;

    -- REWORDED. The sentence belongs to the job, so correcting it corrects it
    -- everywhere - which is what you want for "Testing - adding a line", and
    -- what you want for a typo.
    v_text := nullif(btrim(coalesce(li->>'item', '')), '');
    select s.item into v_cur from public.project_scope_items s where s.id = it.scope_item_id;
    if v_text is not null and v_text is distinct from v_cur then
      update public.project_scope_items set item = v_text where id = it.scope_item_id;
      v_named := v_named + 1;
    end if;

    -- IN OR OUT OF THE PROPOSAL.
    if li ? 'in' then
      v_in := coalesce((li->>'in')::boolean, true);
      if v_in is distinct from coalesce(it.is_included, true) then
        update public.bid_package_items
           set is_included = v_in,
               excluded_why = case when v_in then null else v_why end
         where id = it.id;
        if v_in then v_back := v_back + 1; else v_out := v_out + 1; end if;
      elsif not v_in and v_why is not null then
        update public.bid_package_items set excluded_why = v_why where id = it.id;
      end if;
    end if;

    -- PART OF THE NUMBER, OR PRICED ON ITS OWN. An option is never required
    -- and is never a gap, which is the whole difference.
    v_kind := case when lower(coalesce(li->>'kind', '')) = 'option' then 'option'
                   when lower(coalesce(li->>'kind', '')) = 'base' then 'base' end;
    if v_kind is not null and v_kind is distinct from coalesce(it.kind, 'base') then
      update public.bid_package_items
         set kind = v_kind, is_required = (v_kind = 'base')
       where id = it.id;
      v_moved := v_moved + 1;
    end if;
  end loop;

  -- What every bid is short of has just changed. Say so on the rows now,
  -- rather than leaving three men marked missing a line nobody is asking for.
  v_regap := public.bid_regap(pk.id);

  return jsonb_build_object('ok', true,
    'excluded', v_out, 'included', v_back, 'removed', v_gone,
    'renamed', v_named, 'moved', v_moved, 'rescored', v_regap,
    'held', to_jsonb(v_held),
    'total', (select count(*) from public.bid_package_items
               where package_id = pk.id and coalesce(kind, 'base') = 'base' and coalesce(is_included, true)));
end $$;
revoke all on function public.portal_bid_lines_refine(uuid, jsonb, text) from public, anon;
grant execute on function public.portal_bid_lines_refine(uuid, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 192e  The scope box and the refine list must agree
-- ---------------------------------------------------------------------------
-- The box holds the lines being asked for; an excluded line is not in it. So
-- the box must stop treating "absent from the box" as "delete" for those
-- rows, or the first save after a refine would quietly wipe the decisions.
-- Two changes, both narrow: the reconcile ignores excluded rows, and a line
-- typed back INTO the box is back in the proposal by that act.
create or replace function public.portal_bid_scope_set(
  p_package uuid, p_lines text[], p_kind text default 'base')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  pk public.bid_packages; v_line text; v_id uuid; v_n integer := 0; v_sort integer := 0;
  v_keep uuid[] := '{}'; v_gone integer := 0; v_held text[] := '{}'; v_kind text;
begin
  perform public.assert_own_hands();
  v_kind := case when lower(coalesce(p_kind, 'base')) = 'option' then 'option' else 'base' end;
  select * into pk from public.bid_packages where id = p_package;
  if pk.id is null or not public.bid_can_manage(pk.project_id) then
    return jsonb_build_object('ok', false, 'reason', 'That room is not yours to change.');
  end if;
  if pk.trade is null then
    return jsonb_build_object('ok', false, 'reason', 'This room has no trade, so its lines have nowhere to live.');
  end if;
  if coalesce(pk.status, '') = 'closed' or pk.awarded_bid_id is not null then
    return jsonb_build_object('ok', false, 'code', 'CLOSED',
      'reason', 'This room is closed - the work was awarded on these lines, so they stand. Open a new round if the job changed.');
  end if;

  foreach v_line in array coalesce(p_lines, '{}') loop
    v_line := nullif(btrim(v_line), '');
    continue when v_line is null;
    v_sort := v_sort + 1;
    select si.id into v_id from public.project_scope_items si
     where si.project_id = pk.project_id and si.trade = pk.trade and lower(btrim(si.item)) = lower(v_line)
     limit 1;
    if v_id is null then
      insert into public.project_scope_items (project_id, trade, item, origin, authority, created_by)
      values (pk.project_id, pk.trade, v_line, 'project', 'unassigned', 'portal:bid-room')
      returning id into v_id;
    end if;
    -- Typed into the box IS asking for it: a line that was out comes back in,
    -- and the stale reason goes with it.
    insert into public.bid_package_items (package_id, scope_item_id, is_required, sort, kind)
    values (pk.id, v_id, v_kind = 'base', v_sort, v_kind)
    on conflict (package_id, scope_item_id) do update
      set sort = excluded.sort, kind = excluded.kind, is_required = excluded.is_required,
          is_included = true, excluded_why = null;
    v_keep := v_keep || v_id;
    v_n := v_n + 1;
  end loop;

  -- A line somebody has already priced is held, not dropped - and only this
  -- kind's lines, still in the proposal, are in scope for removal at all. A
  -- line taken out on purpose (192) is absent from the box by design and is
  -- not an instruction to delete it.
  select coalesce(array_agg(s.item order by s.item), '{}')
    into v_held
    from public.bid_package_items i
    join public.project_scope_items s on s.id = i.scope_item_id
   where i.package_id = pk.id and i.kind = v_kind and coalesce(i.is_included, true)
     and not (i.scope_item_id = any (v_keep))
     and exists (select 1 from public.bids b
                  where b.package_id = pk.id and jsonb_typeof(b.line_items) = 'array'
                    and exists (select 1 from jsonb_array_elements(b.line_items) li
                                 where li->>'scope_item_id' = i.scope_item_id::text));

  delete from public.bid_package_items i
   where i.package_id = pk.id and i.kind = v_kind and coalesce(i.is_included, true)
     and not (i.scope_item_id = any (v_keep))
     and not exists (select 1 from public.bids b
                      where b.package_id = pk.id and jsonb_typeof(b.line_items) = 'array'
                        and exists (select 1 from jsonb_array_elements(b.line_items) li
                                     where li->>'scope_item_id' = i.scope_item_id::text));
  get diagnostics v_gone = row_count;

  -- The lines moved, so what each bid is short of moved with them.
  perform public.bid_regap(pk.id);

  return jsonb_build_object('ok', true, 'kind', v_kind, 'lines', v_n, 'removed', v_gone,
    'held', to_jsonb(v_held),
    'total', (select count(*) from public.bid_package_items
               where package_id = pk.id and kind = v_kind and coalesce(is_included, true)));
end $$;
revoke all on function public.portal_bid_scope_set(uuid, text[], text) from public, anon;
grant execute on function public.portal_bid_scope_set(uuid, text[], text) to authenticated;

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);

-- ---------------------------------------------------------------------------
-- 192f  The desk picker, too
-- ---------------------------------------------------------------------------
-- The portal's older scope picker reconciles the package from a list of ticks
-- and deletes everything unticked. Its box does not show excluded lines, so
-- "absent from the ticks" must not read as "delete" for them either.
create or replace function public.portal_bid_package_items_set(p_pkg uuid, p_items uuid[], p_required uuid[])
returns jsonb
language plpgsql security definer set search_path = public as $function$
declare v_project uuid;
begin
  select project_id into v_project from bid_packages where id = p_pkg;
  if v_project is null or not public.bid_can_manage(v_project) then return jsonb_build_object('ok', false, 'reason', 'Not yours to do.'); end if;
  delete from bid_package_items
   where package_id = p_pkg and coalesce(is_included, true)
     and not (scope_item_id = any(coalesce(p_items, '{}')));
  insert into bid_package_items (package_id, scope_item_id, sort, is_required)
  select p_pkg, s.id, ord, (s.id = any(coalesce(p_required, '{}')))
  from unnest(coalesce(p_items, '{}')) with ordinality as u(id, ord)
  join project_scope_items s on s.id = u.id and s.project_id = v_project
  on conflict (package_id, scope_item_id) do update
    set sort = excluded.sort, is_required = excluded.is_required,
        is_included = true, excluded_why = null;
  perform public.bid_regap(p_pkg);
  return jsonb_build_object('ok', true);
end $function$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
