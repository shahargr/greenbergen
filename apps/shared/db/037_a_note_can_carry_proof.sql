-- 037 - a note on a task carries proof, and proof can be your voice.
--
-- Shahar: "use similar concept for adding evidence to notes, to the one we
-- use when logging tasks - including voice comment."
--
-- The concept he means is AddEvidence on the scope screen: upload the file,
-- record it with record_project_file, then LINK it to the thing it is
-- evidence of - in that order, so a files row never points at an object that
-- is not there yet. file_links is that link table and already has a column
-- per thing evidence can hang off: a project, a scope line, a payment stage,
-- a contract, a bid, a site check-in, an action. What it had no column for
-- was the one place people actually write things down - the NOTE.
--
-- So a note gets its own link, and add_task_comment learns to take files.
--
-- VOICE IS NOT A NEW FEATURE, it is a kind that already existed and had no
-- way in. record_project_file has classified 'audio' since it was written
-- and user_entitlement.cap_voice already gates it per plan - the entitlement
-- was there, the button was not. A phone in a basement can say "the stack is
-- boxed in behind this wall" in four seconds; typing it takes a minute and
-- usually does not happen. That is the whole argument for it.
--
-- AND A NOTE MAY NOW BE SILENT. add_task_comment refused an empty body,
-- which was right when a note was only ever text. A ten-second recording IS
-- the note; requiring someone to type "voice note" beside it is a toll.
-- Empty body plus no files is still refused.

-- ---------------------------------------------------------------------
-- 1. Evidence can hang off a note.
-- ---------------------------------------------------------------------
-- file_links carries chk_file_links_one_target: EXACTLY ONE of its target
-- columns may be set, so "what is this file attached to" has one answer.
-- The note has to join that list, or a link to it fails whether it names the
-- note alone (zero targets) or the note and its task (two). Found the hard
-- way - the first cut set action_id and action_comment_id together and the
-- constraint refused it, correctly.
alter table public.file_links
  add column if not exists action_comment_id uuid references public.action_comments(id) on delete cascade;

alter table public.file_links drop constraint if exists chk_file_links_one_target;
alter table public.file_links add constraint chk_file_links_one_target check (
  (case when action_id is null then 0 else 1 end
 + case when action_comment_id is null then 0 else 1 end
 + case when payment_stage_id is null then 0 else 1 end
 + case when project_id is null then 0 else 1 end
 + case when contract_id is null then 0 else 1 end
 + case when project_space_id is null then 0 else 1 end
 + case when project_scope_item_id is null then 0 else 1 end
 + case when site_checkin_id is null then 0 else 1 end
 + case when bid_package_id is null then 0 else 1 end
 + case when bid_id is null then 0 else 1 end) = 1
);

create index if not exists file_links_action_comment_idx
  on public.file_links (action_comment_id) where action_comment_id is not null;

comment on column public.file_links.action_comment_id is
  'The note this file is evidence for. One more target beside project_id, action_id, project_scope_item_id and the rest - same pattern, so a photo attached to a note is found the same way a photo attached to a scope line is.';

-- ---------------------------------------------------------------------
-- 2. A note takes files.
-- ---------------------------------------------------------------------
create or replace function public.add_task_comment(p_action_id uuid, p_body text, p_file_ids uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  me    uuid := public.current_app_user_id();
  actor text;
  v_contact uuid;
  body  text := nullif(btrim(p_body), '');
  v_id  uuid;
  v_project uuid;
  v_files uuid[];
  f uuid;
begin
  if me is null then raise exception 'not signed in' using errcode = '28000'; end if;
  -- Seeing the task is the bar, as it is on the table itself. Commenting is
  -- not editing: a viewer answering a question is the point of the box.
  if not public.can_see_action(p_action_id) then
    return jsonb_build_object('ok', false, 'reason', 'That task is not yours.');
  end if;

  select a.project_id into v_project from public.actions a where a.id = p_action_id;

  -- ONLY FILES ALREADY ON THIS TASK'S PROJECT. A file id is a reference to
  -- something someone else may own, and a note is read by everyone who can
  -- see the task - so a reference from another project is dropped here
  -- rather than travelling. Same rule send_portal_message follows.
  select coalesce(array_agg(f2.id), '{}')
    into v_files
    from public.files f2
   where f2.id = any(coalesce(p_file_ids, '{}'::uuid[]))
     and f2.project_id is not distinct from v_project;

  -- A recording IS the note. Silence with nothing attached is not.
  if body is null and coalesce(array_length(v_files, 1), 0) = 0 then
    return jsonb_build_object('ok', false, 'reason', 'Write something, or attach a photo or a recording.');
  end if;
  if body is not null and length(body) > 4000 then
    return jsonb_build_object('ok', false, 'reason', 'That is too long for a note.');
  end if;

  select coalesce(u.full_name, u.email, u.username), u.contact_id
    into actor, v_contact
    from public.app_users u where u.id = me;

  insert into public.action_comments (action_id, body, author, author_contact_id)
  values (p_action_id, coalesce(body, ''), coalesce(actor, 'portal'), v_contact)
  returning id into v_id;

  -- Linked to the NOTE, which is the one thing it is evidence of. The task
  -- is reachable through it, and portal_close_task's photo gate now looks
  -- that way too - see the end of this file.
  foreach f in array v_files loop
    insert into public.file_links (file_id, action_comment_id, role, created_by_user_id)
    values (f, v_id, 'evidence', me);
  end loop;

  return jsonb_build_object('ok', true, 'id', v_id, 'author', coalesce(actor,'portal'),
                            'body', coalesce(body, ''), 'files', coalesce(array_length(v_files, 1), 0),
                            'created_at', now());
end $function$;

comment on function public.add_task_comment(uuid, text, uuid[]) is
  'Write a note on a task, optionally with evidence: photos, video, a document, or a VOICE recording. Files must already belong to the task''s project - a reference to anything else is dropped, never linked. A note may have no text when it carries a recording, because the recording is the note; empty with nothing attached is refused. Seeing the task is the bar, as commenting is not editing.';

revoke all on function public.add_task_comment(uuid, text, uuid[]) from public, anon;
grant execute on function public.add_task_comment(uuid, text, uuid[]) to authenticated, service_role;

-- Same name, one new optional argument, so every existing caller keeps
-- working through the one function. Dropping the old signature avoids the
-- overload ambiguity that has bitten this schema before.
drop function if exists public.add_task_comment(uuid, text);

-- ---------------------------------------------------------------------
-- 3. Read it back.
-- ---------------------------------------------------------------------
-- The notes on a task WITH what each one carries. portal_task_detail returns
-- comments without ids, so there is nothing to hang evidence off - and
-- matching a photo to a note by timestamp would be a guess. This returns
-- both together, which is the only way they cannot drift apart.
--
-- Applied as its own migration (task_notes_carry_their_evidence) after the
-- rest of this file; it replaced a first cut that returned bare evidence.
create or replace function public.portal_task_notes(p_action_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when not public.can_see_action(p_action_id) then '[]'::jsonb
  else coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'body', c.body, 'author', c.author, 'created_at', c.created_at,
      'files', coalesce((
        select jsonb_agg(jsonb_build_object(
          'file_id', f.id, 'path', f.path, 'kind', f.kind,
          'mime', f.mime_type, 'name', f.file_name) order by fl.created_at)
        from public.file_links fl
        join public.files f on f.id = fl.file_id
       where fl.action_comment_id = c.id), '[]'::jsonb))
      order by c.created_at)
    from public.action_comments c where c.action_id = p_action_id), '[]'::jsonb) end;
$$;

comment on function public.portal_task_notes(uuid) is
  'The notes on one task, oldest first, each with the evidence attached to it - photos, video, documents and voice recordings. Storage paths, never URLs: the app signs them. Returned together rather than as two reads because a note and its proof must not be matched up by guessing at timestamps.';

revoke all on function public.portal_task_notes(uuid) from public, anon;
grant execute on function public.portal_task_notes(uuid) to authenticated, service_role;

drop function if exists public.portal_task_evidence(uuid);

-- ---------------------------------------------------------------------
-- 4. The photo gate must see a photo on a note.
-- ---------------------------------------------------------------------
-- Otherwise someone photographs the work, writes it up, and is STILL told to
-- add a photo or say why there is none - which teaches people the gate is
-- noise. Counted on the task itself or on any note posted against it; every
-- other rule in portal_close_task is untouched.
create or replace function public.portal_close_task(p_action_id uuid, p_unlock_reason text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  a public.actions; me uuid := public.current_app_user_id(); actor text;
  n_photos int; reason text := nullif(btrim(p_unlock_reason), ''); prefix text; res jsonb;
begin
  perform public.assert_own_hands();
  if me is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.can_see_action(p_action_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'reason', 'That task is not yours to close.');
  end if;

  select * into a from public.actions where id = p_action_id;
  if not public.can_edit_project(a.project_id) then
    return jsonb_build_object('ok', false, 'code', 'READ_ONLY', 'reason', 'You have read-only access on this project.');
  end if;

  select coalesce(u.full_name, u.email, u.username) into actor
    from public.app_users u where u.id = me;

  select count(*) into n_photos
    from public.file_links fl
    join public.files f on f.id = fl.file_id
   where f.kind = 'photo'
     and (fl.action_id = p_action_id
          or fl.action_comment_id in (select c.id from public.action_comments c where c.action_id = p_action_id));

  if n_photos = 0 and reason is null then
    return jsonb_build_object('ok', false, 'code', 'NEEDS_PHOTO',
             'reason', 'Add a photo, or unlock and say why there is none.');
  end if;

  if n_photos = 0 then
    if length(reason) < 8 then
      return jsonb_build_object('ok', false, 'code', 'REASON_TOO_SHORT',
               'reason', 'Say why in a few words - this is recorded against the task.');
    end if;
    prefix := case
                when a.source like 'system:transaction:%' then 'CONFIRMATION RECORDED: '
                else 'CLOSED WITHOUT PHOTO. Reason given: '
              end;
    insert into public.action_comments (action_id, body, author)
    values (p_action_id, prefix || reason, coalesce(actor, 'portal'));
  end if;

  begin
    res := public.close_action(p_action_id, n_photos = 0, coalesce(actor, 'portal'));
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'BLOCKED', 'reason', sqlerrm);
  end;

  return jsonb_build_object('ok', true, 'photos', n_photos,
                            'unlocked', n_photos = 0, 'result', res);
end $function$;

comment on function public.portal_close_task(uuid, text) is
  'Close a task. The photo gate counts photos attached to the task OR to any note posted against it (migration 037) - a person who photographed the work and wrote it up has satisfied it. With no photo anywhere, closing records a reason of at least eight characters against the task.';

revoke all on function public.portal_close_task(uuid, text) from public, anon;
grant execute on function public.portal_close_task(uuid, text) to authenticated, service_role;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
