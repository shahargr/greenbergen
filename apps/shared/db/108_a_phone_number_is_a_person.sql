-- 108. A PHONE NUMBER IS A PERSON.
--
-- Probing 107's "add them here" path with a made-up stairs guy, the whole
-- call died on:
--
--   duplicate key value violates unique constraint "ux_companies_main_phone"
--
-- Which is the database being right and the function being careless. contacts
-- and companies both hold a UNIQUE index on the normalised phone and on the
-- email - a number belongs to one person, an address to one company - and
-- portal_award_add_trade matched on NAME only and then inserted. Type a man's
-- phone number and the award blew up with a constraint name in it.
--
-- So the lookup follows the identity the database actually keeps: phone
-- first, then email, then the name. A number you already have is the person
-- you already have, whatever you spell their name this time - which is also
-- the behaviour a GC wants, because the man in his phone is the man he means.
-- The insert is still guarded, because two people awarding at once can race
-- past any lookup.
--
-- It also says HOW it matched, so the screen can tell him "that number is
-- already Franklin Moreno" rather than silently awarding the stairs to
-- somebody he didn't pick.
create or replace function public.portal_award_add_trade(
  p_project uuid,
  p_name text,
  p_trade text default null,
  p_company text default null,
  p_phone text default null,
  p_email text default null,
  p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_name  text := nullif(btrim(coalesce(p_name, '')), '');
  v_co    text := nullif(btrim(coalesce(p_company, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
  v_contact uuid; v_company uuid; v_matched text; v_found text; r jsonb;
begin
  perform public.assert_own_hands();
  if public.current_app_user_id() is null then
    return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.');
  end if;
  if not public.can_edit_project(p_project) then
    return jsonb_build_object('ok', false, 'reason', 'Awarding work on this job is not yours to do.');
  end if;
  if v_name is null then
    return jsonb_build_object('ok', false, 'reason', 'Give them a name.');
  end if;

  -- WHO IS THIS. The phone is the strongest thing we hold, then the email,
  -- then the name they were typed under.
  if v_phone is not null then
    select c.id, coalesce(c.person_name, c.name) into v_contact, v_found
      from public.contacts c
     where c.disabled_at is null and public.phone_key(c.phone) = public.phone_key(v_phone)
     limit 1;
    if v_contact is not null then v_matched := 'phone'; end if;
  end if;
  if v_contact is null and v_email is not null then
    select c.id, coalesce(c.person_name, c.name) into v_contact, v_found
      from public.contacts c
     where c.disabled_at is null and lower(c.email_a) = lower(v_email)
     limit 1;
    if v_contact is not null then v_matched := 'email'; end if;
  end if;
  if v_contact is null then
    select c.id, coalesce(c.person_name, c.name) into v_contact, v_found
      from public.contacts c
     where c.disabled_at is null
       and lower(btrim(coalesce(c.person_name, c.name))) = lower(v_name)
     limit 1;
    if v_contact is not null then v_matched := 'name'; end if;
  end if;

  if v_contact is null then
    -- The company, by the same three tests. A company nobody has is made;
    -- one whose number we already hold is the one we already hold.
    if v_co is not null then
      if v_phone is not null then
        select id into v_company from public.companies
         where public.phone_key(main_phone) = public.phone_key(v_phone) limit 1;
      end if;
      if v_company is null and v_email is not null then
        select id into v_company from public.companies
         where lower(main_email) = lower(v_email) limit 1;
      end if;
      if v_company is null then
        select id into v_company from public.companies
         where lower(btrim(company_name)) = lower(v_co) limit 1;
      end if;
      if v_company is null then
        begin
          insert into public.companies (company_name, main_phone, main_email, source, created_by, needs_review)
          values (v_co, v_phone, v_email, 'pro-app:award', 'pro-app:award', true)
          returning id into v_company;
        exception when unique_violation then
          -- Somebody else got there between the look and the leap. Take
          -- theirs; a second company for the same number would be the bug.
          select id into v_company from public.companies
           where public.phone_key(main_phone) = public.phone_key(v_phone)
              or lower(main_email) = lower(v_email)
              or lower(btrim(company_name)) = lower(v_co)
           limit 1;
        end;
      end if;
    end if;

    begin
      insert into public.contacts (name, person_name, phone, email_a, company_id, source, created_by)
      values (v_name, v_name, v_phone, v_email, v_company, 'pro-app:award', 'pro-app:award')
      returning id into v_contact;
      v_matched := 'new';
    exception when unique_violation then
      select c.id, coalesce(c.person_name, c.name) into v_contact, v_found
        from public.contacts c
       where (v_phone is not null and public.phone_key(c.phone) = public.phone_key(v_phone))
          or (v_email is not null and lower(c.email_a) = lower(v_email))
       limit 1;
      v_matched := 'phone';
      if v_contact is null then
        return jsonb_build_object('ok', false, 'reason',
          'That phone or email is already on somebody else''s record. Check the number, or pick them from the list.');
      end if;
    end;
  end if;

  r := public.portal_award_trade(p_project, v_contact, p_trade, p_note);
  if coalesce((r->>'ok')::boolean, false) and v_matched is not null and v_matched <> 'new' then
    -- Say so out loud when the person awarded is not the name he typed.
    r := r || jsonb_build_object('matched', v_matched,
      'matched_note', case when lower(coalesce(v_found, '')) = lower(v_name) then null
        else case v_matched
          when 'phone' then 'That number is already ' || v_found || ' — awarded to them.'
          when 'email' then 'That email is already ' || v_found || ' — awarded to them.'
          else null end end);
  end if;
  return r;
end $$;

comment on function public.portal_award_add_trade(uuid, text, text, text, text, text, text) is
  'Awards a trade to somebody not on file yet. Finds them by phone, then email, then name - the identity contacts and companies actually hold unique indexes on - and only then makes a new record. Says how it matched, so the screen can tell the GC when the number belonged to someone else.';

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
