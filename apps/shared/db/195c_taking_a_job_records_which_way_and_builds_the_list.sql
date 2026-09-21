-- 195c: homeowner_book writes down WHICH WAY the job was taken, and a DIY
-- job leaves with its checklist already on it.
--
-- Two changes to a function that is otherwise untouched: projects.delivery is
-- set from the mode that was already being passed (plan -> diy, book ->
-- hired), and the plan path calls homeowner_diy_checklist before it returns.
-- The checklist call cannot fail the booking - a job that exists without its
-- list is recoverable, a booking that rolled back because a task would not
-- write is not - so its result rides along in the response for the screen to
-- read, and the exception path says so rather than swallowing it silently.

create or replace function public.homeowner_book(p_code text, p_selections jsonb, p_address text, p_unit text, p_facts jsonb, p_budget_band text, p_note text, p_home_project_id uuid DEFAULT NULL::uuid, p_mode text DEFAULT 'book'::text, p_target_window text DEFAULT NULL::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  me uuid := public.current_app_user_id();
  pkg public.blueprint_packages;
  v_addr text := nullif(btrim(p_address), '');
  v_town text; v_home public.projects; v_made jsonb;
  v_price integer; v_cfg text; v_reason text;
  v_project uuid := gen_random_uuid(); v_booking uuid; it record; v_plan boolean := (p_mode = 'plan');
  v_list jsonb;
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.'); end if;
  if p_mode not in ('book', 'plan') then return jsonb_build_object('ok', false, 'reason', 'Unknown mode.'); end if;
  select * into pkg from public.blueprint_packages where code = p_code and is_active;
  select price_cents, config_label, reason into v_price, v_cfg, v_reason from public.homeowner_price(p_code, coalesce(p_selections, '{}'::jsonb));
  if v_reason is not null then return jsonb_build_object('ok', false, 'reason', v_reason); end if;

  if p_home_project_id is not null then
    select * into v_home from public.projects p
     where p.id = p_home_project_id and p.id in (select public.homeowner_home_ids(me));
    if v_home.id is null then return jsonb_build_object('ok', false, 'reason', 'That home is not one of yours.'); end if;
    v_addr := coalesce(v_addr, v_home.address);
  else
    if v_addr is null then return jsonb_build_object('ok', false, 'reason', 'We need the address for the price and the permit.'); end if;
    select * into v_home from public.projects p
     where p.id in (select public.homeowner_home_ids(me)) and lower(p.address) = lower(v_addr)
     order by p.created_at limit 1;
    if v_home.id is null then
      v_town := nullif(btrim(split_part(v_addr, ',', 2)), '');
      v_made := public.create_home_asset(coalesce(split_part(v_addr, ',', 1), 'My home'), v_addr, v_town,
                  'Added through the homeowner app when ' || case when v_plan then 'planning ' else 'booking ' end || pkg.name || '.');
      if not coalesce((v_made->>'ok')::boolean, false) then return v_made; end if;
      select * into v_home from public.projects where id = (v_made->>'project_id')::uuid;
    end if;
  end if;

  insert into public.projects (id, project_name, address, status, domain, owner_user_id, parent_project_id, asset_id, created_by, notes, package_code, delivery)
  values (v_project, pkg.name, v_addr, 'In Progress', 'construction', me, v_home.id, v_home.asset_id, 'homeowner-app',
          case when v_plan then 'Planned through the homeowner app: ' else 'Booked through the homeowner app: ' end || pkg.name ||
          ' at the community price of $' || round(v_price/100.0) || ' (' || coalesce(v_cfg, 'most common setup') || ').' ||
          coalesce(E'\n\nOwner note: ' || nullif(btrim(p_note), ''), ''),
          pkg.code, case when v_plan then 'diy' else 'hired' end);

  for it in select * from public.blueprint_package_items where package_code = pkg.code order by sort_order loop
    insert into public.project_scope_items (project_id, trade, item, category, source, is_required, add_to_contract, add_to_checklist,
                                            origin, notes, created_by, authority, owner_summary, audience)
    values (v_project, pkg.trade, it.label, 'Package: ' || pkg.name, 'blueprint_packages.' || pkg.code, true, true, true,
            'blueprint copy', it.detail, 'homeowner-app', 'unassigned', it.detail, 'both');
  end loop;

  insert into public.project_bookings (project_id, home_project_id, package_code, price_cents, base_price_cents, selections, config_label,
                                       unit, facts, budget_band, note, state, posted_at, target_window, created_by)
  values (v_project, v_home.id, pkg.code, v_price, pkg.base_price_cents, coalesce(p_selections, '{}'::jsonb), v_cfg,
          nullif(btrim(p_unit), ''), p_facts, nullif(btrim(p_budget_band), ''), nullif(btrim(p_note), ''),
          'planned', null, case when v_plan then coalesce(nullif(p_target_window, ''), 'someday') end, 'homeowner-app')
  returning id into v_booking;

  if v_plan then
    begin
      v_list := public.homeowner_diy_checklist(v_project);
    exception when others then
      v_list := jsonb_build_object('ok', false, 'reason', sqlerrm);
    end;
    return jsonb_build_object('ok', true, 'planned', true, 'project_id', v_project, 'home_project_id', v_home.id, 'booking_id', v_booking,
                              'price_cents', v_price, 'target_window', coalesce(nullif(p_target_window, ''), 'someday'),
                              'checklist', v_list);
  end if;
  return public.homeowner_post_internal(v_project);
end $fn$;
