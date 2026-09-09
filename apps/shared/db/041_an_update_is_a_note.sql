-- 041 - an update is a note, not a line in a blob.
--
-- Shahar: "just created an update, but when i click on the task the update
-- does not show below. fix."
--
-- Two write paths had grown for the same act. The task screen's box posts
-- through add_task_comment: one action_comments row, evidence linked to
-- THAT row (migration 037), read back by portal_task_notes. The update sheet
-- - TaskSheet, the one every inbox row opens - went through
-- homeowner_task_update, which appended a line to actions.notes and hung the
-- files on the action. Same words, different shelf; the history never saw
-- them. Rulebook 03: one fact, one place. The sheet now posts the entry
-- through add_task_comment, and everything else it did - closing through
-- close_action, the timeline line for the counterpart - is unchanged.
create or replace function public.homeowner_task_update(
  p_project uuid, p_action_id uuid, p_note text default null,
  p_file_ids uuid[] default null, p_complete boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a public.actions; v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_files uuid[] := coalesce(p_file_ids, '{}'::uuid[]); f uuid;
  me_c uuid := public.my_contact_id(); v_to uuid; pr public.projects; b public.project_bookings;
  posted jsonb;
begin
  perform public.assert_own_hands();
  if not public.is_project_member(p_project) then return jsonb_build_object('ok', false, 'reason', 'You are not on this job.'); end if;
  select * into a from public.actions where id = p_action_id and project_id = p_project;
  if a.id is null then return jsonb_build_object('ok', false, 'reason', 'No such task on this job.'); end if;
  if a.status in ('Completed','Cancelled','Force Cancelled') then return jsonb_build_object('ok', true, 'already', true); end if;
  if v_note is null and array_length(v_files, 1) is null and not p_complete then
    return jsonb_build_object('ok', false, 'reason', 'Write a line or attach something first.');
  end if;
  -- Every attachment must be one the member can already see: they recorded it
  -- a moment ago through record_project_file, which did the real gate.
  foreach f in array v_files loop
    if not public.can_see_file(f) then return jsonb_build_object('ok', false, 'reason', 'One of those files is not yours.'); end if;
  end loop;

  -- THE ENTRY: a note on the task, with its evidence on the note. Closing
  -- with nothing to say still leaves a mark, so the history shows who
  -- closed it and when.
  posted := public.add_task_comment(a.id, coalesce(v_note, case when p_complete then 'Marked complete.' end), v_files);
  if not coalesce((posted->>'ok')::boolean, false) then return posted; end if;

  update public.actions set last_updated = now(), last_modified_by = 'portal:homeowner-app' where id = a.id;

  -- Closing is close_action's job, never a direct status UPDATE.
  if p_complete then
    perform public.close_action(a.id, false, 'portal:homeowner-app', 'Completed', true);
  end if;

  -- On a booked job with a counterpart, the timeline gets the same line so
  -- the other side sees what happened without being asked.
  select * into pr from public.projects where id = p_project;
  select * into b from public.project_bookings where project_id = p_project;
  if b.id is not null and me_c is not null then
    v_to := case when me_c = (select u.contact_id from public.app_users u where u.id = pr.owner_user_id) then b.contractor_contact_id
                 else (select u.contact_id from public.app_users u where u.id = pr.owner_user_id) end;
    if v_to is not null then
      insert into public.messages (body, direction, channel, status, sent_at, project_id, from_contact_id, to_contact_id, file_id, action_id, created_by)
      values (case when p_complete then 'Done: ' else 'Update: ' end || a.action || coalesce(E'\n' || v_note, ''),
              'inbound', 'in app', 'new', now(), p_project, me_c, v_to, v_files[1], a.id, 'homeowner-app');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'completed', p_complete, 'attached', coalesce(array_length(v_files, 1), 0), 'note', posted->>'id');
end $$;

comment on function public.homeowner_task_update(uuid, uuid, text, uuid[], boolean) is
  'One entry on an open task from the update sheet: a note through add_task_comment (evidence on the note, migration 037), optionally closing the task through close_action, and the same line on the timeline when there is a counterpart. Never appends to actions.notes - the history is action_comments, read by portal_task_notes.';

-- The entries the old path already appended, moved onto the shelf the
-- history reads from. One line per entry in the blob, in the exact shape
-- the old function wrote; the attachments it listed are already linked to
-- the action, so the evidence is not lost, only the words were. The blob
-- keeps whatever was there before the first appended line.
with parsed as (
  select a.id as action_id,
         (m[1])::timestamptz as at, m[2] as verb, btrim(m[3]) as who, nullif(btrim(m[4]), '') as body
    from public.actions a,
         regexp_matches(a.notes,
           '(?m)^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}) - (updated|completed) by ([^:\[\n]+?)(?::\s*(.*?))?(?:\s*\[\d+ attachments?: [^\]]*\])?$', 'g') m
   where a.notes ~ '(?m)^\d{4}-\d{2}-\d{2} \d{2}:\d{2} - (updated|completed) by '
)
insert into public.action_comments (action_id, body, author, author_contact_id, created_at)
select p.action_id,
       coalesce(p.body, case when p.verb = 'completed' then 'Marked complete.' else '' end),
       p.who,
       (select u.contact_id from public.app_users u where u.full_name = p.who limit 1),
       p.at
  from parsed p
 where not exists (select 1 from public.action_comments c
                    where c.action_id = p.action_id and c.created_at = p.at and c.author = p.who);

update public.actions a
   set notes = nullif(btrim(regexp_replace(a.notes,
                 '(?:\n\n)?^\d{4}-\d{2}-\d{2} \d{2}:\d{2} - (?:updated|completed) by [^\n]*$', '', 'gm')), '')
 where a.notes ~ '(?m)^\d{4}-\d{2}-\d{2} \d{2}:\d{2} - (updated|completed) by ';

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
