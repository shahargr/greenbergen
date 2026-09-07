-- ============================================================================
-- Homeowner app, part 7: AN UPDATE IS NOT A COMPLETION.
--
-- The inbox's only verb was "Done", and the only thing the sheet could do was
-- close the task. But most of what a homeowner has to say about an open task
-- is not "it's finished" - it is "I called the town", "here are the three
-- photos the inspector wanted", "still waiting on the part". Closing was the
-- price of being heard, so the log lost the middle of every job.
--
-- homeowner_task_update posts one entry: a comment, any number of
-- attachments, and a flag for whether this entry also FINISHES the task.
-- Not complete -> the task stays open and the entry lands on its notes,
-- its file_links and the timeline. Complete -> the same, then close_action,
-- exactly as homeowner_task_close did (which stays, for the one-tap close on
-- the job screen and for anything already calling it).
--
-- Also: blinds & shades moves out of the front grid into More. The home
-- screen now leads with the eight packages it can price on the spot.
--
-- Additive: no table changed, no row deleted. The blinds row is a template
-- (blueprint_packages), not anyone's job.
-- ============================================================================
begin;

create or replace function public.homeowner_task_update(
  p_project uuid, p_action_id uuid, p_note text default null,
  p_file_ids uuid[] default null, p_complete boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a public.actions; v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_files uuid[] := coalesce(p_file_ids, '{}'::uuid[]); f uuid;
  me_c uuid := public.my_contact_id(); v_to uuid; pr public.projects; b public.project_bookings;
  v_who text; v_verb text := case when p_complete then 'completed' else 'updated' end;
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

  -- The member's own words and evidence go on the task itself, so the log
  -- keeps the middle of the job and not just its end.
  select coalesce(u.full_name, u.email, 'a member') into v_who from public.app_users u where u.id = public.current_app_user_id();
  update public.actions
     set notes = coalesce(notes || E'\n\n', '') || to_char(now(), 'YYYY-MM-DD HH24:MI') || ' - ' || v_verb || ' by ' || v_who ||
                 coalesce(': ' || v_note, '') ||
                 case when array_length(v_files, 1) is null then ''
                      else ' [' || array_length(v_files, 1) || ' attachment' || case when array_length(v_files, 1) = 1 then '' else 's' end || ': ' ||
                           array_to_string(v_files::text[], ', ') || ']' end,
         last_updated = now(), last_modified_by = 'portal:homeowner-app'
   where id = a.id;

  foreach f in array v_files loop
    if not exists (select 1 from public.file_links fl where fl.file_id = f and fl.action_id = a.id) then
      insert into public.file_links (file_id, action_id, role) values (f, a.id, 'evidence');
    end if;
  end loop;

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
      insert into public.messages (body, direction, channel, status, sent_at, project_id, from_contact_id, to_contact_id, file_id, created_by)
      values (case when p_complete then 'Done: ' else 'Update: ' end || a.action || coalesce(E'\n' || v_note, ''),
              'inbound', 'in app', 'new', now(), p_project, me_c, v_to, v_files[1], 'homeowner-app');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'completed', p_complete, 'attached', coalesce(array_length(v_files, 1), 0));
end $$;
comment on function public.homeowner_task_update(uuid, uuid, text, uuid[], boolean) is 'One entry on an open task: a comment, any number of attachments already recorded in files, and whether this entry also finishes it. p_complete false leaves the task open - the point of the function, since most of what a member has to say about a task is not that it is done. p_complete true closes it through close_action, never a direct status UPDATE. Both land on the task''s notes, its file_links, and the timeline when there is a counterpart.';

revoke all on function public.homeowner_task_update(uuid, uuid, text, uuid[], boolean) from public, anon;
grant execute on function public.homeowner_task_update(uuid, uuid, text, uuid[], boolean) to authenticated, service_role;

-- ---------------------------------------------------------------- the grid
-- Eight packages the home screen can price on the spot, four to a row.
-- Blinds moves to More; nothing about the package itself changes.
update public.blueprint_packages set tile_group = 'more' where code = 'blinds' and tile_group <> 'more';

commit;
