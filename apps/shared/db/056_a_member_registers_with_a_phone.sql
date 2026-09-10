-- 056 - a member registers with a phone number.
--
-- Shahar (2026-09-10), on the account step inside the booking: "allow to
-- sign in at this point in case the customer already exists. If not,
-- register with name, address, email, phone number." The address is the
-- booking's own (it becomes the home); the phone had nowhere to go.
-- homeowner_register takes it now and writes it on the member's contact
-- when the contact has none - the same normalisation the quote request
-- uses (047). The old four-argument form is dropped so PostgREST has one
-- function to resolve; the new argument defaults to null, so every
-- existing caller keeps working unchanged.
drop function if exists public.homeowner_register(text, text, text, uuid);

create or replace function public.homeowner_register(p_full_name text, p_zip text, p_town text, p_ref uuid, p_phone text default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  me uuid := public.current_app_user_id();
  v_contact uuid; v_ref_contact uuid; v_ref_name text;
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.'); end if;

  update public.app_users
     set full_name = coalesce(nullif(btrim(p_full_name), ''), full_name),
         home_zip  = coalesce(nullif(btrim(p_zip), ''), home_zip),
         home_town = coalesce(nullif(btrim(p_town), ''), home_town),
         last_modified_at = now()
   where id = me;

  v_contact := public.link_contact_for_user(me, 'Other');
  if v_contact is not null then
    update public.contacts set name = coalesce(nullif(btrim(p_full_name), ''), name),
                                person_name = coalesce(nullif(btrim(p_full_name), ''), person_name),
                                last_modified_at = now(), last_modified_by = 'homeowner-app:register'
     where id = v_contact and (name is null or name = split_part(coalesce(email_a,''), '@', 1));
    -- The phone, when given and when the contact has none (056).
    if v_phone is not null then
      update public.contacts set phone = v_phone, phone_type = coalesce(phone_type, 'mobile'),
                                  last_modified_at = now(), last_modified_by = 'homeowner-app:register'
       where id = v_contact and nullif(btrim(coalesce(phone, '')), '') is null;
    end if;
  end if;

  if p_ref is not null and p_ref <> me and v_contact is not null then
    select u.contact_id, coalesce(u.full_name, u.email) into v_ref_contact, v_ref_name
      from public.app_users u where u.id = p_ref and u.is_active;
    if v_ref_contact is not null and v_ref_contact <> v_contact then
      update public.contacts c
         set referred_by_contact_id = coalesce(c.referred_by_contact_id, v_ref_contact),
             referral = coalesce(c.referral, v_ref_name),
             last_modified_at = now(), last_modified_by = 'homeowner-app:register'
       where c.id = v_contact;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'app_user_id', me, 'contact_id', v_contact);
end $function$;
revoke all on function public.homeowner_register(text, text, text, uuid, text) from public, anon;
grant execute on function public.homeowner_register(text, text, text, uuid, text) to authenticated, service_role;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
