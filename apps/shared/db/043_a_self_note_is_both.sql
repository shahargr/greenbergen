-- 043 - a note to yourself is both sent and received.
--
-- Shahar, on 042: "so in this case, they should be flagged in both sent /
-- and inbox. no?" Yes. You wrote it AND it is addressed to you, so it
-- belongs in the inbox (unread until you read it) and in the Sent folder
-- (you did send it). 042 made it received; this names it so the Sent
-- folder can list it too: 'self' is true when from and to are both you.
-- 'mine' keeps meaning "sent to someone else", which is what the verbs on a
-- sent row assume.
create or replace function public.portal_my_messages(p_limit integer default 100)
returns jsonb
language sql stable security definer set search_path to 'public'
as $function$
  with me as (
    select u.id as app_user_id, u.contact_id
      from public.app_users u where u.id = public.current_app_user_id()
  ),
  mine as (
    select m.* from public.messages m, me
    where (m.to_contact_id = me.contact_id or m.from_contact_id = me.contact_id)
       or (m.project_id is not null and public.is_project_member(m.project_id)
           and m.to_contact_id is null and m.from_contact_id is null)
    order by m.sent_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', x.id,
    'direction', case
      when x.to_contact_id = (select contact_id from me) then 'inbound'
      when x.from_contact_id = (select contact_id from me) then 'outbound'
      else x.direction end,
    'channel', x.channel,
    'body', left(x.body, 2000),
    'subject', left(split_part(x.body, chr(10), 1), 140),
    'sent_at', x.sent_at,
    'status', x.status,
    'read_at', x.read_at,
    'handled_at', x.handled_at,
    'project_id', x.project_id,
    'project_name', (select p.project_name from public.projects p where p.id = x.project_id),
    'action_id', x.action_id,
    'action', (select a.action from public.actions a where a.id = x.action_id),
    'kind', case
      when x.created_by = 'trigger:bids' then 'bid'
      when x.created_by like 'homeowner-app:offer-question%' then 'question'
      when x.from_contact_id is null and x.to_contact_id is null then 'system'
      when x.action_id is not null then 'task'
      else 'note' end,
    'who', case
      when x.from_contact_id = (select contact_id from me)
       and x.to_contact_id = (select contact_id from me) then 'Me'
      else coalesce(
        (select coalesce(c.person_name, c.name) from public.contacts c
          where c.id = case when x.from_contact_id = (select contact_id from me)
                            then x.to_contact_id else x.from_contact_id end),
        x.sender, 'Green Bergen') end,
    'with_contact_id', case when x.from_contact_id = (select contact_id from me)
                            then x.to_contact_id else x.from_contact_id end,
    'file', case when x.file_id is null then null else (
      select jsonb_build_object('id', f.id, 'path', f.path, 'kind', f.kind, 'mime', f.mime_type, 'name', f.file_name)
        from public.files f where f.id = x.file_id) end,
    -- Sent to someone else.
    'mine', (x.from_contact_id = (select contact_id from me)
             and x.to_contact_id is distinct from (select contact_id from me)),
    -- Written by me, to me: in the inbox AND in Sent.
    'self', (x.from_contact_id = (select contact_id from me)
             and x.to_contact_id = (select contact_id from me)),
    'pending', (x.to_contact_id = (select contact_id from me)
                and x.read_at is null and x.handled_at is null
                and x.status not in ('dismissed','done'))
  ) order by x.sent_at desc), '[]'::jsonb)
  from mine x;
$function$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
