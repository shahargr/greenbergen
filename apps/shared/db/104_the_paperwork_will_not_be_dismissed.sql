-- 104. THE PAPERWORK WILL NOT BE DISMISSED.
--
-- Shahar (2026-09-14): "remove the 4 things left from my professional login
-- page into messages i cannot dismiss without uploading these papers. this way
-- the messages stays un-opened all the time until they are resolved."
--
-- The four things were a shut drawer on /work saying "4 things left". A shut
-- drawer is a thing you stop seeing on the second day. A message that will not
-- go away is not - it sits in Waiting on you with its dot lit, and the only
-- button on it is the one that fixes it.
--
-- Three parts:
--   1. messages.requires - the gap this message is standing in for.
--   2. contractor_paperwork_sync - opens one message per gap, closes it the
--      moment the gap closes. Idempotent; safe to call on every page load.
--   3. a trigger that refuses to let a requires-message be read, archived,
--      completed or deleted while its gap is still open. The app hides those
--      buttons, but the app is not the rule - this is.
--
-- Nothing here decides what "missing" means: contractor_readiness has always
-- known, and this asks it.

-- ---------------------------------------------------------------- the column
alter table public.messages add column if not exists requires text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_messages_requires') then
    alter table public.messages add constraint chk_messages_requires
      check (requires is null or requires in
             ('business', 'trades', 'licence', 'liability', 'workers_comp', 'w9'));
  end if;
end $$;

comment on column public.messages.requires is
  'The readiness gap this message stands in for. While the gap is open the message cannot be read, archived, completed or deleted - it is the nag, and the nag is the point.';

-- One open message per gap per person, and the trigger looks the row up by
-- exactly this key.
create index if not exists idx_messages_requires
  on public.messages (to_contact_id, requires)
  where requires is not null;

-- ------------------------------------------------------------ what each is
create or replace function public.contractor_paper_label(p_key text)
returns text
language sql
immutable
as $$
  select case p_key
    when 'business'     then 'Your business'
    when 'trades'       then 'The trades you work'
    when 'licence'      then 'Your trade licence'
    when 'liability'    then 'General liability certificate'
    when 'workers_comp' then 'Workers'' compensation certificate'
    when 'w9'           then 'A signed W-9'
    else 'A document' end;
$$;

-- Is this gap still open? contractor_readiness is the authority on the four
-- papers; the other two are read where they live.
create or replace function public.contractor_paper_open(p_contact uuid, p_key text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare r jsonb; v_company uuid;
begin
  if p_contact is null or p_key is null then return false; end if;
  select company_id into v_company from public.contacts where id = p_contact;

  if p_key = 'business' then
    return coalesce(nullif(btrim(coalesce(
      (select company_name from public.companies where id = v_company), '')), ''), '') = '';
  elsif p_key = 'trades' then
    return not exists (select 1 from public.company_trade_roles where company_id = v_company)
       and not exists (select 1 from public.contact_trade_roles where contact_id = p_contact);
  end if;

  r := public.contractor_readiness(p_contact);
  if r is null then return false; end if;
  r := r->'documents'->p_key;
  if r is null then return false; end if;
  -- A licence is only asked of the trades that need one, so "needed" is part
  -- of the question, not a formality.
  return coalesce((r->>'needed')::boolean, false)
     and not coalesce((r->>'on_file')::boolean, false);
end $$;

comment on function public.contractor_paper_open(uuid, text) is
  'Is this readiness gap still open for this contractor? The one question both the sync and the trigger ask.';

-- ------------------------------------------------------------- what it says
create or replace function public.contractor_paper_note(p_key text)
returns text
language sql
immutable
as $$
  select case p_key
    when 'business' then
      'Tell us about your business.' || chr(10) ||
      'The name, the phone, where you work. Everything else - certificates, a W-9, the jobs you take - hangs off it, so it is the first thing.'
    when 'trades' then
      'Which trades do you work?' || chr(10) ||
      'Pick them and the work in them starts showing up. Nobody sees a job in a trade they do not work.'
    when 'licence' then
      'Your trade licence is missing.' || chr(10) ||
      'One of the trades you picked is licensed, so we need the number and a picture of the licence. A neighbour is letting a stranger into their house on our word.'
    when 'liability' then
      'We need your general liability certificate.' || chr(10) ||
      'The current one, in your business name. Upload it with the date it runs out and this clears itself.'
    when 'workers_comp' then
      'We need your workers'' compensation certificate.' || chr(10) ||
      'Or your exemption, if you work alone. Upload it with the date it runs out and this clears itself.'
    when 'w9' then
      'We need a signed W-9.' || chr(10) ||
      'So the paperwork is done before your first payment rather than on the day you are waiting for it.'
    else 'Something is missing from your file.' end;
$$;

-- ------------------------------------------------------------------ the sync
-- One message per open gap, no message for a closed one. Called on the pro
-- app's landing and inbox, and by contractor_document_upload the instant a
-- paper lands - so a message is never the last thing to find out.
create or replace function public.contractor_paperwork_sync(p_contact uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_contact uuid; k text; v_open boolean; v_id uuid;
  v_made int := 0; v_closed int := 0;
  v_keys constant text[] := array['business', 'trades', 'licence', 'liability', 'workers_comp', 'w9'];
begin
  v_contact := coalesce(p_contact,
    (select u.contact_id from public.app_users u where u.id = public.current_app_user_id()));
  if v_contact is null then
    return jsonb_build_object('ok', false, 'reason', 'No contact record on this account.');
  end if;
  -- Only for someone who actually came in the professional door. A homeowner
  -- does not owe us a W-9.
  if not exists (select 1 from public.contractor_approvals where contact_id = v_contact) then
    return jsonb_build_object('ok', true, 'opened', 0, 'closed', 0);
  end if;

  foreach k in array v_keys loop
    v_open := public.contractor_paper_open(v_contact, k);
    select id into v_id from public.messages
     where to_contact_id = v_contact and requires = k
       and status not in ('dismissed', 'done')
     limit 1;

    if v_open and v_id is null then
      insert into public.messages
        (body, direction, sender, to_contact_id, channel, status, sent_at, created_by, requires)
      values (public.contractor_paper_note(k), 'inbound', 'Green Bergen', v_contact,
              'in app', 'new', now(), 'system:paperwork', k);
      v_made := v_made + 1;
    elsif not v_open and v_id is not null then
      -- The gap closed. The message closes with it - read, handled, done -
      -- and lands in Archived as a record that it was once owed.
      update public.messages
         set read_at = coalesce(read_at, now()),
             handled_at = coalesce(handled_at, now()),
             status = 'done',
             last_modified_at = now(),
             last_modified_by = 'system:paperwork'
       where id = v_id;
      v_closed := v_closed + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'opened', v_made, 'closed', v_closed);
end $$;

comment on function public.contractor_paperwork_sync(uuid) is
  'Opens one inbox message per open readiness gap and closes it when the gap closes. Idempotent - safe on every page load.';

grant execute on function public.contractor_paperwork_sync(uuid) to authenticated;

-- ----------------------------------------------------------------- the rule
-- "messages i cannot dismiss without uploading these papers." The app hides
-- Mark read and Archive on these rows; this is what makes it true.
create or replace function public.fn_messages_paperwork_stands()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_key text;
begin
  v_key := old.requires;
  if v_key is null or not public.contractor_paper_open(old.to_contact_id, v_key) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    raise exception '% is still missing. Upload it and this message clears itself.',
      public.contractor_paper_label(v_key) using errcode = '23514';
  end if;

  if new.read_at is not null or new.handled_at is not null
     or new.status in ('dismissed', 'done') then
    raise exception '% is still missing. Upload it and this message clears itself.',
      public.contractor_paper_label(v_key) using errcode = '23514';
  end if;

  return new;
end $$;

drop trigger if exists trg_messages_paperwork_stands on public.messages;
create trigger trg_messages_paperwork_stands
  before update or delete on public.messages
  for each row execute function public.fn_messages_paperwork_stands();

-- -------------------------------------------------------------- the upload
-- The papers had nowhere to go: /business/documents told the truth about what
-- was on file and then said "email them to us". The credentials bucket and
-- contact_credentials have been here the whole time - this is the door
-- between them and what contractor_readiness actually reads.
create or replace function public.contractor_document_upload(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_contact uuid; v_company uuid;
  v_key text := nullif(p->>'key', '');
  v_path text := nullif(btrim(coalesce(p->>'path', '')), '');
  v_bucket text := coalesce(nullif(p->>'bucket', ''), 'credentials');
  v_name text := nullif(p->>'file_name', '');
  v_num text := nullif(btrim(coalesce(p->>'number', '')), '');
  v_issuer text := nullif(btrim(coalesce(p->>'issuer', '')), '');
  v_exp date := nullif(p->>'expires_on', '')::date;
  v_kind text;
begin
  select u.contact_id into v_contact from public.app_users u where u.id = public.current_app_user_id();
  if v_contact is null then return jsonb_build_object('ok', false, 'reason', 'Sign in first.'); end if;
  select company_id into v_company from public.contacts where id = v_contact;

  if v_key is null or v_key not in ('licence', 'liability', 'workers_comp', 'w9') then
    return jsonb_build_object('ok', false, 'reason', 'That is not one of the documents we ask for.');
  end if;
  if v_path is null then
    return jsonb_build_object('ok', false, 'reason', 'Attach the document first.');
  end if;
  -- The path is the contractor's own folder in the credentials bucket, which
  -- is what the storage policy allows them to write. Anything else is someone
  -- pointing at a file that is not theirs.
  if split_part(v_path, '/', 1) <> v_contact::text then
    return jsonb_build_object('ok', false, 'reason', 'That file is not in your folder.');
  end if;
  if v_company is null then
    return jsonb_build_object('ok', false, 'reason', 'Tell us about your business first - the paperwork hangs off it.');
  end if;
  if v_key = 'licence' and v_num is null then
    return jsonb_build_object('ok', false, 'reason', 'Type the licence number as it appears on the licence.');
  end if;
  -- An expired certificate does not count as on file, so saying so now beats
  -- a message that refuses to clear for reasons the screen never gave.
  if v_key in ('liability', 'workers_comp') and v_exp is not null and v_exp < current_date then
    return jsonb_build_object('ok', false, 'reason',
      'That certificate ran out on ' || to_char(v_exp, 'Mon FMDD, YYYY') || '. We need the current one.');
  end if;

  v_kind := case v_key when 'licence' then 'license'
                       when 'w9' then 'w9'
                       else 'insurance' end;

  insert into public.contact_credentials
    (contact_id, kind, label, number, issuer, expires_on, bucket, path, file_name, created_by)
  values (v_contact, v_kind, public.contractor_paper_label(v_key), v_num, v_issuer,
          v_exp, v_bucket, v_path, v_name, 'pro-app:documents');

  -- And into what readiness reads, which is not the same table.
  if v_key in ('liability', 'workers_comp') then
    insert into public.insurance_certificates
      (company_id, contractor_id, coverage_type, expiry_date, received_date, doc_url, created_by)
    values (v_company, v_contact,
            case v_key when 'liability' then 'General Liability' else 'Workers Compensation' end,
            v_exp, current_date, v_path, 'pro-app:documents');
  elsif v_key = 'w9' then
    update public.companies set w9_on_file = true where id = v_company;
  elsif v_key = 'licence' then
    update public.companies set license_number = v_num where id = v_company;
  end if;

  perform public.contractor_paperwork_sync(v_contact);
  return jsonb_build_object('ok', true, 'readiness', public.contractor_readiness(v_contact));
end $$;

comment on function public.contractor_document_upload(jsonb) is
  'Records one uploaded contractor paper: a contact_credentials row for the file, plus the insurance_certificates row or companies flag that contractor_readiness actually reads. Closes the matching inbox message.';

grant execute on function public.contractor_document_upload(jsonb) to authenticated;

-- --------------------------------------------------- the inbox carries it
-- The row has to know it is a paperwork row: it gets one button, and it is
-- not Archive.
do $patch$
declare src text; out_ text;
begin
  src := pg_get_functiondef('public.portal_my_messages(integer)'::regprocedure);
  out_ := replace(src,
    E'    \'channel\', x.channel,\n',
    E'    \'channel\', x.channel,\n    -- The readiness gap this message stands in for (migration 104). Set,\n    -- it means the row offers one verb: go and fix it.\n    \'requires\', x.requires,\n');
  if out_ = src then raise exception 'portal_my_messages has drifted: the channel line is not where it was'; end if;
  execute out_;
end $patch$;

-- Every professional on the books gets their messages now, not on next login.
select public.contractor_paperwork_sync(ca.contact_id)
  from public.contractor_approvals ca;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
