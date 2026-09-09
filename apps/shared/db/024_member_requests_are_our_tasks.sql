-- 024 - a request from a member is OUR task, and it cannot sit on their house.
--
-- FOUND BY THE CONSTRAINT, testing 023's new waitlist writer:
--
--   23514: Tasks live on a project, not on the property itself. Open or start
--          a project under "52 Ryerson" and add the task there.
--
-- fn_actions_not_on_property is right and the function was wrong. A home
-- container created by create_home_asset IS a property - address set, no
-- home_blueprint_code, parent with no address - so nothing may be filed
-- directly on it. Jobs go in child projects beneath it; that is the whole
-- shape of create_home_project.
--
-- homeowner_quote_request HAS THE SAME BUG, and it is not new: it picks the
-- member's first home the same way and would have raised for every member who
-- has one. It could only ever have succeeded for a member with no home at all,
-- which is why nobody hit it - the quote track is reached from the catalogue,
-- and most people who get that far have not added a home yet.
--
-- THE FIX IS NOT A CHILD PROJECT. Creating one to hold the task would put a
-- phantom job on the member's home for something they only ASKED about, and
-- it would need the customer agreement's create_project right for a row that
-- is not their work at all. These tasks are assigned to Bobby, and their
-- desired outcome is something WE do - come back with a quote, approve a
-- contractor. They belong on our own list. Master Template has no address, so
-- the constraint has nothing to object to, and it is already where every other
-- internal row lives.
--
-- The member's address, name and email stay in the notes exactly as before,
-- so nothing about answering the request gets harder.

create or replace function public.homeowner_quote_request(p_code text, p_note text, p_address text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  me uuid := public.current_app_user_id(); u public.app_users; v_label text; v_home uuid; v_persona uuid; v_id uuid;
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.'); end if;
  if coalesce(btrim(p_note), '') = '' then return jsonb_build_object('ok', false, 'reason', 'Tell us in a sentence what you have in mind.'); end if;
  select * into u from public.app_users where id = me;
  select coalesce(bp.name, initcap(replace(p_code, '_', ' '))) into v_label from public.blueprint_packages bp where bp.code = p_code;
  v_label := coalesce(v_label, initcap(replace(coalesce(p_code, 'request'), '_', ' ')));

  -- Our list, not their house. See the header.
  select id into v_home from public.projects where project_name = 'Master Template' limit 1;
  select id into v_persona from public.personas where name = 'Bobby';

  insert into public.actions (action, domain, status, priority, project_id, source, created_by, assigned_to, assigned_to_persona_id, depth_level, notes, desired_outcome)
  values ('Quote request from the homeowner app: ' || v_label || ' - ' || coalesce(u.full_name, u.email, 'a member'),
          'construction', 'Not Started', 'Medium', v_home, 'homeowner_app', 'homeowner-app', 'Bobby', v_persona, 2,
          'Requested in the homeowner app (' || coalesce(p_code, '?') || ').' ||
          E'\nMember: ' || coalesce(u.full_name, '?') || ' <' || coalesce(u.email, '?') || '>' || coalesce(' · ZIP ' || u.home_zip, '') ||
          coalesce(E'\nAddress: ' || nullif(btrim(p_address), ''), '') ||
          E'\n\nIn their words:\n' || btrim(p_note),
          'The member has a quote (or a clear next step) for ' || v_label || ' and knows who is coming back to them.')
  returning id into v_id;
  return jsonb_build_object('ok', true, 'action_id', v_id);
end $$;

revoke all on function public.homeowner_quote_request(text, text, text) from public, anon;
grant execute on function public.homeowner_quote_request(text, text, text) to authenticated, service_role;

create or replace function public.homeowner_notify_when_covered(p_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  me uuid := public.current_app_user_id();
  u public.app_users; pkg public.blueprint_packages;
  v_home uuid; v_persona uuid; v_id uuid;
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.'); end if;
  select * into pkg from public.blueprint_packages where code = p_code and is_active;
  if pkg.code is null then return jsonb_build_object('ok', false, 'reason', 'We do not have that package.'); end if;
  -- coming_soon has no price, so coverage is not the thing standing in the
  -- way and "already covered" would be a confusing yes. Only a priced package
  -- can be short of a contractor.
  if pkg.availability = 'priced' and public.homeowner_trade_covered(pkg.trade) then
    return jsonb_build_object('ok', true, 'already_covered', true);
  end if;

  select * into u from public.app_users where id = me;

  if exists (select 1 from public.actions a
              where a.source = 'homeowner_app_waitlist'
                and a.notes like '%[waitlist:' || p_code || ':' || me::text || ']%'
                and a.status not in ('Completed','Cancelled','Force Cancelled'))
  then
    return jsonb_build_object('ok', true, 'already_asked', true);
  end if;

  select id into v_home from public.projects where project_name = 'Master Template' limit 1;
  select id into v_persona from public.personas where name = 'Bobby';

  insert into public.actions (action, domain, status, priority, project_id, source, created_by,
                              assigned_to, assigned_to_persona_id, depth_level, notes, desired_outcome)
  values (case when pkg.availability = 'priced'
               then 'Waiting on a ' || pkg.trade || ' contractor: ' || pkg.name
               else 'Waiting on us to price it: ' || pkg.name end
          || ' for ' || coalesce(u.full_name, u.email, 'a member'),
          'construction', 'Not Started', 'Medium', v_home, 'homeowner_app_waitlist', 'homeowner-app',
          'Bobby', v_persona, 2,
          'A member opened ' || pkg.name || ' and asked to be told when we can do it. ' ||
          case when pkg.availability = 'priced'
               then 'Nobody approved carries ' || pkg.trade || ' yet, so the tile is dim and no offer would reach anyone.'
               else 'It is still coming_soon - there is no community price on it yet.' end ||
          E'\nMember: ' || coalesce(u.full_name, '?') || ' <' || coalesce(u.email, '?') || '>' ||
          coalesce(' - ZIP ' || u.home_zip, '') ||
          E'\n\nThis row is the demand signal for recruiting and for what to price next: count them by trade before deciding who to go after.' ||
          E'\n[waitlist:' || p_code || ':' || me::text || ']',
          case when pkg.availability = 'priced'
               then 'A ' || pkg.trade || ' contractor is approved, and this member is told the day it happens.'
               else pkg.name || ' has a community price, and this member is told the day it does.' end)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'action_id', v_id);
end $$;

revoke all on function public.homeowner_notify_when_covered(text) from public, anon;
grant execute on function public.homeowner_notify_when_covered(text) to authenticated, service_role;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
