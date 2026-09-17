-- 180: THE SCOPE BOX IN THE ROOM IS THE WHOLE LIST, NOT AN IN-TRAY.
--
-- The bid room's scope editor is one box, one line per line, showing what
-- the package asks for. A box like that is read as the list: delete a line,
-- save, and it should be gone from the table every bid is judged against.
-- portal_bid_scope_set only ever added, so a line taken out came back on the
-- next screen - the screen quietly lying about what it just saved.
--
-- What "gone" means is narrow on purpose. The line stops being a row of THIS
-- package; it stays on the job as a scope item, because a thing somebody
-- decided to build is not unbuilt by editing a bid. And a line a bidder has
-- already priced is never dropped - his reply is judged against the rows the
-- package had when he answered, and pulling one out from under him would
-- rewrite what he said. Those are reported back, so the screen can say so.

create or replace function public.portal_bid_scope_set(p_package uuid, p_lines text[])
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  pk       public.bid_packages;
  v_line   text;
  v_id     uuid;
  v_n      integer := 0;
  v_sort   integer := 0;
  v_keep   uuid[] := '{}';
  v_gone   integer := 0;
  v_held   text[] := '{}';
begin
  perform public.assert_own_hands();
  select * into pk from public.bid_packages where id = p_package;
  if pk.id is null or not public.bid_can_manage(pk.project_id) then
    return jsonb_build_object('ok', false, 'reason', 'That room is not yours to change.');
  end if;
  if pk.trade is null then
    return jsonb_build_object('ok', false, 'reason', 'This room has no trade, so its lines have nowhere to live.');
  end if;

  foreach v_line in array coalesce(p_lines, '{}') loop
    v_line := nullif(btrim(v_line), '');
    continue when v_line is null;
    v_sort := v_sort + 1;
    -- The same sentence twice is one line, not two.
    select si.id into v_id from public.project_scope_items si
     where si.project_id = pk.project_id and si.trade = pk.trade and lower(btrim(si.item)) = lower(v_line)
     limit 1;
    if v_id is null then
      insert into public.project_scope_items (project_id, trade, item, origin, authority, created_by)
      values (pk.project_id, pk.trade, v_line, 'project', 'unassigned', 'portal:bid-room')
      returning id into v_id;
    end if;
    insert into public.bid_package_items (package_id, scope_item_id, is_required, sort)
    values (pk.id, v_id, true, v_sort)
    on conflict (package_id, scope_item_id) do update set sort = excluded.sort;
    v_keep := v_keep || v_id;
    v_n := v_n + 1;
  end loop;

  -- A line somebody has already priced is held, not dropped.
  select coalesce(array_agg(s.item order by s.item), '{}')
    into v_held
    from public.bid_package_items i
    join public.project_scope_items s on s.id = i.scope_item_id
   where i.package_id = pk.id
     and not (i.scope_item_id = any (v_keep))
     and exists (
       select 1 from public.bids b
        where b.package_id = pk.id
          and jsonb_typeof(b.line_items) = 'array'
          and exists (select 1 from jsonb_array_elements(b.line_items) li
                       where li->>'scope_item_id' = i.scope_item_id::text));

  delete from public.bid_package_items i
   where i.package_id = pk.id
     and not (i.scope_item_id = any (v_keep))
     and not exists (
       select 1 from public.bids b
        where b.package_id = pk.id
          and jsonb_typeof(b.line_items) = 'array'
          and exists (select 1 from jsonb_array_elements(b.line_items) li
                       where li->>'scope_item_id' = i.scope_item_id::text));
  get diagnostics v_gone = row_count;

  return jsonb_build_object('ok', true, 'lines', v_n, 'removed', v_gone,
    'held', to_jsonb(v_held),
    'total', (select count(*) from public.bid_package_items where package_id = pk.id));
end $$;
revoke all on function public.portal_bid_scope_set(uuid, text[]) from public, anon;
grant execute on function public.portal_bid_scope_set(uuid, text[]) to authenticated;

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
