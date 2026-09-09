-- 035 - a message knows what it is, and the shell knows how many are waiting.
--
-- Shahar: "when looking at the inbox, show it like an email: to, first line
-- message. options for outbound message: archive. options for inbound based
-- on the type of message... when expanding see details of bid for example,
-- and handle as bid, or reply. system message can be task assigned as well.
-- expand to see the message with images if exists." And: "add counter next
-- to inbox icon showing message count."
--
-- Every one of those needs the same missing thing: the inbox could not tell
-- one message from another. It had a body and a sender and rendered all of
-- them identically, so the verbs underneath had to be identical too - Done,
-- Archive, Delete on a bid invitation, which is what made the offer screen
-- necessary in the first place (migration 033).
--
-- KIND IS DERIVED, NOT STORED. Every producer already stamps created_by, and
-- that is the honest signal: trigger:bids writes bid notices, the offer
-- question functions write their own, a null sender is the system talking. A
-- kind column would be a second place for the same fact to live and a first
-- place for it to be wrong (rulebook 30).
--
-- SUBJECT IS THE FIRST LINE. Nothing writes a subject and nothing should
-- start: these bodies are already written first-line-first ("You are invited
-- to bid on X in Tenafly - Electrical."), which is what an email subject is
-- for. Taking it rather than adding a column keeps one body, one truth.
create or replace function public.portal_my_messages(p_limit integer default 100)
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
    -- The first line, for the collapsed row. Bodies are written subject-first.
    'subject', left(split_part(x.body, chr(10), 1), 140),
    'sent_at', x.sent_at,
    'status', x.status,
    'read_at', x.read_at,
    'handled_at', x.handled_at,
    'project_id', x.project_id,
    'project_name', (select p.project_name from public.projects p where p.id = x.project_id),
    'action_id', x.action_id,
    'action', (select a.action from public.actions a where a.id = x.action_id),
    -- WHAT THIS MESSAGE IS, so the app can offer the right verbs:
    --   bid      an offer to bid, or how one went (trigger:bids)
    --   question a pre-acceptance question or its answer (migrations 033-034)
    --   task     it is about an action someone has to do
    --   system   nobody sent it; the platform did
    --   note     a person wrote to another person
    'kind', case
      when x.created_by = 'trigger:bids' then 'bid'
      when x.created_by like 'homeowner-app:offer-question%' then 'question'
      when x.from_contact_id is null and x.to_contact_id is null then 'system'
      when x.action_id is not null then 'task'
      else 'note' end,
    -- Who it is with, from your side, and their contact id so a reply has
    -- somewhere to go without a second lookup.
    'who', coalesce(
      (select coalesce(c.person_name, c.name) from public.contacts c
        where c.id = case when x.from_contact_id = (select contact_id from me)
                          then x.to_contact_id else x.from_contact_id end),
      x.sender, 'Green Bergen'),
    'with_contact_id', case when x.from_contact_id = (select contact_id from me)
                            then x.to_contact_id else x.from_contact_id end,
    -- An attachment, if there is one. A path, never a URL - the app signs it.
    'file', case when x.file_id is null then null else (
      select jsonb_build_object('id', f.id, 'path', f.path, 'kind', f.kind, 'mime', f.mime_type, 'name', f.file_name)
        from public.files f where f.id = x.file_id) end,
    'mine', (x.from_contact_id = (select contact_id from me)),
    'pending', (x.to_contact_id = (select contact_id from me)
                and x.read_at is null and x.handled_at is null
                and x.status not in ('dismissed','done'))
  ) order by x.sent_at desc), '[]'::jsonb)
  from mine x;
$function$;

comment on function public.portal_my_messages(integer) is
  'Your messages, newest first, with everything the inbox needs to render one like an email: subject (the body''s first line), kind (bid | question | task | system | note, derived from created_by - never stored twice), who and with_contact_id so a reply has a destination, and file when one is attached. A directed message reaches whoever it is addressed to WITHOUT project membership - that is what lets an unseated contractor read an offer and its answer.';

revoke all on function public.portal_my_messages(integer) from public, anon;
grant execute on function public.portal_my_messages(integer) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- The number on the icon.
-- ---------------------------------------------------------------------
-- One integer, so the shell on EVERY screen can show it without loading the
-- inbox. The homeowner app was counting unread out of its bookings, which
-- misses every message that is not about a booking; the contractor app was
-- not counting at all. Same predicate as portal_my_messages' `pending`, so
-- the badge and the list can never disagree about what is waiting.
create or replace function public.my_unread_count()
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select count(*)::int from public.messages m
   where m.to_contact_id = public.my_contact_id()
     and m.read_at is null and m.handled_at is null
     and m.status not in ('dismissed','done');
$$;

comment on function public.my_unread_count() is
  'How many messages are waiting on you - the same predicate portal_my_messages calls `pending`, as one integer, so the badge on the shell costs one cheap read on every screen instead of the whole inbox.';

revoke all on function public.my_unread_count() from public, anon;
grant execute on function public.my_unread_count() to authenticated, service_role;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
