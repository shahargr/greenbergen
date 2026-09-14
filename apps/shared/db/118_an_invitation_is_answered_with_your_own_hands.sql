-- 118. AN INVITATION IS ANSWERED WITH YOUR OWN HANDS.
--
-- Shahar (2026-09-14): "Acted as Ran and invited myself to his project - to
-- co manage it. I can see the invitation in my inbox but not the project."
--
-- The project is not there because an invitation seats nobody. This function
-- is what writes the project_members row, and the Professionals door had no
-- button that called it - the portal and the homeowner app each grew their
-- own accept/decline, and the shared inbox, which is what that door draws,
-- showed the card and stopped. That is fixed in the app; this is the other
-- thing the look turned up.
--
-- The same hole 109 closed on portal_invite_to_project, on the other end of
-- the same conversation. Accepting is scoped to your own invitation
-- (invitee_user_id = me), which looks airtight until you remember that while
-- an admin is VIEWING as somebody, current_app_user_id() IS that somebody -
-- so eyes-only mode could take a seat on a project in their name. Taking a
-- seat is a decision, and a decision is an act.
create or replace function public.portal_invite_respond(p_id uuid, p_accept boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare me uuid := public.current_app_user_id(); inv record; v_contact uuid;
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'Please sign in first.'); end if;
  select * into inv from public.app_invitations
   where id = p_id and invitee_user_id = me and status = 'pending' for update;
  if inv.id is null then return jsonb_build_object('ok', false, 'reason', 'This invitation is no longer open.'); end if;
  if coalesce(inv.expires_at, now() + interval '1 day') <= now() then
    update public.app_invitations set status = 'expired' where id = inv.id;
    return jsonb_build_object('ok', false, 'reason', 'This invitation has expired.');
  end if;

  if not p_accept then
    update public.app_invitations set status = 'declined', declined_at = now() where id = inv.id;
    return jsonb_build_object('ok', true, 'status', 'declined', 'project_id', inv.project_id);
  end if;

  v_contact := public.link_contact_for_user(me, 'Other');
  insert into public.project_members (project_id, app_user_id, role, project_role, contract_id,
                                      status, accepted_at, invited_by_user_id)
  values (inv.project_id, me, inv.role, inv.project_role, inv.contract_id,
          'active', now(), inv.invited_by_user_id)
  on conflict (project_id, person_key, project_role, contract_id) where company_id is null
    do update set status = 'active', accepted_at = now(), role = excluded.role;

  if v_contact is not null and public.seat_needs_contract(inv.project_role) then
    insert into public.party_class_links (class_code, contact_id, created_by, notes)
    select 'service_provider', v_contact, 'system: invitation', 'Seated on a project to perform work.'
     where not exists (select 1 from public.party_class_links l
                        where l.contact_id = v_contact and l.class_code = 'service_provider');
  end if;

  update public.app_invitations
     set status = 'accepted', accepted_at = now(), accepted_by_user_id = me
   where id = inv.id;
  perform public.stamp_contact_referrer(me, inv.id, inv.invited_by_user_id);
  return jsonb_build_object('ok', true, 'status', 'accepted', 'project_id', inv.project_id);
end $fn$;

comment on function public.portal_invite_respond(uuid, boolean) is
  'Accept or decline an invitation addressed to you. Accepting is what writes the project_members row - an invitation on its own seats nobody. Refuses from a borrowed seat that is only looking.';

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
