-- 097 - A home has a phone, and an invitation has a name.
--
-- Shahar (2026-09-14), on the account screen: "add a little invite icon on the
-- project, allowing to invite others into the project. invitation must be made
-- by a unique identifier. use email and/or phone, and name. Set the invitation
-- to be as a viewer, or contractor." And: "the project name / phone / address
-- can be there, but as a second tab."
--
-- Two changes, both small, both load-bearing.
--
-- THE PHONE. A home had a name and an address. A site phone is the third thing
-- anybody asks for - the number on the sign, the one the inspector calls.
--
-- THE NAME ON AN INVITATION. portal_invite_to_project only ever invited people
-- who ALREADY had an account: it looked you up in app_users and returned
-- "no account matches that email or phone" otherwise. That is why the form had
-- no name field - the name came from the account. Asking for a name only makes
-- sense if the person might not be here yet, so now they need not be:
--
--   they have an account  -> invitation addressed to them, as before
--   they do not           -> a pending invitation carrying their name, claimed
--                            by accept_pending_invitations_for_user the moment
--                            they sign up with that email
--
-- That claim matches on EMAIL and nothing else, so a newcomer invitation
-- without one would sit forever. Rather than pretend, the function says so:
-- a phone alone is enough to FIND somebody who is already here, and not enough
-- to invite somebody who is not.

alter table public.projects add column if not exists site_phone text;

comment on column public.projects.site_phone is
  'The number for the property itself - the site contact, the one on the sign. Not the owner''s personal number, which lives on their contact.';

-- ------------------------------------------------------------ name + phone --
drop function if exists public.homeowner_home_update(uuid, text, text);

create or replace function public.homeowner_home_update(
  p_project uuid,
  p_name    text default null,
  p_address text default null,
  p_phone   text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare me uuid := public.current_app_user_id();
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.'); end if;
  if p_project is null or p_project not in (select public.homeowner_home_ids(me)) then
    return jsonb_build_object('ok', false, 'reason', 'That home is not yours.');
  end if;
  if coalesce(nullif(btrim(p_name), ''), nullif(btrim(p_address), ''), nullif(btrim(p_phone), '')) is null then
    return jsonb_build_object('ok', false, 'reason', 'Give the home a name, an address or a phone number.');
  end if;
  update public.projects
     set project_name = coalesce(nullif(btrim(p_name), ''), project_name),
         address      = coalesce(nullif(btrim(p_address), ''), address),
         -- A phone is the one of the three you might want to CLEAR, so an
         -- empty string blanks it rather than being ignored like the others.
         site_phone   = case when p_phone is null then site_phone
                             else nullif(btrim(p_phone), '') end,
         last_modified_by = 'homeowner-app', last_modified_at = now()
   where id = p_project;
  return jsonb_build_object('ok', true);
end $function$;

-- The screen cannot show a phone it is never sent.
do $patch$
declare src text; patched text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'homeowner_me';
  if src is null then raise exception 'PATCH_NO_FUNCTION: homeowner_me'; end if;

  patched := replace(src,
    $f$'project_id', h.id, 'address', h.address, 'name', h.project_name, 'town',$f$,
    $f$'project_id', h.id, 'address', h.address, 'name', h.project_name, 'phone', h.site_phone, 'town',$f$);
  if patched = src then
    raise exception 'PATCH_NO_CHANGE: homeowner_me homes row did not match';
  end if;
  execute patched;
end $patch$;

-- --------------------------------------------- an invitation to a newcomer --
drop function if exists public.portal_invite_to_project(uuid, text, text, text, text);

create or replace function public.portal_invite_to_project(
  p_project uuid,
  p_email   text default null,
  p_phone   text default null,
  p_seat    text default 'viewer',
  p_note    text default null,
  p_name    text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  me uuid := public.current_app_user_id();
  v_em text := nullif(lower(btrim(coalesce(p_email,''))), '');
  v_ph text := nullif(right(regexp_replace(coalesce(p_phone,''), '\D', '', 'g'), 10), '');
  v_nm text := nullif(btrim(coalesce(p_name,'')), '');
  v_uid uuid; v_email text; v_name text;
  v_role text; v_prole text; my_rank int; new_rank int; v_id uuid; v_token uuid;
  v_new boolean := false;
begin
  if me is null then return jsonb_build_object('ok', false, 'reason', 'Please sign in first.'); end if;
  if p_project is null then return jsonb_build_object('ok', false, 'reason', 'Pick a project.'); end if;
  if not (public.can_invite_to_project(p_project) or public.can_edit_project(p_project)) then
    return jsonb_build_object('ok', false, 'reason', 'You may not invite people to this project.');
  end if;
  if v_em is null and v_ph is null then
    return jsonb_build_object('ok', false, 'reason', 'Enter an email or a phone number - that is how the invitation finds them.');
  end if;

  -- Are they already here? Email wins over phone when both match.
  select u.id, u.email, coalesce(u.full_name, c.person_name, c.name, u.email)
    into v_uid, v_email, v_name
    from public.app_users u
    left join public.contacts c on c.id = u.contact_id
   where u.is_active
     and ((v_em is not null and lower(u.email) = v_em)
       or (v_ph is not null and length(v_ph) = 10 and (
             right(regexp_replace(coalesce(c.phone,''),   '\D', '', 'g'), 10) = v_ph
          or right(regexp_replace(coalesce(c.phone_2,''), '\D', '', 'g'), 10) = v_ph)))
   order by (v_em is not null and lower(u.email) = v_em) desc
   limit 1;

  if v_uid is null then
    -- A newcomer. The claim at signup matches on email, so without one the
    -- invitation could never be honoured and saying "sent" would be a lie.
    if v_em is null then
      return jsonb_build_object('ok', false, 'code', 'NEEDS_EMAIL',
        'reason', 'No account has that number yet. To invite somebody new, give an email as well - that is what their invitation is claimed with when they sign up.');
    end if;
    if v_nm is null then
      return jsonb_build_object('ok', false, 'code', 'NEEDS_NAME',
        'reason', 'Nobody here has that email yet. Add their name and they will be invited as a newcomer.');
    end if;
    v_new := true;
    v_email := v_em;
    v_name := v_nm;
  else
    if v_uid = me then return jsonb_build_object('ok', false, 'reason', 'That is your own account.'); end if;
    if exists (select 1 from public.project_members pm
                where pm.project_id = p_project and pm.app_user_id = v_uid and pm.status = 'active') then
      return jsonb_build_object('ok', false, 'reason', v_name || ' is already on this project.');
    end if;
    -- A name typed in is what the inviter calls them; it never overwrites the
    -- name on somebody's own account.
    v_name := coalesce(v_name, v_nm);
  end if;

  case lower(coalesce(p_seat,'viewer'))
    when 'resident'   then v_role := 'owner';        v_prole := 'asset owner';
    when 'member'     then v_role := 'owner';        v_prole := 'asset owner';
    when 'manager'    then v_role := 'manager';      v_prole := 'site project manager';
    when 'contractor' then v_role := 'collaborator'; v_prole := 'contractor';
    else                   v_role := 'viewer';       v_prole := 'viewer';
  end case;
  if not public.is_superadmin() then
    select coalesce(authority_rank, 0) into new_rank from public.project_roles where role = v_prole;
    my_rank := public.my_authority_rank(p_project);
    if new_rank > coalesce(my_rank, 0) then
      return jsonb_build_object('ok', false, 'reason', 'You cannot grant a seat above your own.');
    end if;
  end if;

  update public.app_invitations set status = 'revoked'
   where project_id = p_project and status = 'pending'
     and (invitee_user_id = v_uid or (v_uid is null and lower(email) = v_em));

  insert into public.app_invitations
    (email, invitee_phone, invitee_name, invitee_user_id, project_id, role, project_role,
     invited_by_user_id, status, message, expires_at)
  values (v_email, p_phone, v_name, v_uid, p_project, v_role, v_prole,
          me, 'pending', nullif(btrim(coalesce(p_note,'')), ''), now() + interval '14 days')
  returning id, token into v_id, v_token;

  return jsonb_build_object('ok', true, 'id', v_id, 'name', v_name,
    'newcomer', v_new,
    -- Only a newcomer needs the link: somebody who already has an account
    -- finds the invitation waiting in their own inbox.
    'token', case when v_new then v_token else null end);
end $function$;

do $$
declare n int;
begin
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'portal_invite_to_project';
  if n <> 1 then raise exception 'OVERLOAD: % copies of portal_invite_to_project', n; end if;
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'homeowner_home_update';
  if n <> 1 then raise exception 'OVERLOAD: % copies of homeowner_home_update', n; end if;
end $$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
