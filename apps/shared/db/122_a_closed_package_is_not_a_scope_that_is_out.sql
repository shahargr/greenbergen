-- 122. A CLOSED PACKAGE IS NOT A SCOPE THAT IS OUT.
--
-- Shahar (2026-09-14): "note that the project is closed, yet, it shows as
-- open. image 3 - getting prices."
--
-- He closed the EV charger request - homeowner_booking_action('close') shuts
-- the bid package, expires the bids and marks the booking closed - and the
-- list went on saying "Getting prices · the scope is out, no prices back
-- yet". My fault, one migration old: 119 counted every bid_packages row ever
-- written and every bids row ever written, whatever state they were in. A
-- package somebody closed is not a scope that is out, and an expired bid is
-- not a price in.
--
-- So the evidence has to be live evidence. Packages that are not closed;
-- bids that are actually prices somebody named - received, under
-- negotiation, awarded. An invitation nobody answered is the scope being
-- out, which is the rung below, and that is where it now lands.
--
-- On his eight that turns:
--   EV charger install x2   Getting prices -> On your list, 3 things to do
--   Standby generator       Comparing prices -> On your list, 2 things to do
-- and leaves New build ("Work under way") and the rest where they were.
--
-- Also here: REOPENING IS THE OWNER'S. "project owners should be able to
-- re-open the project / saved by mistake." It was a superadmin decision
-- because closing freezes the record - but the person whose job it is, and
-- who closed it by accident, is exactly who should be able to say so. Rank 70
-- now, the reason still written onto the project, and it comes out of the
-- archive on the way back so a reopened job cannot be hiding.
--

create or replace function public.project_progress(p_project uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  p public.projects; ord int; bstate text;
  v_pkgs int; v_bids int; v_crew int; v_done int; v_open int; v_contracts int; v_paid numeric;
begin
  select * into p from public.projects where id = p_project;
  if p.id is null then return null; end if;

  if p.status = 'Closed - Completed' then
    return jsonb_build_object('key','done','label','Done','detail','finished and signed off','order',9);
  end if;
  if p.status like 'Closed%' then
    return jsonb_build_object('key','cancelled','label','Cancelled','detail','it will not happen','order',9);
  end if;

  select b.state into bstate from public.project_bookings b where b.project_id = p_project;

  -- Live evidence only. A package somebody closed is not a scope that is out,
  -- and an expired bid is not a price in.
  select count(*) into v_pkgs from public.bid_packages
   where project_id = p_project and coalesce(status,'') <> 'closed';
  select count(*) into v_bids from public.bids
   where project_id = p_project and coalesce(status,'') in ('received','under negotiation','awarded');

  select count(*) into v_crew from public.project_members
   where project_id = p_project and status = 'active'
     and coalesce(project_role,'') not in ('asset owner','viewer');
  select count(*) filter (where status = 'Completed'),
         count(*) filter (where status not in ('Completed','Cancelled','Force Cancelled','Superseded'))
    into v_done, v_open
    from public.actions where project_id = p_project;
  select count(*) into v_contracts from public.contracts
   where project_id = p_project and coalesce(status,'') <> 'placeholder';
  select coalesce(sum(amount), 0) into v_paid from public.transactions
   where project_id = p_project
     and coalesce(status,'') in ('paid','paid - receipt filed','paid - pending confirmation','settled');

  ord := coalesce((select stage_order from public.engagement_stages where stage = p.stage), 0);

  if bstate = 'planned' then
    return jsonb_build_object('key','planned','label','Planned','detail','a price, nobody hired yet','order',0);
  end if;
  if bstate = 'posted' then
    return jsonb_build_object('key','finding','label','Finding someone','detail','out to the community','order',1);
  end if;

  if ord >= 6 and (v_crew > 0 or v_contracts > 0 or v_paid > 0 or v_done > 0) then
    if p.stage = 'delivered' then
      return jsonb_build_object('key','delivered','label','They say it''s finished',
        'detail','nobody has walked it and the town has not seen it','order',7);
    elsif p.stage = 'verification' then
      return jsonb_build_object('key','verification','label','Waiting on sign-off',
        'detail','yours, the town''s, or both','order',8);
    end if;
    return jsonb_build_object('key','active','label','Work under way',
      'detail', coalesce(nullif(concat_ws(' · ',
        case when v_crew > 0 then v_crew || (case when v_crew = 1 then ' person' else ' people' end) || ' on it' end,
        case when v_done > 0 then v_done || ' done' end), ''), 'on site'),
      'order', 6);
  end if;

  if v_bids > 0 then
    return jsonb_build_object('key','compare','label','Comparing prices',
      'detail', v_bids || (case when v_bids = 1 then ' price in' else ' prices in' end), 'order', 2);
  end if;
  if v_pkgs > 0 then
    return jsonb_build_object('key','bid','label','Getting prices',
      'detail','the scope is out, no prices back yet','order',1);
  end if;

  if v_open > 0 then
    return jsonb_build_object('key','listed','label','On your list',
      'detail', v_open || (case when v_open = 1 then ' thing' else ' things' end) || ' to do, nobody on it yet',
      'order', 0);
  end if;
  return jsonb_build_object('key','not_started','label','Not started','detail','nothing on it yet','order',0);
end $fn$;

create or replace function public.portal_project_reopen(p_project uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare p public.projects; v_actor text; v_prev text;
begin
  perform public.assert_own_hands();
  select * into p from public.projects where id = p_project;
  if p.id is null then return jsonb_build_object('ok', false, 'reason', 'No such project.'); end if;
  if not (public.is_superadmin() or coalesce(public.my_authority_rank(p_project), 0) >= 70) then
    return jsonb_build_object('ok', false, 'reason', 'Reopening a closed job is the owner''s to do.');
  end if;
  if p.status not like 'Closed%' then
    return jsonb_build_object('ok', false, 'reason', format('%s is not closed.', p.project_name));
  end if;

  select coalesce(u.full_name, u.email) into v_actor
    from public.app_users u where u.id = public.current_app_user_id();

  v_prev := coalesce(current_setting('sgr.superadmin', true), '');
  perform set_config('sgr.superadmin', 'on', true);
  begin
    update public.projects
       set status = 'In Progress',
           stage = case when stage = 'close' then 'active' else stage end,
           archived_at = null, archived_by = null,
           notes = coalesce(notes || E'\n\n', '')
                   || 'REOPENED ' || to_char(current_date, 'YYYY-MM-DD')
                   || ' by ' || coalesce(v_actor, 'portal')
                   || coalesce(': ' || nullif(btrim(p_reason), ''), '') || '.',
           last_modified_at = now(), last_modified_by = 'portal:reopen'
     where id = p_project;
  exception when others then
    perform set_config('sgr.superadmin', v_prev, true);
    raise;
  end;
  perform set_config('sgr.superadmin', v_prev, true);

  return jsonb_build_object('ok', true, 'project_id', p_project, 'name', p.project_name);
end $fn$;

comment on function public.portal_project_reopen(uuid, text) is
  'Reopens a closed job: status back to In Progress, stage off close, and it comes out of the archive with it. The owner (rank 70) or a superadmin; the reason is written onto the project.';

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
