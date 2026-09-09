-- 039 - you cannot be on site where there is no site.
--
-- Shahar, seeing "Log a site visit - I'm on site" on Green Bergen
-- Development: "there is no greenbergen site to claim i am on site. this is
-- right only when inside a project, not in the top level view."
--
-- He is right, and the line is not "top level" - it is the ADDRESS. A
-- development is a folder of properties and has none; a property has one;
-- a job under it carries the property's. So a visit can be logged wherever
-- a person could actually stand, and nowhere else. The app hides the card by
-- the same test, but the rule has to live here too: portal_site_check only
-- asked whether you were a member, and you are a member of the development,
-- so a stray call would have put you on the roster of a place that does not
-- exist.
create or replace function public.portal_site_check(p_project uuid, p_kind text, p_note text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_contact uuid; v_token uuid; v_today date; v_address text;
begin
  if p_kind not in ('arrive','leave') then raise exception 'Kind must be arrive or leave'; end if;
  select u.contact_id into v_contact from app_users u where u.id = public.current_app_user_id();
  if v_contact is null then raise exception 'Your account has no contact record yet'; end if;
  if not public.is_project_member(p_project) then raise exception 'You are not on this project'; end if;

  -- A site is a place with an address. A development, a template, a container
  -- with no address yet: nothing to arrive at, so nothing to record.
  select p.address into v_address from projects p where p.id = p_project;
  if nullif(btrim(coalesce(v_address, '')), '') is null then
    raise exception 'This project has no site to be on - log the visit on the property or the job.';
  end if;

  v_token := public.portal_my_checkin_token(p_project);
  insert into site_checkins (link_token, kind, note)
  values (v_token, p_kind, nullif(trim(p_note), ''));

  -- Arriving puts you on the day's roster; leaving does not take you off it,
  -- because you were there.
  if p_kind = 'arrive' then
    v_today := (now() at time zone 'America/New_York')::date;
    insert into site_roster (project_id, on_date, contact_id, marked_by_user_id)
    values (p_project, v_today, v_contact, public.current_app_user_id())
    on conflict (project_id, on_date, contact_id) do nothing;
  end if;

  return public.portal_site_day(p_project, (now() at time zone 'America/New_York')::date);
end;
$function$;

comment on function public.portal_site_check(uuid, text, text) is
  'Log arriving at or leaving a site. Members only, and only on a project that HAS a site - one with an address. A development or any addressless container is refused: there is nowhere to stand. Arriving puts you on the day''s roster; leaving does not take you off it.';

revoke all on function public.portal_site_check(uuid, text, text) from public, anon;
grant execute on function public.portal_site_check(uuid, text, text) to authenticated, service_role;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
