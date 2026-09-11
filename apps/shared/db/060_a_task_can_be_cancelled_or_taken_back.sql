-- 060 - a task can be cancelled, or taken back if it was a slip.
--
-- Shahar (2026-09-11), signed in as the contractor: "ability to delete
-- tasks or flag as cancelled when I enter them." The Professionals task
-- page could complete a task (portal_close_task) and edit it
-- (portal_task_edit) but not say "this will not happen".
--
-- TWO VERBS, because they are two different things (rulebook 15 keeps the
-- vocabulary; transaction_statuses says it for money: "Cancelled - will not
-- happen. Kept for history rather than deleted."):
--   portal_task_cancel  - the task stays as record, status Cancelled, the
--                         reason on it, through close_action like every
--                         other closing (children force-cancelled with it,
--                         a cadence ends).
--   portal_task_delete  - the row goes. Only for a slip: nothing has been
--                         posted on it, nothing hangs off it, and either you
--                         run the site (rank >= 50 / admin) or you made it.
--                         Anything else is refused with "cancel it instead".
create or replace function public.portal_task_cancel(p_action_id uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare a public.actions; me uuid := public.current_app_user_id(); actor text; res jsonb;
begin
  perform public.assert_own_hands();
  if me is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.can_see_action(p_action_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'reason', 'That task is not yours to cancel.');
  end if;
  select * into a from public.actions where id = p_action_id;
  if not public.can_edit_project(a.project_id) then
    return jsonb_build_object('ok', false, 'code', 'READ_ONLY', 'reason', 'You have read-only access on this project.');
  end if;
  if a.status in ('Completed','Cancelled','Force Cancelled','Superseded') then
    return jsonb_build_object('ok', false, 'code', 'CLOSED', 'reason', 'This task is already ' || lower(a.status) || '.');
  end if;
  select coalesce(u.full_name, u.email, u.username) into actor from public.app_users u where u.id = me;
  update public.actions
     set notes = coalesce(notes, '') || E'\n\n[' || to_char(now(), 'YYYY-MM-DD') || '] Cancelled by ' || coalesce(actor, 'a member')
                 || coalesce(': ' || nullif(btrim(p_reason), ''), '.'),
         last_modified_by = coalesce(actor, 'portal:cancel')
   where id = p_action_id;
  res := public.close_action(p_action_id, true, coalesce(actor, 'portal:cancel'), 'Cancelled', true);
  return jsonb_build_object('ok', true, 'status', 'Cancelled', 'children_cancelled', res->'children_force_cancelled');
end $$;

create or replace function public.portal_task_delete(p_action_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare a public.actions; me uuid := public.current_app_user_id(); v_mine boolean; n int;
begin
  perform public.assert_own_hands();
  if me is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.can_see_action(p_action_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'reason', 'That task is not yours to delete.');
  end if;
  select * into a from public.actions where id = p_action_id;
  if not public.can_edit_project(a.project_id) then
    return jsonb_build_object('ok', false, 'code', 'READ_ONLY', 'reason', 'You have read-only access on this project.');
  end if;
  -- Who made it: the change log says, when it went in through an app.
  v_mine := exists (select 1 from public.change_events e
                     where e.table_name = 'actions' and e.row_id = p_action_id::text and e.op = 'insert' and e.actor = me::text);
  if not (public.is_superadmin() or public.my_authority_rank(a.project_id) >= 50 or v_mine) then
    return jsonb_build_object('ok', false, 'code', 'NOT_YOURS', 'reason', 'Only whoever runs the site, or the person who made it, deletes a task. Cancel it instead.');
  end if;
  -- Nothing may hang off it: a task with a history is a record, not a slip.
  select count(*) into n from public.action_comments where action_id = p_action_id;
  if n > 0 then return jsonb_build_object('ok', false, 'code', 'HAS_NOTES', 'reason', 'This task has ' || n || ' note(s) on it - it is a record now. Cancel it instead.'); end if;
  select count(*) into n from public.file_links where action_id = p_action_id;
  if n > 0 then return jsonb_build_object('ok', false, 'code', 'HAS_FILES', 'reason', 'This task has ' || n || ' file(s) on it. Cancel it instead.'); end if;
  select count(*) into n from public.actions where parent_action_id = p_action_id or recurrence_source_action_id = p_action_id or follows_action_id = p_action_id;
  if n > 0 then return jsonb_build_object('ok', false, 'code', 'HAS_CHILDREN', 'reason', 'Other tasks hang off this one. Cancel it instead.'); end if;
  select count(*) into n from public.transactions where action_id = p_action_id;
  if n > 0 then return jsonb_build_object('ok', false, 'code', 'HAS_MONEY', 'reason', 'A payment is recorded against this task. Cancel it instead.'); end if;
  if a.source like 'system:%' then
    return jsonb_build_object('ok', false, 'code', 'SYSTEM', 'reason', 'The system made this task and reads it back. Cancel it instead.');
  end if;
  delete from public.messages where action_id = p_action_id;
  delete from public.action_events where action_id = p_action_id;
  delete from public.actions where id = p_action_id;
  return jsonb_build_object('ok', true, 'deleted', p_action_id);
end $$;

revoke all on function public.portal_task_cancel(uuid, text) from public, anon;
revoke all on function public.portal_task_delete(uuid) from public, anon;
grant execute on function public.portal_task_cancel(uuid, text), public.portal_task_delete(uuid) to authenticated, service_role;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
