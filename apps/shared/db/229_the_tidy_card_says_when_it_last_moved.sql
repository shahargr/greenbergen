-- THE TIDY CARD SAYS WHEN IT LAST MOVED.
--
-- Shahar, 2026-09-24, restructuring the tidy panel: the top line goes, the
-- action leads, then "Info: Late / on time" and "Status: Last update made
-- on this task". The queue had everything but the last-update stamp; one
-- ADDITIVE key - updated_at (actions.last_updated) - and the existing
-- readers keep their shape. Same body as live otherwise (migration 173
-- lineage).
--
-- It also surfaced a real confusion: the PSE&G $450 task looked "flagged
-- completed" to Shahar but the row said In Progress with no completion
-- ever written - the tidy queue was RIGHT to show it. The card now saying
-- "In Progress · updated Sep 3" out loud is the fix for that class of
-- surprise; the row itself was closed by hand the same day.
create or replace function public.portal_tidy_queue(p_project uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  with fam as (select f.id from public.project_ancestry_down(p_project) f),
  people as (
    select distinct split_part(coalesce(co.person_name, co.name), ' ', 1) as first_name,
           coalesce(co.person_name, co.name) as name, ct.trade
      from public.contracts ct
      join public.contacts co on co.id = coalesce(ct.contractor_id, ct.counterparty_contact_id)
     where ct.project_id in (select id from fam)
       and ct.trade is not null
       and lower(coalesce(ct.status, '')) not in ('cancelled', 'void', 'placeholder')
       and length(split_part(coalesce(co.person_name, co.name), ' ', 1)) >= 3
  ),
  q as (
    select a.id, a.action, a.notes, a.status_note, a.status, a.priority, a.target_date, a.created_at, a.created_by,
           a.last_updated,
           a.trade, a.project_id, p.project_name as project,
           a.assigned_to_contact_id as assignee_id,
           coalesce((select coalesce(c2.person_name, c2.name) from public.contacts c2 where c2.id = a.assigned_to_contact_id),
                    (select ps.name from public.personas ps where ps.id = a.assigned_to_persona_id)) as assignee,
           (select pa.action from public.actions pa where pa.id = a.parent_action_id) as parent_title,
           (a.target_date is not null and a.target_date < current_date) as late,
           lower(a.action) as title,
           lower(coalesce(a.notes, '')) as body
      from public.actions a
      join public.projects p on p.id = a.project_id
     where a.project_id in (select id from fam)
       and a.status not in ('Completed', 'Cancelled', 'Force Cancelled', 'Superseded')
       and (a.trade is null or (a.assigned_to_contact_id is null and a.assigned_to_persona_id is null))
       and public.can_see_action(a.id)
  ),
  guessed as (
    select q.*, g.guess, g.why
      from q
      cross join lateral (
        select u.guess, u.why
          from (
            select k.trade as guess, '"' || k.keyword || '" in the title' as why, 1 as rank_, length(k.keyword) as len
              from public.trade_keywords k where q.title ~ ('\m' || k.keyword || '\M')
            union all
            select pe.trade, 'the title names ' || pe.name, 2, length(pe.first_name)
              from people pe where q.title ~* ('\m' || pe.first_name || '\M')
            union all
            select k.trade, '"' || k.keyword || '" in the notes', 3, length(k.keyword)
              from public.trade_keywords k where q.body ~ ('\m' || k.keyword || '\M')
            union all
            select pe.trade, 'the notes name ' || pe.name, 4, length(pe.first_name)
              from people pe where q.body ~* ('\m' || pe.first_name || '\M')
          ) u
         order by u.rank_, u.len desc
         limit 1
      ) g
  )
  select case when not (public.is_project_member(p_project) or public.is_superadmin()) then null
  else jsonb_build_object(
    'n', (select count(*) from q),
    'no_trade', (select count(*) from q where q.trade is null),
    'no_holder', (select count(*) from q where q.assignee_id is null and q.assignee is null),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object(
        'id', g.id, 'action', g.action, 'notes', g.notes, 'status_note', g.status_note, 'status', g.status,
        'priority', g.priority, 'target_date', g.target_date, 'created_at', g.created_at, 'created_by', g.created_by,
        'updated_at', g.last_updated,
        'trade', g.trade, 'project_id', g.project_id, 'project', g.project,
        'assignee_id', g.assignee_id, 'assignee', g.assignee, 'parent_title', g.parent_title, 'late', g.late,
        'guess', case when g.trade is null then g.guess end,
        'why', case when g.trade is null then g.why end)
      order by g.late desc, g.target_date nulls last, g.created_at desc)
      from (select * from guessed limit 300) g), '[]'::jsonb)) end;
$function$;

comment on function public.portal_tidy_queue(uuid) is
  'The tidy pile (173): open tasks on the family with no trade or no holder, '
  'late first, each with a guessed trade and its reason. 229 adds updated_at '
  'so the card can say when the task last moved.';
