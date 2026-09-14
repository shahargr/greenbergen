-- 109. AN INVITATION IS SENT WITH YOUR OWN HANDS.
--
-- Shahar, looking for the way to invite a contractor onto Ran's generator
-- job while viewing the system as Ran. The way exists (Setup tab), but the
-- looking turned up something else: portal_invite_to_project never called
-- assert_own_hands().
--
-- Every other write does. invite_peer does; portal_award_trade does. This
-- one did not, so an admin in VIEW mode - eyes only, no acting - could still
-- put an invitation into the world with somebody else's name on it as the
-- inviter, and the invitee would read it as coming from them. The two modes
-- exist precisely so that looking and doing are different acts; a hole in
-- one of them is not a small hole, because an invitation is the one write
-- here that reaches a stranger by email.
--
-- The guard goes first, before the seat maths and before anything is
-- written. Everything else in the function is unchanged from what was live.
create or replace function public.portal_invite_to_project(
  p_project uuid,
  p_email text default null,
  p_phone text default null,
  p_seat text default 'viewer',
  p_note text default null,
  p_name text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  me uuid := public.current_app_user_id();
  v_em text := nullif(lower(btrim(coalesce(p_email,''))), '');
  v_ph text := nullif(right(regexp_replace(coalesce(p_phone,''), '\D', '', 'g'), 10), '');
  v_nm text := nullif(btrim(coalesce(p_name,'')), '');
  v_uid uuid; v_email text; v_name text;
  v_role text; v_prole text; my_rank int; new_rank int; v_id uuid; v_token uuid;
  v_new boolean := false;
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'Please sign in first.'); end if;
  if p_project is null then return jsonb_build_object('ok', false, 'reason', 'Pick a project.'); end if;
  if not (public.can_invite_to_project(p_project) or public.can_edit_project(p_project)) then
    return jsonb_build_object('ok', false, 'reason', 'You may not invite people to this project.');
  end if;
  if v_em is null and v_ph is null then
    return jsonb_build_object('ok', false, 'reason', 'Enter an email or a phone number - that is how the invitation finds them.');
  end if;

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
    'token', case when v_new then v_token else null end);
end $fn$;

comment on function public.portal_invite_to_project(uuid, text, text, text, text, text) is
  'Invites somebody onto a project by email or phone - an existing account, or a newcomer when a name is given too. Seats nobody: the invitee accepts on their next login. Refuses from a borrowed seat that is only looking (assert_own_hands).';

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
