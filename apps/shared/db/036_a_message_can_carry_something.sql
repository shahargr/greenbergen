-- 036 - a message can carry a photo or a task.
--
-- Shahar: "allowing the form to attach photos or tasks so the message is
-- relevant and it's connected."
--
-- messages has carried file_id and action_id since the beginning and
-- send_portal_message never set either, so every message a person wrote was
-- a naked paragraph: "the panel is on the left" with no picture of the
-- panel, "can you do this one first" with no task attached. The columns were
-- there; the way in was not.
--
-- BOTH ARGUMENTS ARE CHECKED AGAINST THE PROJECT, not just accepted. A file
-- id or an action id is a reference to something someone else may own, and a
-- message is the easiest place in the system to smuggle one: attach a file
-- from a project you are on to a message on a project THEY are on, and the
-- recipient can now see it (can_see_message lets the addressee read the row,
-- which is right, and file_links would follow). So:
--
--   the file must already be filed against THIS project
--   the action must already belong to THIS project
--
-- Both are silently dropped rather than raising when they do not match. A
-- raise here would be a puzzle - the sender did nothing wrong, the id simply
-- does not belong on this message - and the message itself is still worth
-- sending. What must never happen is the reference travelling.
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
  if v_from = p_to_contact then
    raise exception 'That is you';
  end if;

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
  'Send inside the platform - the row IS the delivery, no email, no SMS. Both parties must hold an active seat on the project; that is what stops this becoming a back channel around the community price. A photo (p_file_id) or a task (p_action_id) may ride along, but ONLY when it already belongs to that same project - a reference to anything else is dropped, never sent.';

revoke all on function public.send_portal_message(uuid, uuid, text, uuid, uuid) from public, anon;
grant execute on function public.send_portal_message(uuid, uuid, text, uuid, uuid) to authenticated, service_role;

-- The three-argument version is gone: same name, new optional arguments, so
-- every existing caller keeps working through the one function. Dropping it
-- avoids the overload ambiguity that bit stage_payment_quote (v104).
drop function if exists public.send_portal_message(uuid, uuid, text);

-- ---------------------------------------------------------------------
-- What a message could be about.
-- ---------------------------------------------------------------------
-- The open tasks on a project, for the compose box's "attach a task" picker.
-- portal_tasks answers this already but returns whole rows across every
-- project you hold; this is one project, three fields, and is called while
-- someone is typing.
create or replace function public.project_open_tasks(p_project uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when not public.is_project_member(p_project) then '[]'::jsonb
  else coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'action', a.action, 'status', a.status)
           order by a.created_at desc)
    from public.actions a
    where a.project_id = p_project
      and a.status not in ('Completed','Cancelled','Force Cancelled','Superseded')
    limit 50), '[]'::jsonb) end;
$$;

comment on function public.project_open_tasks(uuid) is
  'Open tasks on one project - id, title, status - for attaching one to a message. Members only; a non-member gets an empty list rather than an error, because this is a picker, not a gate.';

revoke all on function public.project_open_tasks(uuid) from public, anon;
grant execute on function public.project_open_tasks(uuid) to authenticated, service_role;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
