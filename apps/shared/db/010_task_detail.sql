-- 010 - the task, as the person doing it needs it.
--
-- Two findings, both pre-existing, both fixed here without moving a row.
--
-- ONE. THE NOTES ON A TASK LIVE IN TWO TABLES AND THE READER SEES ONE.
-- add_task_comment() and portal_close_task() write to action_comments (13
-- rows). portal_task_detail() reads task_comments (2 rows). So every note a
-- portal user has ever posted, and every "CLOSED WITHOUT PHOTO. Reason
-- given:" line the close path records, is INVISIBLE on the task screen -
-- including the audit trail that exists precisely to be read.
--
-- This reads both, newest first. It does not merge the tables: which one
-- survives, and what happens to the writers, is Shahar's call under rulebook
-- 30 - a duplicated table costs correctness, and the choice of which to keep
-- is not one to make quietly inside a UI change. Until then, nothing is
-- hidden.
--
-- TWO. THREE portal_ FUNCTIONS ARE EXECUTABLE BY anon. Rulebook 71: the
-- GRANT is the boundary, not the policy. All three self-check membership, so
-- nothing was reachable - but the anon key ships inside front-end JavaScript
-- and the rule is to default the surface to revoked. Revoked here, granted
-- back to authenticated and service_role deliberately.
--
-- create or replace preserves a function's existing ACL, so the grants below
-- are stated explicitly rather than assumed.

create or replace function public.portal_task_detail(p_task uuid)
returns jsonb
language sql
stable security definer
set search_path = public
as $$
  select case
    when a.id is null or not public.is_project_member(a.project_id) then null
    else jsonb_build_object(
      'id', a.id, 'action', a.action, 'status', a.status, 'priority', a.priority,
      'target_date', a.target_date, 'desired_outcome', a.desired_outcome, 'notes', a.notes,
      'pending_on', a.pending_on, 'pending_reason', a.pending_reason,
      'requires_photo_evidence', a.requires_photo_evidence,
      'created_at', a.created_at, 'created_by', a.created_by, 'last_updated', a.last_updated,
      'project_id', a.project_id,
      'project', (select p.project_name from projects p where p.id = a.project_id),
      'assignee', (select jsonb_build_object('id', c.id, 'name', coalesce(c.person_name, c.name))
                   from contacts c where c.id = a.assigned_to_contact_id),
      'evidence', coalesce((
        select jsonb_agg(jsonb_build_object('id', f.id, 'file_name', f.file_name, 'kind', f.kind,
                                            'bucket', f.bucket, 'path', f.path, 'role', fl.role)
                         order by f.created_at desc)
        from file_links fl join files f on f.id = fl.file_id
        where fl.action_id = a.id), '[]'::jsonb),
      -- Both note tables, newest first. Neither writer changes.
      'comments', coalesce((
        select jsonb_agg(jsonb_build_object('author', c.author, 'body', left(c.body, 300),
                                            'created_at', c.created_at)
                         order by c.created_at desc)
        from (
          select tc.author_name as author, tc.body, tc.created_at
            from task_comments tc where tc.action_id = a.id
          union all
          select ac.author, ac.body, ac.created_at
            from action_comments ac where ac.action_id = a.id
          order by created_at desc
          limit 8
        ) c), '[]'::jsonb),
      'open_children', (select count(*) from actions ch where ch.parent_action_id = a.id
                        and ch.status not in ('Completed','Cancelled','Force Cancelled','Superseded'))
    ) end
  from actions a where a.id = p_task;
$$;

revoke all on function public.portal_task_detail(uuid) from public, anon;
grant execute on function public.portal_task_detail(uuid) to authenticated, service_role;

revoke all on function public.portal_tasks(uuid, integer, integer, text) from public, anon;
grant execute on function public.portal_tasks(uuid, integer, integer, text) to authenticated, service_role;

revoke all on function public.portal_my_work() from public, anon;
grant execute on function public.portal_my_work() to authenticated, service_role;
