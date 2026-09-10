-- 047 - a quote request says how to reach you.
--
-- Shahar: "add preferred way to connect with you (email, phone)" on the
-- get-a-quote form, and make the confirmation say the same thing.
--
-- The request is a task for a person (Bobby's queue, migration 003), so
-- the preference goes where that person reads: the task notes, as its own
-- line, with the number when a call or a text is asked for. A phone number
-- given here is also kept on the member's contact record if it had none -
-- they typed it once, it should not be asked for twice.
create or replace function public.homeowner_quote_request(
  p_code text, p_note text, p_address text default null,
  p_reach text default 'email', p_phone text default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  me uuid := public.current_app_user_id(); u public.app_users; v_label text; v_home uuid; v_persona uuid; v_id uuid;
  v_reach text := lower(coalesce(nullif(btrim(p_reach), ''), 'email'));
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  v_reach_line text;
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.'); end if;
  if coalesce(btrim(p_note), '') = '' then return jsonb_build_object('ok', false, 'reason', 'Tell us in a sentence what you have in mind.'); end if;
  if v_reach not in ('email', 'phone', 'text') then return jsonb_build_object('ok', false, 'reason', 'Pick email, a call or a text.'); end if;
  select * into u from public.app_users where id = me;

  -- A call or a text needs a number: the one given, else the one on file.
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

  insert into public.actions (action, domain, status, priority, project_id, source, created_by, assigned_to, assigned_to_persona_id, depth_level, notes, desired_outcome)
  values ('Quote request from the homeowner app: ' || v_label || ' - ' || coalesce(u.full_name, u.email, 'a member'),
          'construction', 'Not Started', 'Medium', v_home, 'homeowner_app', 'homeowner-app', 'Bobby', v_persona, 2,
          'Requested in the homeowner app (' || coalesce(p_code, '?') || ').' ||
          E'\nMember: ' || coalesce(u.full_name, '?') || ' <' || coalesce(u.email, '?') || '>' || coalesce(' · ZIP ' || u.home_zip, '') ||
          E'\n' || v_reach_line ||
          coalesce(E'\nAddress: ' || nullif(btrim(p_address), ''), '') ||
          E'\n\nIn their words:\n' || btrim(p_note),
          'The member has a quote (or a clear next step) for ' || v_label || ' and knows who is coming back to them.')
  returning id into v_id;
  return jsonb_build_object('ok', true, 'action_id', v_id, 'reach', v_reach);
end $function$;

comment on function public.homeowner_quote_request(text, text, text, text, text) is
  'A member asks a person for a quote on a package or a community service: one actions row in Bobby''s queue with the package, the member, how they want to be reached (email / phone / text, with the number), the address if given, and their words. A phone given here is kept on the contact if it had none.';

drop function if exists public.homeowner_quote_request(text, text, text);
revoke all on function public.homeowner_quote_request(text, text, text, text, text) from public, anon;
grant execute on function public.homeowner_quote_request(text, text, text, text, text) to authenticated, service_role;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
