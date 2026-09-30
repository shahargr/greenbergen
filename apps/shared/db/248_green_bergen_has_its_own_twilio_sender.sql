-- 248 GREEN BERGEN HAS ITS OWN TWILIO SENDER
--
-- Shahar (2026-09-30): "Make the changes to the twilio service so it has a
-- different instance / configuration for Green Bergen Development."
--
-- The account is already separate: this project reads its OWN Vault, so
-- nothing MicFit holds is visible here. What 247 lacked was a first-class
-- way to name a dedicated Messaging Service, which is how Twilio keeps one
-- product's traffic apart from another's inside one account: its own number
-- pool, its own A2P registration, its own logs and its own spend line. It
-- rode on twilio_from "if it starts with MG". Now it has a name of its own,
-- and the admin screen says which sender is in use.
--
-- THE FOUR SECRETS, in Vault (Project Settings > Vault), in this order of
-- preference for the sender:
--   twilio_account_sid             the account or SUBACCOUNT (starts AC)
--   twilio_auth_token              its auth token
--   twilio_messaging_service_sid   the Messaging Service (starts MG) - preferred
--   twilio_from                    a bare +1 number, used only when no MG is set
-- A subaccount named for Green Bergen is the cleanest split: separate
-- credentials, separate bill, and MicFit's keys never touch this database.

create or replace function public.sms_twilio_send(p_to text, p_body text,
  out status integer, out sid text, out error text)
language plpgsql security definer set search_path = public, pg_temp as $function$
declare
  v_sid text; v_token text; v_from text; v_service text; v_auth text; v_form text;
  r extensions.http_response;
begin
  select max(decrypted_secret) filter (where name = 'twilio_account_sid'),
         max(decrypted_secret) filter (where name = 'twilio_auth_token'),
         max(decrypted_secret) filter (where name = 'twilio_from'),
         max(decrypted_secret) filter (where name = 'twilio_messaging_service_sid')
    into v_sid, v_token, v_from, v_service
    from vault.decrypted_secrets
   where name in ('twilio_account_sid', 'twilio_auth_token', 'twilio_from', 'twilio_messaging_service_sid');

  -- A Messaging Service wins; a bare number is the fallback. twilio_from
  -- holding an MG sid still works, as it did in 247.
  if v_service is null and v_from like 'MG%' then v_service := v_from; v_from := null; end if;

  if v_sid is null or v_token is null or (v_service is null and v_from is null) then
    status := null; error := 'not_configured';
    return;
  end if;

  v_auth := replace(encode(convert_to(v_sid || ':' || v_token, 'UTF8'), 'base64'), E'\n', '');
  v_form := 'To=' || extensions.urlencode(p_to)
         || case when v_service is not null
                 then '&MessagingServiceSid=' || extensions.urlencode(v_service)
                 else '&From=' || extensions.urlencode(v_from) end
         || '&Body=' || extensions.urlencode(p_body);

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '10000');
  begin
    r := extensions.http((
      'POST',
      'https://api.twilio.com/2010-04-01/Accounts/' || v_sid || '/Messages.json',
      array[extensions.http_header('Authorization', 'Basic ' || v_auth)],
      'application/x-www-form-urlencoded',
      v_form
    )::extensions.http_request);
  exception when others then
    status := null; error := left('request failed: ' || sqlerrm, 500);
    return;
  end;

  status := r.status;
  begin
    if r.status between 200 and 299 then
      sid := (r.content::jsonb) ->> 'sid';
    else
      error := left(coalesce((r.content::jsonb) ->> 'code', '') || ' ' ||
                    coalesce((r.content::jsonb) ->> 'message', r.content), 500);
    end if;
  exception when others then
    if r.status not between 200 and 299 then error := left(r.content, 500); end if;
  end;
end;
$function$;

-- Which secrets exist, without reading any of them. The account is the
-- first two; the sender is a Messaging Service OR a number.
create or replace function public.sms_provider_state()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $function$
  select jsonb_build_object(
    'account_sid',       exists (select 1 from vault.secrets where name = 'twilio_account_sid'),
    'auth_token',        exists (select 1 from vault.secrets where name = 'twilio_auth_token'),
    'messaging_service', exists (select 1 from vault.secrets where name = 'twilio_messaging_service_sid'),
    'from',              exists (select 1 from vault.secrets where name = 'twilio_from'),
    'configured',        exists (select 1 from vault.secrets where name = 'twilio_account_sid')
                     and exists (select 1 from vault.secrets where name = 'twilio_auth_token')
                     and exists (select 1 from vault.secrets where name in ('twilio_messaging_service_sid', 'twilio_from')))
$function$;
revoke all on function public.sms_provider_state() from public, anon, authenticated;

create or replace function public.sms_status()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $function$
  select jsonb_build_object(
    'enabled', s.enabled, 'test_mode', s.test_mode,
    'configured', (public.sms_provider_state() ->> 'configured')::boolean,
    'allowed_countries', to_jsonb(s.allowed_countries))
    from sms_settings s where s.id
$function$;

create or replace function public.sms_admin_overview()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare r jsonb;
begin
  if not public.is_superadmin() then raise exception 'Only an administrator can see the texting service.'; end if;
  select jsonb_build_object(
    'settings', (select to_jsonb(s) - 'id' from sms_settings s where id),
    'provider', public.sms_provider_state(),
    'site_origin', (select site_origin from config limit 1),
    'last_24h', jsonb_build_object(
       'sent',    (select count(*) from sms_send_log where outcome = 'sent' and created_at > now() - interval '24 hours'),
       'test',    (select count(*) from sms_send_log where outcome = 'test' and created_at > now() - interval '24 hours'),
       'refused', (select count(*) from sms_send_log where (outcome like 'limit_%' or outcome in ('blocked','disabled','invalid_number','country_not_allowed'))
                                                      and created_at > now() - interval '24 hours'),
       'failed',  (select count(*) from sms_send_log where outcome in ('provider_error','not_configured') and created_at > now() - interval '24 hours')),
    'countries', coalesce((select jsonb_agg(jsonb_build_object('code', c.code, 'name', c.name, 'dial_code', c.dial_code, 'example', c.example) order by c.sort_order)
                            from sms_countries c), '[]'::jsonb),
    'flags', coalesce((
       select jsonb_agg(jsonb_build_object(
                'phone', f.phone, 'status', f.status, 'flagged_at', f.flagged_at,
                'request_count', f.request_count, 'reviewed_at', f.reviewed_at, 'note', f.note)
              order by (f.status = 'flagged') desc, f.flagged_at desc)
         from sms_phone_flags f), '[]'::jsonb),
    'log', coalesce((
       select jsonb_agg(jsonb_build_object(
                'at', l.created_at, 'phone', l.phone, 'purpose', l.purpose,
                'project', p.project_name, 'who', coalesce(u.full_name, u.email),
                'outcome', l.outcome, 'error', l.provider_error, 'body', l.body)
              order by l.created_at desc)
         from (select * from sms_send_log order by created_at desc limit 200) l
         left join projects p on p.id = l.project_id
         left join app_users u on u.id = l.app_user_id), '[]'::jsonb)
  ) into r;
  return r;
end;
$function$;

update public.config set schema_version = schema_version + 1, schema_updated_at = current_date;
