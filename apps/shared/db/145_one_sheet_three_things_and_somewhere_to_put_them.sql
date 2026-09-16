-- 145. ONE SHEET, THREE THINGS, AND SOMEWHERE TO PUT THEM.
--
-- Shahar (2026-09-16): "The floating icons (todo / note / order) to all, have
-- the same size of screen opens with text box, take photo, attach image/file,
-- and record voice. Working on computer, great to allow drop on files.
-- Saving time is priority. If user clicks on it from inside a project, and
-- trade, auto populate these into the job selection box. Job selection can be
-- as granular as Job / Project / Task / etc ... and limit to what I can
-- actually see from permission stand point."
--
-- THREE KINDS, AND THE THIRD WAS ALREADY MODELLED. An order is not a new
-- concept needing a new table - actions.delivers has said 'work' or 'product'
-- all along, and nothing had ever written 'product'. "Order 40 stair treads
-- from Kuiken" is a task that delivers a thing rather than a day's work. So
-- Order is the same row as To do with one column different, which is why it
-- can wear the same sheet.
--
-- WHERE ATTACHMENTS LIVE, said plainly rather than implied. record_project_file
-- requires can_edit_project and stores under project-media/<job>/, so a photo
-- necessarily belongs to a job - there is no private bucket and inventing one
-- would be a much larger change than this. That settles a question the
-- notebook would otherwise fudge:
--
--     a note's WORDS are private (migration 141, a row policy)
--     a note's FILES are the job's, visible to the job like any site photo
--
-- Both halves are true and the screen says so. The alternative - pretending a
-- photo is as private as the sentence next to it - is the kind of promise
-- that gets found out.

-- ---------------------------------------------------------------------------
-- WHAT A NOTE CARRIES. An array rather than a file_links target: file_links
-- has a one-of-eleven CHECK and a read policy keyed on project membership,
-- and threading a private row through both would mean either weakening that
-- policy or lying about who can see the photo. The files are the job's; the
-- note only remembers which of them are its own.
alter table public.notes
  add column if not exists file_ids uuid[] not null default '{}';

comment on column public.notes.file_ids is
'The files attached to this note, which live on the note''s JOB (record_project_file requires can_edit_project and stores under project-media/<job>/). The note''s words are private to its author; its files are not, and the sheet says so. Empty when the note has no job, because there is nowhere to put a photo.';

-- ---------------------------------------------------------------------------
create or replace function public.portal_note_add(
  p_body text,
  p_project uuid default null,
  p_trade text default null,
  p_action uuid default null,
  p_screen text default null,
  p_intent text default 'note',
  p_file_ids uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_me uuid; v_project uuid; v_trade text; v_action uuid; v_id uuid; v_intent text;
  v_files uuid[] := '{}';
begin
  v_me := public.current_app_user_id();
  if v_me is null then
    return jsonb_build_object('ok', false, 'code', 'NO_USER',
      'reason', 'Sign in and the notebook is yours.');
  end if;
  if length(btrim(coalesce(p_body, ''))) = 0 and coalesce(array_length(p_file_ids, 1), 0) = 0 then
    return jsonb_build_object('ok', false, 'code', 'EMPTY',
      'reason', 'A note needs some words, or something attached.');
  end if;
  v_intent := case when lower(coalesce(p_intent, 'note')) = 'task' then 'task' else 'note' end;

  -- The task, only if it is one that EXISTS and that you may actually read.
  -- Both halves matter: can_see_action answers true for a superadmin whatever
  -- uuid it is handed, so trusting it alone sends a made-up id straight into
  -- the foreign key and a person gets a constraint name instead of a note.
  if p_action is not null then
    select a.project_id, coalesce(p_trade, a.trade) into v_project, v_trade
      from public.actions a
     where a.id = p_action and public.can_see_action(a.id);
    if found then v_action := p_action; end if;
  end if;

  if v_project is null and p_project is not null and public.is_project_member(p_project) then
    v_project := p_project;
  end if;
  if v_project is not null and not public.is_project_member(v_project) then
    v_project := null; v_action := null;
  end if;

  if v_trade is null and p_trade is not null then
    select tr.trade into v_trade from public.trades tr
     where lower(tr.trade) = lower(btrim(p_trade)) limit 1;
  end if;

  -- A file is kept only when it really sits on this note's job. The uploader
  -- already had to pass can_edit_project to create it; this stops a note
  -- claiming somebody else's file by id.
  if p_file_ids is not null and v_project is not null then
    select coalesce(array_agg(f.id), '{}') into v_files
      from public.files f
     where f.id = any(p_file_ids)
       and f.project_id in (select d.id from public.project_ancestry_down(v_project) d);
  end if;

  insert into public.notes (app_user_id, body, project_id, trade, action_id, screen, intent, file_ids)
  values (v_me, btrim(coalesce(p_body, '')), v_project, v_trade, v_action,
          nullif(btrim(coalesce(p_screen, '')), ''), v_intent, v_files)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'intent', v_intent,
    'project_id', v_project, 'trade', v_trade, 'action_id', v_action,
    'files', coalesce(array_length(v_files, 1), 0));
end $function$;

comment on function public.portal_note_add(text, uuid, text, uuid, text, text, uuid[]) is
'Writes one capture. Only the words are required - or an attachment instead of them. The job, the trade and the task are inferred from where you were standing and dropped rather than trusted when they name something you cannot read. Files are kept only when they sit on the note''s own job.';

-- ---------------------------------------------------------------------------
-- A SIMPLE TASK THAT MIGHT DELIVER A THING. delivers is the only difference
-- between "call the framer" and "order 40 stair treads", and it was already a
-- column; nothing had ever written 'product' to it.
create or replace function public.portal_task_quick(
  p_project uuid, p_action text, p_trade text default null,
  p_target_date date default null, p_assignee uuid default null,
  p_priority text default null, p_parent uuid default null,
  p_delivers text default 'work', p_file_ids uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare r jsonb; v_id uuid; v_delivers text;
begin
  v_delivers := case when lower(coalesce(p_delivers, 'work')) = 'product' then 'product' else 'work' end;

  r := public.portal_task_create(
    p_project => p_project,
    p_action  => p_action,
    p_delivers => v_delivers,
    p_priority => p_priority,
    p_target_date => p_target_date,
    p_assignee => p_assignee,
    p_parent => p_parent,
    p_trade => p_trade,
    p_file_ids => p_file_ids);
  if not coalesce((r->>'ok')::boolean, false) then return r; end if;

  v_id := (r->>'id')::uuid;
  update public.actions set accepts_steps = false where id = v_id;

  return r || jsonb_build_object('simple', true, 'delivers', v_delivers);
end $function$;

comment on function public.portal_task_quick(uuid, text, text, date, uuid, text, uuid, text, uuid[]) is
'A simple task: one line, logged where you are standing, inheriting the trade (and the parent, when it is a step of something). p_delivers = product makes it an ORDER - a thing arriving rather than a day''s work - which is the only difference between the two. Everything portal_task_create checks is still checked, and the row comes back with accepts_steps false.';

-- ---------------------------------------------------------------------------
-- WHERE A CAPTURE CAN GO, and nowhere else.
--
-- "Job selection can be as granular as Job / Project / Task / etc ... and
-- limit to what I can actually see from permission stand point."
--
-- Projects are filtered by can_edit_project, not by membership: the list is
-- for FILING something, and offering a job you may only read is offering a
-- refusal. They come back as a tree flattened into reading order with a depth,
-- so a property and the jobs under it stay together in the picker.
--
-- Tasks come back only for the job in hand, because a board-wide task list
-- costs a read nobody asked for and the picker only ever shows one job's
-- worth. They are filtered through can_see_action - the ladder from migration
-- 138 - so a contract-bounded trade is offered their own work and not the
-- bidding.
create or replace function public.portal_capture_targets(p_project uuid default null)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  -- RECURSIVE because tree walks itself: a property, then the jobs under it,
  -- then anything under those.
  with recursive mine as (
    select p.id, p.project_name, p.parent_project_id, p.address, p.asset_id
      from public.projects p
     where p.trashed_at is null
       and coalesce(p.status, '') not like 'Closed%'
       and coalesce(p.is_template, false) = false
       and public.can_edit_project(p.id)
  ),
  tree as (
    select m.id, m.project_name, m.parent_project_id, m.address, m.asset_id,
           0 as depth, lower(m.project_name) as path
      from mine m
     where m.parent_project_id is null
        or m.parent_project_id not in (select id from mine)
    union all
    select k.id, k.project_name, k.parent_project_id, k.address, k.asset_id,
           t.depth + 1, t.path || ' / ' || lower(k.project_name)
      from mine k join tree t on k.parent_project_id = t.id
     where t.depth < 5
  )
  select jsonb_build_object(
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.project_name, 'parent_id', t.parent_project_id,
        'address', t.address, 'is_property', t.asset_id is not null,
        'depth', t.depth)
        order by t.path)
      from tree t), '[]'::jsonb),
    'tasks', case when p_project is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'action', x.action, 'trade', x.trade,
        'accepts_steps', x.accepts_steps)
        order by x.target_date nulls last, x.action)
      from (select a.id, a.action, a.trade, a.accepts_steps, a.target_date
              from public.actions a
             where a.project_id in (select d.id from public.project_ancestry_down(p_project) d)
               and a.status not in ('Completed','Cancelled','Force Cancelled','Superseded')
               and public.can_see_action(a.id)
             order by a.target_date nulls last, a.action
             limit 200) x), '[]'::jsonb) end);
$function$;

comment on function public.portal_capture_targets(uuid) is
'Where a capture may be filed: every open project you may ADD WORK TO (can_edit_project, not merely membership - offering a job you can only read is offering a refusal), flattened into reading order with a depth so a property and its jobs stay together; plus, for one job, the open tasks you are allowed to see. Feeds the floating sheet''s job picker.';

-- ---------------------------------------------------------------------------
-- The notebook hands back what is attached, so a note that is mostly a
-- photograph is not a blank line in the list.
create or replace function public.portal_notes(
  p_project uuid default null,
  p_trade text default null,
  p_show text default 'open',
  p_limit integer default 200)
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  with mine as (
    select n.* from public.notes n
     where n.app_user_id = public.current_app_user_id()
       and (p_project is null or n.project_id = p_project)
       and (p_trade is null or lower(n.trade) = lower(p_trade))
       and (case lower(coalesce(p_show, 'open'))
              when 'done' then n.archived_at is not null
              when 'all'  then true
              when 'sweep' then n.archived_at is null
                    and (n.reviewed_at is null or n.reviewed_at < date_trunc('day', now()))
              else n.archived_at is null end)
     order by
       case when lower(coalesce(p_show, 'open')) = 'sweep'
            then case when n.intent = 'task' then 0 else 1 end else 0 end,
       case when lower(coalesce(p_show, 'open')) = 'sweep' then 0 else (n.pinned)::int end desc,
       case when lower(coalesce(p_show, 'open')) = 'sweep' then n.created_at end asc,
       n.created_at desc
     limit greatest(coalesce(p_limit, 200), 0)
  )
  select jsonb_build_object(
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'body', m.body,
        'intent', m.intent,
        'project_id', m.project_id,
        'project', (select p.project_name from public.projects p where p.id = m.project_id),
        'trade', m.trade,
        'action_id', m.action_id,
        'task', (select a.action from public.actions a where a.id = m.action_id),
        'screen', m.screen,
        'pinned', m.pinned,
        'created_at', m.created_at,
        'reviewed_at', m.reviewed_at,
        'archived', m.archived_at is not null,
        'became_action_id', m.became_action_id,
        'became', (select a.action from public.actions a where a.id = m.became_action_id),
        'files', coalesce((
          select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.file_name,
                                              'kind', f.kind, 'bucket', f.bucket, 'path', f.path)
                           order by f.created_at)
            from public.files f where f.id = any(m.file_ids)), '[]'::jsonb)))
      from mine m), '[]'::jsonb),
    'open', (select count(*) from public.notes n
              where n.app_user_id = public.current_app_user_id() and n.archived_at is null),
    'here', (select count(*) from public.notes n
              where n.app_user_id = public.current_app_user_id() and n.archived_at is null
                and (p_project is null or n.project_id = p_project)
                and (p_trade is null or lower(n.trade) = lower(p_trade))),
    'to_sweep', (select count(*) from public.notes n
                  where n.app_user_id = public.current_app_user_id() and n.archived_at is null
                    and (n.reviewed_at is null or n.reviewed_at < date_trunc('day', now()))));
$function$;

-- The files come with it. A note promoted to a task takes its photograph.
create or replace function public.portal_note_to_task(
  p_note uuid,
  p_action text default null,
  p_target_date date default null,
  p_assignee uuid default null,
  p_project uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n public.notes; r jsonb; v_text text; v_project uuid;
begin
  select * into n from public.notes
   where id = p_note and app_user_id = public.current_app_user_id();
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_YOURS',
      'reason', 'That note is not in your notebook.');
  end if;
  if n.became_action_id is not null then
    return jsonb_build_object('ok', true, 'id', n.became_action_id, 'existed', true);
  end if;

  v_project := coalesce(n.project_id, p_project);
  if v_project is null then
    return jsonb_build_object('ok', false, 'code', 'NO_PROJECT',
      'reason', 'Which job does this belong to?');
  end if;

  v_text := btrim(coalesce(nullif(btrim(coalesce(p_action, '')), ''),
                           split_part(n.body, E'\n', 1)));
  if v_text = '' then v_text := 'Something to do'; end if;
  if length(v_text) > 300 then v_text := left(v_text, 297) || '...'; end if;

  r := public.portal_task_quick(
    p_project => v_project,
    p_action  => v_text,
    p_trade   => n.trade,
    p_target_date => p_target_date,
    p_assignee => p_assignee,
    p_file_ids => nullif(n.file_ids, '{}'));
  if not coalesce((r->>'ok')::boolean, false) then return r; end if;

  update public.actions
     set desired_outcome = case when btrim(n.body) <> v_text then n.body else desired_outcome end
   where id = (r->>'id')::uuid;

  update public.notes
     set became_action_id = (r->>'id')::uuid,
         project_id = coalesce(project_id, v_project),
         archived_at = coalesce(archived_at, now()),
         reviewed_at = now(),
         last_updated = now()
   where id = p_note;

  return r || jsonb_build_object('note', p_note, 'existed', false);
end $function$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
