-- 021 - accounts that can sign in but have no profile.
--
-- THE FAULT. handle_new_auth_user is the only bridge from auth.users to
-- app_users (rulebook 70). Two accounts predate the 2026-08-31 fix to it and
-- never got a profile row: sg.other@gmail.com (26 Aug) and
-- shahar.greenberg+1@gmail.com (29 Aug). Both have signed in.
--
-- WHY THAT IS WORSE THAN IT LOOKS: they authenticate fine, so Supabase says
-- they are signed in - but current_app_user_id() resolves through app_users
-- and returns null, so every function tells them they are NOT signed in.
-- Silently half-broken is the worst state an account can be in.
--
-- NOT the invitations. Neither email appears in app_invitations, the earliest
-- invitation there postdates both signups, and the trigger creates the profile
-- BEFORE it accepts invitations anyway - an unaccepted invite costs you
-- project membership, never a profile.
--
-- A FUNCTION, NOT TWO INSERTS. Same logic as the trigger, replayable, so the
-- next orphan is one call away instead of another archaeology session. It is
-- idempotent: an auth user who already has a profile is skipped.
create or replace function public.repair_orphan_auth_users()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  u record; existing public.app_users; new_id uuid; v_fixed jsonb := '[]'::jsonb;
begin
  if not public.is_superadmin() and current_setting('role', true) is distinct from 'service_role' then
    return jsonb_build_object('ok', false, 'reason', 'Admins only.');
  end if;

  for u in
    select au.id, au.email, au.raw_user_meta_data
      from auth.users au
      left join public.app_users a on a.auth_user_id = au.id
     where a.id is null
  loop
    -- Link an unclaimed profile by email first, exactly as the trigger does.
    select * into existing from public.app_users
     where lower(email) = lower(u.email) and auth_user_id is null limit 1;

    if existing.id is not null then
      update public.app_users
         set auth_user_id = u.id,
             full_name = coalesce(full_name, u.raw_user_meta_data->>'full_name'),
             last_modified_at = now()
       where id = existing.id;
      new_id := existing.id;
    else
      insert into public.app_users (username, email, full_name, auth_user_id, is_active, created_by)
      values (coalesce(u.raw_user_meta_data->>'username',
                       split_part(u.email, '@', 1) || '_' || left(u.id::text, 6)),
              u.email, u.raw_user_meta_data->>'full_name', u.id, true,
              'repair_orphan_auth_users')
      returning id into new_id;
    end if;

    perform public.accept_pending_invitations_for_user(new_id, u.email);

    begin
      perform public.ensure_customer_agreement(new_id);
    exception when others then
      insert into public.system_trigger_errors (trigger_fn, row_id, sqlstate, message)
      values ('repair_orphan_auth_users', new_id, sqlstate,
              'Profile repaired but the customer agreement was not written: ' || sqlerrm);
    end;

    v_fixed := v_fixed || jsonb_build_object('email', u.email, 'app_user_id', new_id,
                                             'linked', existing.id is not null);
  end loop;

  return jsonb_build_object('ok', true, 'repaired', jsonb_array_length(v_fixed), 'who', v_fixed);
end $$;

revoke all on function public.repair_orphan_auth_users() from public, anon;
grant execute on function public.repair_orphan_auth_users() to authenticated, service_role;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();

-- Run 2026-09-09: 2 repaired, 0 orphans left. Both got a contact, the customer
-- class and a live customer agreement; system_trigger_errors stayed clean.
-- The guard is real: from the SQL editor it must be called with the caller's
-- app-user context set (select set_config('sgr.app_user_id', '<superadmin>', false))
-- or as service_role.
