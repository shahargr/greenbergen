-- 038 - you can write to yourself.
--
-- Shahar, on the compose box offering nobody: "the least is that i would be
-- able to send a message to myself if no one is on the project."
--
-- He is right, and the refusal was never a rule anyone decided on. It was a
-- guard against a typo - "That is you" - written when the only way to pick a
-- recipient was a dropdown of other people. A person alone on their own
-- project has things to write down: what the inspector said, the part
-- number, the thing to ask the electrician on Thursday. That is a note to
-- self, it belongs on the project, and the inbox is where they will look
-- for it. A file-it-under-the-project message from you to you is exactly
-- that.
--
-- Nothing else moves. Both parties must still hold a seat on the project -
-- you do, twice over - so this opens no channel to anyone new.

create or replace function public.send_portal_message(
  p_project uuid, p_to_contact uuid, p_body text,
  p_file_id uuid default null, p_action_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_from uuid; v_id uuid; v_project_name text; v_file uuid; v_action uuid;
begin
  if coalesce(btrim(p_body), '') = '' then
    raise exception 'Write something to send';
  end if;
  if p_project is null or p_to_contact is null then
    raise exception 'Pick a project and someone to send it to';
  end if;

  select u.contact_id into v_from
    from app_users u where u.id = public.current_app_user_id();
  if v_from is null then
    raise exception 'Your account has no contact record yet';
  end if;
  -- Writing to yourself is allowed: it is a note on the project, filed where
  -- you will look for it. The old 'That is you' guard is gone on purpose.

  -- The sender must be on the project.
  if not public.is_project_member(p_project) then
    raise exception 'You are not on that project';
  end if;

  -- ...and so must the recipient, on that same project. A seat carries an
  -- account id, a contact id, or both.
  if not exists (
    select 1 from project_members pm
    where pm.project_id = p_project and pm.status = 'active'
      and (pm.contact_id = p_to_contact
           or pm.app_user_id = (select u2.id from app_users u2
                                 where u2.contact_id = p_to_contact and u2.is_active limit 1))
  ) then
    raise exception 'They are not on that project';
  end if;

  -- An attachment travels only if it already belongs to this project.
  select f.id into v_file from files f where f.id = p_file_id and f.project_id = p_project;
  select a.id into v_action from actions a where a.id = p_action_id and a.project_id = p_project;

  select project_name into v_project_name from projects where id = p_project;

  insert into messages (body, direction, channel, status, sent_at,
                        project_id, from_contact_id, to_contact_id, file_id, action_id, created_by)
  values (btrim(p_body), 'inbound', 'in app', 'new', now(),
          p_project, v_from, p_to_contact, v_file, v_action, 'portal:compose')
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'project', v_project_name,
                            'file_id', v_file, 'action_id', v_action);
end;
$function$;

comment on function public.send_portal_message(uuid, uuid, text, uuid, uuid) is
  'Send inside the platform - the row IS the delivery, no email, no SMS. Both parties must hold an active seat on the project; that is what stops this becoming a back channel around the community price. Writing to yourself is a note on the project and is allowed. A photo (p_file_id) or a task (p_action_id) may ride along, but ONLY when it already belongs to that same project - a reference to anything else is dropped, never sent.';

revoke all on function public.send_portal_message(uuid, uuid, text, uuid, uuid) from public, anon;
grant execute on function public.send_portal_message(uuid, uuid, text, uuid, uuid) to authenticated, service_role;

-- The compose list offers you on every project you are on, marked so the
-- app can label it honestly ("Me - a note to myself") rather than listing
-- your own name beside the others as if you were someone else.
create or replace function public.portal_compose_targets()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  with me as (
    select u.id as app_user_id, u.contact_id
      from public.app_users u where u.id = public.current_app_user_id()
  ),
  my_projects as (
    select distinct p.id, p.project_name
      from me, public.project_members pm
      join public.projects p on p.id = pm.project_id
     where pm.status = 'active'
       and (pm.app_user_id = me.app_user_id
            or (pm.app_user_id is null and pm.contact_id = me.contact_id))
       and p.trashed_at is null and not p.is_template
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'project_id', q.id,
    'project_name', q.project_name,
    'people', coalesce((
      select jsonb_agg(distinct jsonb_build_object(
        'contact_id', c.id,
        'name', coalesce(c.person_name, c.name),
        'seat', coalesce(pm2.project_role, pm2.role),
        'me', (c.id = (select contact_id from me))))
      from public.project_members pm2
      join public.contacts c
        on c.id = coalesce(pm2.contact_id,
                           (select u3.contact_id from public.app_users u3 where u3.id = pm2.app_user_id))
      where pm2.project_id = q.id and pm2.status = 'active'), '[]'::jsonb)
  ) order by q.project_name), '[]'::jsonb)
  from my_projects q;
$function$;

comment on function public.portal_compose_targets() is
  'Who you can write to, grouped by the project the message will be filed against: everyone holding an active seat on a project you are on, yourself included (`me` true) so a project with nobody else on it still has somewhere for a note to go.';

revoke all on function public.portal_compose_targets() from public, anon;
grant execute on function public.portal_compose_targets() to authenticated, service_role;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
