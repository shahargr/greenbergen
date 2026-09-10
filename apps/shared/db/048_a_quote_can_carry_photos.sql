-- 048 - a quote request can carry photos and files.
--
-- Shahar: "for all items requiring engagement with an expert, allow to
-- upload images or files."
--
-- The files are recorded the way every file is - browser -> project-media
-- under the member's HOME project -> record_project_file - and then linked
-- to the quote task (file_links.action_id), which is how the person picking
-- the task up finds them. The task itself stays on the Master Template
-- queue (a task cannot hang on a property container, trg_actions_not_on_
-- property), so the link is what joins the two. Only files the member can
-- see are linked; anything else is dropped rather than refused, the same
-- rule send_portal_message applies.
create or replace function public.homeowner_quote_request(
  p_code text, p_note text, p_address text default null,
  p_reach text default 'email', p_phone text default null,
  p_file_ids uuid[] default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  me uuid := public.current_app_user_id(); u public.app_users; v_label text; v_home uuid; v_persona uuid; v_id uuid;
  v_reach text := lower(coalesce(nullif(btrim(p_reach), ''), 'email'));
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  v_reach_line text; f uuid; v_files int := 0;
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.'); end if;
  if coalesce(btrim(p_note), '') = '' then return jsonb_build_object('ok', false, 'reason', 'Tell us in a sentence what you have in mind.'); end if;
  if v_reach not in ('email', 'phone', 'text') then return jsonb_build_object('ok', false, 'reason', 'Pick email, a call or a text.'); end if;
  select * into u from public.app_users where id = me;

  if v_reach in ('phone', 'text') then
    if v_phone is null and u.contact_id is not null then
      select nullif(regexp_replace(coalesce(c.phone, ''), '[^0-9+]', '', 'g'), '') into v_phone from public.contacts c where c.id = u.contact_id;
    end if;
    if v_phone is null then return jsonb_build_object('ok', false, 'reason', 'Add the number to reach you on.'); end if;
    if length(v_phone) < 10 then return jsonb_build_object('ok', false, 'reason', 'That does not look like a phone number.'); end if;
    if u.contact_id is not null then
      update public.contacts set phone = v_phone, last_modified_at = now(), last_modified_by = 'homeowner-app:quote'
       where id = u.contact_id and nullif(btrim(coalesce(phone, '')), '') is null;
    end if;
  end if;
  v_reach_line := case v_reach
    when 'phone' then 'Reach them by: a phone call to ' || v_phone
    when 'text'  then 'Reach them by: a text to ' || v_phone
    else 'Reach them by: email to ' || coalesce(u.email, '?') end;

  select coalesce(bp.name, initcap(replace(p_code, '_', ' '))) into v_label from public.blueprint_packages bp where bp.code = p_code;
  v_label := coalesce(v_label, initcap(replace(coalesce(p_code, 'request'), '_', ' ')));

  select id into v_home from public.projects where project_name = 'Master Template' limit 1;
  select id into v_persona from public.personas where name = 'Bobby';

  -- Count what will be attached before writing the note, so the note says so.
  select count(*) into v_files from unnest(coalesce(p_file_ids, '{}'::uuid[])) x where public.can_see_file(x);

  insert into public.actions (action, domain, status, priority, project_id, source, created_by, assigned_to, assigned_to_persona_id, depth_level, notes, desired_outcome)
  values ('Quote request from the homeowner app: ' || v_label || ' - ' || coalesce(u.full_name, u.email, 'a member'),
          'construction', 'Not Started', 'Medium', v_home, 'homeowner_app', 'homeowner-app', 'Bobby', v_persona, 2,
          'Requested in the homeowner app (' || coalesce(p_code, '?') || ').' ||
          E'\nMember: ' || coalesce(u.full_name, '?') || ' <' || coalesce(u.email, '?') || '>' || coalesce(' · ZIP ' || u.home_zip, '') ||
          E'\n' || v_reach_line ||
          coalesce(E'\nAddress: ' || nullif(btrim(p_address), ''), '') ||
          case when v_files > 0 then E'\nAttached: ' || v_files || case when v_files = 1 then ' file' else ' files' end || ' (on the task)' else '' end ||
          E'\n\nIn their words:\n' || btrim(p_note),
          'The member has a quote (or a clear next step) for ' || v_label || ' and knows who is coming back to them.')
  returning id into v_id;

  foreach f in array coalesce(p_file_ids, '{}'::uuid[]) loop
    if public.can_see_file(f) and not exists (select 1 from public.file_links fl where fl.file_id = f and fl.action_id = v_id) then
      insert into public.file_links (file_id, action_id, role, created_by_user_id) values (f, v_id, 'evidence', me);
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'action_id', v_id, 'reach', v_reach, 'attached', v_files);
end $function$;

comment on function public.homeowner_quote_request(text, text, text, text, text, uuid[]) is
  'A member asks a person for a quote on a package or a community service: one actions row in Bobby''s queue with the package, the member, how to reach them (email / phone / text, with the number), the address if given, their words, and any photos or files they attached (recorded under their home through record_project_file, linked to the task through file_links).';

drop function if exists public.homeowner_quote_request(text, text, text, text, text);
revoke all on function public.homeowner_quote_request(text, text, text, text, text, uuid[]) from public, anon;
grant execute on function public.homeowner_quote_request(text, text, text, text, text, uuid[]) to authenticated, service_role;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
