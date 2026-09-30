-- 247 A TEXT GOES OUT FROM THE ROOM
--
-- Shahar (2026-09-30): "When adding people into the bid I'd like to add them
-- with their phone number, so I can send them a text to the page created for
-- them. This mechanism already developed and tested by the other application
-- I am building - MicFit. Can you see how integration works there and
-- duplicate it?"
--
-- WHAT MICFIT HAS (github.com/shahargr/micfit, migrations
-- shared_sms_phone_verification, sms_via_twilio_verify, sms_allowed_countries):
-- a platform SMS service that lives in Postgres. The database itself posts to
-- Twilio's REST API with the http extension, reading the account out of
-- Supabase Vault (twilio_account_sid, twilio_auth_token, twilio_from); every
-- attempt is logged; rolling limits per number and per day for the platform
-- are counted from that log; a number that asks too often is flagged and can
-- be blocked; a test mode logs and counts without texting; the countries it
-- texts are a ticked list; and a system-admin screen shows all of it. MicFit
-- uses it to text verification codes. What comes across here is the SEND
-- mechanism, the limits, the log, the flags, the countries and the admin
-- screen. Verification codes stay in MicFit - Green Bergen signs in by email
-- and Google - so sms_verifications and Twilio Verify are not copied.
--
-- WHAT IT IS FOR HERE: the bid room. Since migration 184 every bidder holds
-- his own link (/bid/<token>) and prices the job without an account. Until now
-- the room opened the phone's own Messages app with the words filled in
-- (BidLink, "Text it") and the person running the job pressed send. That
-- stays. portal_bid_text is the second way: the platform texts the link from
-- its own number, so a bidder added by name and phone number gets his page
-- without anybody leaving the screen - and the room can do it for every
-- bidder at once one day.
--
-- SECRETS live in Vault, never in a table or a repository: twilio_account_sid,
-- twilio_auth_token, and twilio_from (a +1 number, or a Messaging Service SID
-- starting "MG"). Until they exist the service reports not_configured and
-- test mode is the way to see the flow.
--
-- GRANTS, per 245: nothing here rides on PUBLIC. anon gets nothing. The
-- internal functions (the Twilio call, the core send, the parser) carry no
-- grant at all; the doors are portal_bid_text and sms_status for anybody
-- signed in, and sms_admin_* for a superadmin.

create extension if not exists http with schema extensions;

-- ---------------------------------------------------------------------------
-- Where the bid page lives, for the link in the text. The app knows its own
-- origin; the database is the one composing the message, so it needs it too.
-- ---------------------------------------------------------------------------
alter table public.config add column if not exists site_origin text;
update public.config set site_origin = coalesce(site_origin, 'https://greenbergen.vercel.app');
comment on column public.config.site_origin is
  'The public host of the portal, with no trailing slash. The bid page a text points to is <site_origin>/bid/<token>.';

-- ---------------------------------------------------------------------------
-- Tables. Nobody reads or writes these directly: RLS on with no policies and
-- the table grants taken away. Every door is one of the functions below.
-- ---------------------------------------------------------------------------
create table public.sms_countries (
  code             text primary key check (code ~ '^[A-Z]{2}$'),
  name             text not null,
  dial_code        text not null check (dial_code ~ '^[0-9]{1,3}$'),
  national_pattern text not null,
  example          text not null,
  sort_order       integer not null default 100
);
comment on table public.sms_countries is
  'Countries the SMS service can text, with the shape of a mobile number there (national significant number, no trunk 0). The admin ticks which are allowed in sms_settings.allowed_countries.';
insert into public.sms_countries (code, name, dial_code, national_pattern, example, sort_order) values
  ('US', 'United States',  '1',   '^[2-9][0-9]{2}[2-9][0-9]{6}$', '(201) 555-0134',    10),
  ('IL', 'Israel',         '972', '^5[0-9]{8}$',                  '050-123-4567',      20),
  ('GB', 'United Kingdom', '44',  '^7[0-9]{9}$',                  '+44 7700 900123',   30),
  ('FR', 'France',         '33',  '^[67][0-9]{8}$',               '+33 6 12 34 56 78', 40),
  ('DE', 'Germany',        '49',  '^1[5-7][0-9]{8,9}$',           '+49 151 23456789',  50),
  ('MX', 'Mexico',         '52',  '^[0-9]{10}$',                  '+52 55 1234 5678',  60),
  ('AU', 'Australia',      '61',  '^4[0-9]{8}$',                  '+61 412 345 678',   70);

create table public.sms_settings (
  id                boolean primary key default true check (id),
  enabled           boolean not null default true,
  -- Test mode is ON at birth: the secrets do not exist yet, and a room that
  -- says "sent" about a text that never went is worse than one that says
  -- "test". Shahar switches it off on /admin/sms once Twilio is in Vault.
  test_mode         boolean not null default true,
  phone_per_hour    integer not null default 3   check (phone_per_hour between 1 and 100),
  phone_per_day     integer not null default 6   check (phone_per_day between 1 and 1000),
  phone_per_year    integer not null default 60  check (phone_per_year between 1 and 100000),
  platform_per_day  integer not null default 200 check (platform_per_day between 0 and 1000000),
  flag_threshold    integer not null default 24  check (flag_threshold between 1 and 100000),
  sender_name       text    not null default 'Green Bergen' check (char_length(sender_name) between 1 and 30),
  allowed_countries text[]  not null default '{US}' check (cardinality(allowed_countries) > 0),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.app_users(id) on delete set null,
  constraint sms_settings_windows_nest check (phone_per_hour <= phone_per_day and phone_per_day <= phone_per_year)
);
comment on table public.sms_settings is
  'Platform-wide SMS settings (one row). Edited by a superadmin on /admin/sms. Copied from MicFit (migration 247).';
comment on column public.sms_settings.test_mode is
  'When on, nothing is texted: the attempt is logged as test and counts toward every limit, and the caller is shown what would have gone.';
comment on column public.sms_settings.platform_per_day is
  'Most texts the whole platform may send in a rolling 24 hours. 0 stops sending.';
comment on column public.sms_settings.flag_threshold is
  'A number with this many requests (sent or refused) in a rolling year is flagged as possible spam.';
insert into public.sms_settings default values;

create table public.sms_send_log (
  id               bigint generated always as identity primary key,
  created_at       timestamptz not null default now(),
  phone            text not null,                    -- E.164 when valid, else the raw input (trimmed)
  phone_valid      boolean not null,
  purpose          text not null,                    -- bid_link today; a name, not a vocabulary table
  project_id       uuid references public.projects(id) on delete set null,
  bid_id           uuid references public.bids(id) on delete set null,
  app_user_id      uuid references public.app_users(id) on delete set null,
  body             text,
  outcome          text not null check (outcome in (
                     'sent', 'test',
                     'invalid_number', 'country_not_allowed', 'disabled', 'blocked',
                     'limit_phone_hour', 'limit_phone_day', 'limit_phone_year', 'limit_platform_day',
                     'not_configured', 'provider_error')),
  provider_status  integer,
  provider_sid     text,
  provider_error   text
);
comment on table public.sms_send_log is
  'Every SMS send attempt, sent or refused. The rate limits and the spam flag are counted from here. Copied from MicFit (migration 247).';
create index sms_send_log_phone_at on public.sms_send_log (phone, created_at desc);
create index sms_send_log_at       on public.sms_send_log (created_at desc);
create index sms_send_log_bid      on public.sms_send_log (bid_id) where bid_id is not null;

create table public.sms_phone_flags (
  phone          text primary key,
  flagged_at     timestamptz not null default now(),
  request_count  integer not null,
  status         text not null default 'flagged' check (status in ('flagged', 'blocked', 'cleared')),
  reviewed_by    uuid references public.app_users(id) on delete set null,
  reviewed_at    timestamptz,
  note           text
);
comment on table public.sms_phone_flags is
  'Numbers flagged as possible spam (flag_threshold requests in a year). blocked refuses every send; cleared is a reviewed false alarm.';

alter table public.sms_countries   enable row level security;
alter table public.sms_settings    enable row level security;
alter table public.sms_send_log    enable row level security;
alter table public.sms_phone_flags enable row level security;
revoke all on public.sms_countries, public.sms_settings, public.sms_send_log, public.sms_phone_flags
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reading a number. A US number in E.164, or null - the strict NANP reading
-- MicFit uses, which also refuses Canada, the Caribbean, toll-free and 555.
-- ---------------------------------------------------------------------------
create or replace function public.us_phone_normalize(p_raw text)
returns text language plpgsql immutable set search_path = public, pg_temp as $function$
declare d text; area text; exch text;
begin
  if p_raw is null then return null; end if;
  if p_raw !~ '^\s*\+?[0-9\s().-]+$' then return null; end if;
  d := regexp_replace(p_raw, '[^0-9]', '', 'g');
  if length(d) = 11 and left(d, 1) = '1' then d := substr(d, 2); end if;
  if length(d) <> 10 then return null; end if;
  if btrim(p_raw) like '+%' and regexp_replace(p_raw, '[^0-9]', '', 'g') !~ '^1[0-9]{10}$' then
    return null;
  end if;
  area := substr(d, 1, 3);
  exch := substr(d, 4, 3);
  if area !~ '^[2-9][0-9]{2}$' or exch !~ '^[2-9][0-9]{2}$' then return null; end if;
  if area ~ '^[2-9]11$' or exch ~ '^[2-9]11$' then return null; end if;
  if area ~ '^[2-9]9[0-9]$' or area ~ '^37[0-9]$' or area ~ '^96[0-9]$' or area = '555' then
    return null;
  end if;
  if area in ('500','521','522','523','524','525','526','527','528','529','533','544','566','577','588',
              '600','622','700','710','800','822','833','844','855','866','877','880','881','882',
              '883','884','885','886','887','888','889','900') then
    return null;
  end if;
  if area in ('204','226','236','249','250','257','263','289','306','343','354','365','367','368',
              '382','387','403','416','418','428','431','437','438','450','460','468','474','506',
              '514','519','548','579','581','584','587','604','613','639','647','672','683','705',
              '709','742','753','778','780','782','807','819','825','851','867','873','879','902','905','942')
     or area in ('242','246','264','268','284','345','441','473','649','658','664','721','758',
                 '767','784','809','829','849','868','869','876') then
    return null;
  end if;
  return '+1' || d;
end;
$function$;
comment on function public.us_phone_normalize(text) is
  'A United States mobile-capable number in E.164 (+1XXXXXXXXXX), or null. Refuses Canada, the Caribbean, toll-free, 555 and reserved area codes. Copied from MicFit.';

-- A mobile number in any listed country, as (e164, country); both null when
-- it cannot be read. Whether that country is allowed is the caller's question.
create or replace function public.sms_phone_parse(p_raw text, out e164 text, out country text)
language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare t text; d text; n text; c record; hits integer := 0;
begin
  t := btrim(coalesce(p_raw, ''));
  if t !~ '^\+?[0-9\s().-]+$' then return; end if;
  d := regexp_replace(t, '[^0-9]', '', 'g');

  if t like '+%' or d like '00%' then
    if d like '00%' and t not like '+%' then d := substr(d, 3); end if;
    for c in select * from sms_countries order by length(dial_code) desc loop
      continue when d not like c.dial_code || '%';
      if c.code = 'US' then
        e164 := us_phone_normalize('+' || d);
      else
        n := regexp_replace(substr(d, length(c.dial_code) + 1), '^0', '');
        if n ~ c.national_pattern then e164 := '+' || c.dial_code || n; end if;
      end if;
      if e164 is not null then country := c.code; end if;
      return;
    end loop;
    return;
  end if;

  if d like '0%' then
    n := substr(d, 2);
    for c in select * from sms_countries where code <> 'US' and n ~ national_pattern loop
      hits := hits + 1;
      e164 := '+' || c.dial_code || n;
      country := c.code;
    end loop;
    if hits <> 1 then e164 := null; country := null; end if;
    return;
  end if;

  e164 := us_phone_normalize(t);
  if e164 is not null then country := 'US'; end if;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Twilio. One authenticated form POST; the account comes out of Vault.
-- ---------------------------------------------------------------------------
create or replace function public.sms_twilio_send(p_to text, p_body text,
  out status integer, out sid text, out error text)
language plpgsql security definer set search_path = public, pg_temp as $function$
declare
  v_sid text; v_token text; v_from text; v_auth text; v_form text;
  r extensions.http_response;
begin
  select max(decrypted_secret) filter (where name = 'twilio_account_sid'),
         max(decrypted_secret) filter (where name = 'twilio_auth_token'),
         max(decrypted_secret) filter (where name = 'twilio_from')
    into v_sid, v_token, v_from
    from vault.decrypted_secrets
   where name in ('twilio_account_sid', 'twilio_auth_token', 'twilio_from');

  if v_sid is null or v_token is null or v_from is null then
    status := null; error := 'not_configured';
    return;
  end if;

  v_auth := replace(encode(convert_to(v_sid || ':' || v_token, 'UTF8'), 'base64'), E'\n', '');
  v_form := 'To=' || extensions.urlencode(p_to)
         || case when v_from like 'MG%'
                 then '&MessagingServiceSid=' || extensions.urlencode(v_from)
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

-- A number that asks too often is flagged for a person to look at. Never
-- blocks on its own; the admin decides.
create or replace function public.sms_flag_if_due(p_phone text, p_threshold integer)
returns void language plpgsql security definer set search_path = public, pg_temp as $function$
declare n integer;
begin
  select count(*) into n from sms_send_log
   where phone = p_phone and created_at > now() - interval '365 days';
  if n >= p_threshold then
    insert into sms_phone_flags (phone, request_count) values (p_phone, n)
    on conflict (phone) do update
       set request_count = excluded.request_count
     where sms_phone_flags.status <> 'blocked';
  end if;
end;
$function$;

-- ---------------------------------------------------------------------------
-- The core send. Internal: every door that texts goes through here, and this
-- is where the limits, the log, the flag and test mode live. Returns
-- {ok, outcome, phone, message} and, on a test, the body that would have gone.
-- ---------------------------------------------------------------------------
create or replace function public.sms_send(p_phone text, p_body text, p_purpose text,
                                           p_project uuid default null, p_bid uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare
  s         sms_settings%rowtype;
  v_phone   text; v_country text;
  v_user    uuid := public.current_app_user_id();
  v_now     timestamptz := now();
  v_outcome text; v_msg text; v_n integer; v_retry timestamptz; v_flag text;
  v_status  integer; v_sid text; v_err text;
begin
  select * into s from sms_settings where id;
  select t.e164, t.country into v_phone, v_country from sms_phone_parse(p_phone) t;

  if v_phone is null then
    insert into sms_send_log (phone, phone_valid, purpose, project_id, bid_id, app_user_id, outcome)
    values (left(btrim(coalesce(p_phone, '')), 40), false, p_purpose, p_project, p_bid, v_user, 'invalid_number');
    return jsonb_build_object('ok', false, 'outcome', 'invalid_number',
      'message', 'That does not read as a mobile number. A US number looks like (201) 555-0134.');
  end if;
  if not (v_country = any (s.allowed_countries)) then
    insert into sms_send_log (phone, phone_valid, purpose, project_id, bid_id, app_user_id, outcome)
    values (v_phone, true, p_purpose, p_project, p_bid, v_user, 'country_not_allowed');
    return jsonb_build_object('ok', false, 'outcome', 'country_not_allowed',
      'message', 'We do not text numbers in that country. An administrator can allow it under Admin > Texts.');
  end if;

  -- One request per number at a time, so two taps cannot both squeeze under a limit.
  perform pg_advisory_xact_lock(hashtext('sms_send:' || v_phone));
  select status into v_flag from sms_phone_flags where phone = v_phone;

  if not s.enabled then
    v_outcome := 'disabled'; v_msg := 'Texting is switched off right now.';
  elsif v_flag = 'blocked' then
    v_outcome := 'blocked'; v_msg := 'This number is blocked from receiving our texts.';
  end if;

  if v_outcome is null then
    select count(*), min(created_at) into v_n, v_retry
      from (select created_at from sms_send_log
             where outcome in ('sent', 'test') and created_at > v_now - interval '24 hours'
             order by created_at desc limit greatest(s.platform_per_day, 1)) x;
    if v_n >= s.platform_per_day then
      v_outcome := 'limit_platform_day';
      v_retry := case when s.platform_per_day = 0 then null else v_retry + interval '24 hours' end;
      v_msg := 'We have sent as many texts as we can today.';
    end if;
  end if;
  if v_outcome is null then
    select count(*), min(created_at) into v_n, v_retry
      from (select created_at from sms_send_log
             where phone = v_phone and outcome in ('sent', 'test') and created_at > v_now - interval '1 hour'
             order by created_at desc limit s.phone_per_hour) x;
    if v_n >= s.phone_per_hour then
      v_outcome := 'limit_phone_hour'; v_retry := v_retry + interval '1 hour';
      v_msg := format('This number has had %s texts in the last hour.', s.phone_per_hour);
    end if;
  end if;
  if v_outcome is null then
    select count(*), min(created_at) into v_n, v_retry
      from (select created_at from sms_send_log
             where phone = v_phone and outcome in ('sent', 'test') and created_at > v_now - interval '24 hours'
             order by created_at desc limit s.phone_per_day) x;
    if v_n >= s.phone_per_day then
      v_outcome := 'limit_phone_day'; v_retry := v_retry + interval '24 hours';
      v_msg := format('This number has had %s texts today.', s.phone_per_day);
    end if;
  end if;
  if v_outcome is null then
    select count(*), min(created_at) into v_n, v_retry
      from (select created_at from sms_send_log
             where phone = v_phone and outcome in ('sent', 'test') and created_at > v_now - interval '365 days'
             order by created_at desc limit s.phone_per_year) x;
    if v_n >= s.phone_per_year then
      v_outcome := 'limit_phone_year'; v_retry := v_retry + interval '365 days';
      v_msg := format('This number has had %s texts this year, the most we send.', s.phone_per_year);
    end if;
  end if;

  if v_outcome is not null then
    insert into sms_send_log (phone, phone_valid, purpose, project_id, bid_id, app_user_id, outcome)
    values (v_phone, true, p_purpose, p_project, p_bid, v_user, v_outcome);
    perform sms_flag_if_due(v_phone, s.flag_threshold);
    return jsonb_build_object('ok', false, 'outcome', v_outcome, 'phone', v_phone, 'retry_at', v_retry,
      'message', v_msg || case when v_retry is not null
                               then ' You can try again after ' ||
                                    to_char(v_retry at time zone 'America/New_York', 'Mon FMDD, FMHH12:MI AM') || ' ET.'
                               else '' end);
  end if;

  if s.test_mode then
    v_status := null; v_sid := null; v_err := null; v_outcome := 'test';
  else
    select t.status, t.sid, t.error into v_status, v_sid, v_err from sms_twilio_send(v_phone, p_body) t;
    v_outcome := case when v_err = 'not_configured' then 'not_configured'
                      when v_status between 200 and 299 then 'sent'
                      else 'provider_error' end;
  end if;

  insert into sms_send_log (phone, phone_valid, purpose, project_id, bid_id, app_user_id, body, outcome,
                            provider_status, provider_sid, provider_error)
  values (v_phone, true, p_purpose, p_project, p_bid, v_user, p_body, v_outcome,
          v_status, v_sid, nullif(v_err, 'not_configured'));
  perform sms_flag_if_due(v_phone, s.flag_threshold);

  if v_outcome = 'test' then
    return jsonb_build_object('ok', true, 'outcome', 'test', 'phone', v_phone, 'body', p_body,
      'message', 'Test mode: nothing was texted. This is what would have gone to ' || v_phone || '.');
  end if;
  if v_outcome <> 'sent' then
    return jsonb_build_object('ok', false, 'outcome', v_outcome, 'phone', v_phone,
      'message', case when v_outcome = 'not_configured'
                      then 'Texting is not set up yet: the Twilio secrets are missing from Vault. Test mode works without them.'
                      else 'The text could not be sent just now. Check the number and try again.' end);
  end if;
  return jsonb_build_object('ok', true, 'outcome', 'sent', 'phone', v_phone, 'sid', v_sid,
    'message', 'Texted to ' || v_phone || '.');
end;
$function$;

-- ---------------------------------------------------------------------------
-- THE DOOR THE ROOM USES. Texts a bidder his own link. The token, the wording
-- and the phone come from portal_bid_link, so the text says exactly what the
-- Messages button would have said; the URL is composed here from
-- config.site_origin, never taken from the caller.
-- ---------------------------------------------------------------------------
create or replace function public.portal_bid_text(p_bid uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare
  b public.bids; lk jsonb; v_origin text; v_body text; r jsonb;
begin
  perform public.assert_own_hands();
  select * into b from public.bids where id = p_bid;
  if b.id is null or not public.bid_can_manage(b.project_id) then
    return jsonb_build_object('ok', false, 'reason', 'That bid is not yours to send.');
  end if;
  if b.status in ('awarded', 'not awarded', 'declined', 'withdrawn', 'expired') then
    return jsonb_build_object('ok', false, 'reason', 'This bidder is settled; there is nothing to text him about.');
  end if;

  lk := public.portal_bid_link(p_bid, false);
  if not coalesce((lk ->> 'ok')::boolean, false) then return lk; end if;
  if nullif(btrim(coalesce(lk ->> 'phone', '')), '') is null then
    return jsonb_build_object('ok', false, 'reason', 'There is no phone number for ' || coalesce(lk ->> 'who', 'this bidder') || '. Add one on his row first.');
  end if;

  select coalesce(nullif(btrim(site_origin), ''), 'https://greenbergen.vercel.app') into v_origin from public.config limit 1;
  v_body := (lk ->> 'message') || ' ' || v_origin || '/bid/' || (lk ->> 'token');

  r := public.sms_send(lk ->> 'phone', v_body, 'bid_link', b.project_id, p_bid);
  if coalesce((r ->> 'outcome'), '') = 'sent' then
    update public.bids set token_sent_at = now(), last_modified_at = now(), last_modified_by = 'portal:bid-link:sms'
     where id = p_bid;
  end if;
  return r || jsonb_build_object('reason', r ->> 'message', 'who', lk ->> 'who');
end;
$function$;
comment on function public.portal_bid_text(uuid) is
  'Texts a bidder his own /bid/<token> link from the platform''s number (Twilio, via sms_send). Only somebody who may run the bid; stamps token_sent_at on a real send, not on a test. Returns sms_send''s answer with reason and who.';

-- What a screen needs to know before offering the button.
create or replace function public.sms_status()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $function$
  select jsonb_build_object(
    'enabled', s.enabled, 'test_mode', s.test_mode,
    'configured', (select count(*) = 3 from vault.secrets where name in ('twilio_account_sid', 'twilio_auth_token', 'twilio_from')),
    'allowed_countries', to_jsonb(s.allowed_countries))
    from sms_settings s where s.id
$function$;

-- ---------------------------------------------------------------------------
-- The admin screen: /admin/sms. Superadmin only, checked here, not in the app.
-- ---------------------------------------------------------------------------
create or replace function public.sms_admin_overview()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare r jsonb;
begin
  if not public.is_superadmin() then raise exception 'Only an administrator can see the texting service.'; end if;
  select jsonb_build_object(
    'settings', (select to_jsonb(s) - 'id' from sms_settings s where id),
    'provider', jsonb_build_object(
       'account_sid', exists (select 1 from vault.secrets where name = 'twilio_account_sid'),
       'auth_token',  exists (select 1 from vault.secrets where name = 'twilio_auth_token'),
       'from',        exists (select 1 from vault.secrets where name = 'twilio_from')),
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

create or replace function public.sms_admin_save_settings(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare v_countries text[];
begin
  if not public.is_superadmin() then return jsonb_build_object('ok', false, 'reason', 'Only an administrator can change texting settings.'); end if;
  if p ? 'allowed_countries' then
    select array_agg(x) into v_countries from jsonb_array_elements_text(p -> 'allowed_countries') x
     where x in (select code from sms_countries);
    if coalesce(cardinality(v_countries), 0) = 0 then
      return jsonb_build_object('ok', false, 'reason', 'Tick at least one country.');
    end if;
  end if;
  begin
    update sms_settings set
      enabled           = coalesce((p ->> 'enabled')::boolean, enabled),
      test_mode         = coalesce((p ->> 'test_mode')::boolean, test_mode),
      phone_per_hour    = coalesce((p ->> 'phone_per_hour')::integer, phone_per_hour),
      phone_per_day     = coalesce((p ->> 'phone_per_day')::integer, phone_per_day),
      phone_per_year    = coalesce((p ->> 'phone_per_year')::integer, phone_per_year),
      platform_per_day  = coalesce((p ->> 'platform_per_day')::integer, platform_per_day),
      flag_threshold    = coalesce((p ->> 'flag_threshold')::integer, flag_threshold),
      sender_name       = coalesce(nullif(btrim(p ->> 'sender_name'), ''), sender_name),
      allowed_countries = coalesce(v_countries, allowed_countries),
      updated_at        = now(),
      updated_by        = public.current_app_user_id()
    where id;
    if p ? 'site_origin' and nullif(btrim(p ->> 'site_origin'), '') is not null then
      update config set site_origin = regexp_replace(btrim(p ->> 'site_origin'), '/+$', '');
    end if;
  exception
    when check_violation then
      return jsonb_build_object('ok', false, 'reason', 'Those limits do not fit together: per hour <= per day <= per year, and each within its range.');
    when invalid_text_representation then
      return jsonb_build_object('ok', false, 'reason', 'Every limit has to be a whole number.');
  end;
  return jsonb_build_object('ok', true);
end;
$function$;

create or replace function public.sms_admin_set_flag(p_phone text, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare v_phone text;
begin
  if not public.is_superadmin() then return jsonb_build_object('ok', false, 'reason', 'Only an administrator can block a number.'); end if;
  select t.e164 into v_phone from sms_phone_parse(p_phone) t;
  if v_phone is null then return jsonb_build_object('ok', false, 'reason', 'That is not a mobile number we can read.'); end if;
  if p_status not in ('flagged', 'blocked', 'cleared') then return jsonb_build_object('ok', false, 'reason', 'Status must be flagged, blocked or cleared.'); end if;
  insert into sms_phone_flags (phone, request_count, status, reviewed_by, reviewed_at, note)
  values (v_phone,
          (select count(*) from sms_send_log where phone = v_phone and created_at > now() - interval '365 days'),
          p_status, public.current_app_user_id(), now(), nullif(btrim(p_note), ''))
  on conflict (phone) do update
     set status = excluded.status, reviewed_by = excluded.reviewed_by,
         reviewed_at = excluded.reviewed_at, note = coalesce(excluded.note, sms_phone_flags.note);
  return jsonb_build_object('ok', true, 'phone', v_phone, 'status', p_status);
end;
$function$;

-- ---------------------------------------------------------------------------
-- Who may call what (245: nothing on PUBLIC, anon by name only, and none here).
-- ---------------------------------------------------------------------------
revoke all on function public.us_phone_normalize(text)                    from public, anon, authenticated;
revoke all on function public.sms_phone_parse(text)                       from public, anon, authenticated;
revoke all on function public.sms_twilio_send(text, text)                 from public, anon, authenticated;
revoke all on function public.sms_flag_if_due(text, integer)              from public, anon, authenticated;
revoke all on function public.sms_send(text, text, text, uuid, uuid)      from public, anon, authenticated;
revoke all on function public.portal_bid_text(uuid)                       from public, anon;
revoke all on function public.sms_status()                                from public, anon;
revoke all on function public.sms_admin_overview()                        from public, anon;
revoke all on function public.sms_admin_save_settings(jsonb)              from public, anon;
revoke all on function public.sms_admin_set_flag(text, text, text)        from public, anon;

grant execute on function public.portal_bid_text(uuid)                to authenticated, service_role;
grant execute on function public.sms_status()                         to authenticated, service_role;
grant execute on function public.sms_admin_overview()                 to authenticated, service_role;
grant execute on function public.sms_admin_save_settings(jsonb)       to authenticated, service_role;
grant execute on function public.sms_admin_set_flag(text, text, text) to authenticated, service_role;
grant execute on function public.sms_send(text, text, text, uuid, uuid) to service_role;

update public.config set schema_version = schema_version + 1, schema_updated_at = current_date;
