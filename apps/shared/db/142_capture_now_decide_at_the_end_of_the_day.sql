-- 142. CAPTURE NOW, DECIDE AT THE END OF THE DAY.
--
-- Shahar (2026-09-15), on the notebook: "that floaty thing for the notes is
-- fantastic. I think we need the floaty thing for easy tasks as well. Like,
-- things to do versus notes... maybe you can do two tabs when you click on
-- that. So it's one click, but you get to do, is this a task or this is a log
-- action? In any event, we can have a process that goes after them one by one
-- at the end of the day and turn them into a task or into an action. So that
-- becomes kind of the back office."
--
-- Three things in that, and the third is the one that matters.
--
-- ONE. A thing to do is not a thing to remember, and the button should not
-- make you decide which door to walk through before you have written the
-- sentence. Two tabs, one tap to open.
--
-- TWO. A task needs a job; a note does not. On a project screen that is free -
-- the sheet already knows where you are standing. Off one, the honest answer
-- is to ask which job rather than to guess, so portal_notes now hands back the
-- jobs you may actually add work to.
--
-- THREE, AND THIS IS THE BACK OFFICE. Capture and triage are different times
-- of day. What makes a capture box work is that it never asks a question at
-- the moment you are trying to write something down; what stops it becoming a
-- landfill is that something goes through it later. So a note carries what it
-- was MEANT to be, and the sweep walks the ones nobody has looked at today.
--
-- A thing you wrote down meaning to make it work, that could not become work
-- because there was no job to put it on. This is the queue the sweep exists
-- for - not a preference, a piece of unfinished business.
alter table public.notes
  add column if not exists intent text not null default 'note';

alter table public.notes drop constraint if exists chk_notes_intent;
alter table public.notes
  add constraint chk_notes_intent check (intent in ('note', 'task'));

comment on column public.notes.intent is
'What this capture was MEANT to be. A note taken on the Note tab is a note. A note taken on the To do tab is intent = task and only exists because there was no job to put the task on - it is unfinished business, and the end-of-day sweep puts it first.';

-- "A process that goes after them one by one at the end of the day." Keeping a
-- note is a decision, and a sweep that keeps offering you the same eleven
-- notes you already decided to keep is a sweep you stop running. Recording the
-- decision with a DATE rather than a flag is what makes it a daily rhythm: the
-- queue empties tonight and fills again tomorrow, which is what "at the end of
-- the day" means.
alter table public.notes
  add column if not exists reviewed_at timestamptz;

comment on column public.notes.reviewed_at is
'When you last went through this note in the end-of-day sweep and chose to keep it. The sweep queues notes not reviewed TODAY, so keeping something clears it until tomorrow rather than for ever.';

create index if not exists idx_notes_sweep
  on public.notes (app_user_id, archived_at, reviewed_at);

-- ---------------------------------------------------------------------------
create or replace function public.portal_note_add(
  p_body text,
  p_project uuid default null,
  p_trade text default null,
  p_action uuid default null,
  p_screen text default null,
  p_intent text default 'note')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_me uuid; v_project uuid; v_trade text; v_action uuid; v_id uuid; v_intent text;
begin
  v_me := public.current_app_user_id();
  if v_me is null then
    return jsonb_build_object('ok', false, 'code', 'NO_USER',
      'reason', 'Sign in and the notebook is yours.');
  end if;
  if length(btrim(coalesce(p_body, ''))) = 0 then
    return jsonb_build_object('ok', false, 'code', 'EMPTY',
      'reason', 'A note needs some words.');
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

  insert into public.notes (app_user_id, body, project_id, trade, action_id, screen, intent)
  values (v_me, btrim(p_body), v_project, v_trade, v_action,
          nullif(btrim(coalesce(p_screen, '')), ''), v_intent)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'intent', v_intent,
    'project_id', v_project, 'trade', v_trade, 'action_id', v_action);
end $function$;

comment on function public.portal_note_add(text, uuid, text, uuid, text, text) is
'Writes one capture. Only the words are required; the job, the trade and the task are inferred from where you were standing and are dropped rather than trusted when they name something you cannot read. p_intent says what it was meant to be - a task written down with nowhere to put it comes back in the end-of-day sweep.';

-- ---------------------------------------------------------------------------
-- THE NOTEBOOK, plus the two things the sheet cannot work out for itself:
-- which jobs you may add work to, and how much is waiting for tonight's sweep.
-- Both ride along on the read the sheet already makes rather than costing
-- their own round trip.
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
              -- The sweep's own queue: still open, and nobody has looked at
              -- it today. What it was MEANT to be comes first.
              when 'sweep' then n.archived_at is null
                    and (n.reviewed_at is null or n.reviewed_at < date_trunc('day', now()))
              else n.archived_at is null end)
     order by
       case when lower(coalesce(p_show, 'open')) = 'sweep'
            then case when n.intent = 'task' then 0 else 1 end else 0 end,
       -- A sweep reads oldest first, like a day; the notebook reads newest
       -- first, like a notebook.
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
        'became', (select a.action from public.actions a where a.id = m.became_action_id)))
      from mine m), '[]'::jsonb),
    'open', (select count(*) from public.notes n
              where n.app_user_id = public.current_app_user_id() and n.archived_at is null),
    'here', (select count(*) from public.notes n
              where n.app_user_id = public.current_app_user_id() and n.archived_at is null
                and (p_project is null or n.project_id = p_project)
                and (p_trade is null or lower(n.trade) = lower(p_trade))),
    'to_sweep', (select count(*) from public.notes n
                  where n.app_user_id = public.current_app_user_id() and n.archived_at is null
                    and (n.reviewed_at is null or n.reviewed_at < date_trunc('day', now()))),
    -- THE JOBS YOU MAY ADD WORK TO. A task needs a job, and guessing which one
    -- is worse than asking. Ordered by where you are standing first, then the
    -- ones with an address, because that is what a person means by "a job".
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.project_name) order by x.ord, x.project_name)
        from (select p.id, p.project_name,
                     case when p.id = p_project then 0 when p.address is not null then 1 else 2 end as ord
                from public.projects p
               where p.trashed_at is null
                 and coalesce(p.status, '') not like 'Closed%'
                 and public.can_edit_project(p.id)
               limit 60) x), '[]'::jsonb));
$function$;

comment on function public.portal_notes(uuid, text, text, integer) is
'Your notebook, pinned first then newest - or, with p_show = sweep, the end-of-day queue: still open, nobody looked at it today, the ones meant to be tasks first and oldest first after that. Also hands back the jobs you may add work to, so the sheet can ask which one rather than guess. Returns nobody else''s notes under any seat.';

-- "Keep it" in the sweep. Not an edit, not an archive - a decision that this
-- one is still worth having, recorded so tonight's queue can empty.
create or replace function public.portal_note_reviewed(p_note uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update public.notes n set reviewed_at = now(), last_updated = now()
   where n.id = p_note and n.app_user_id = public.current_app_user_id();
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_YOURS',
      'reason', 'That note is not in your notebook.');
  end if;
  return jsonb_build_object('ok', true, 'id', p_note);
end $function$;

comment on function public.portal_note_reviewed(uuid) is
'Marks a note as gone through in today''s sweep and kept. It clears from tonight''s queue and comes back tomorrow, which is what a daily sweep is.';

-- ---------------------------------------------------------------------------
-- PROMOTION, now able to be told which job.
--
-- A note written on the home screen has no job, and the old version simply
-- refused. That is the exact note the sweep is for - "call the inspector about
-- 55 Walnut", written in the van - so it takes a job now, and the decision
-- happens at the time it is actually cheap to make.
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

  -- A task's name is one line. A note can be a paragraph, so the first line
  -- becomes the task and the whole note follows it into the description -
  -- nothing you wrote is thrown away by promoting it.
  v_text := btrim(coalesce(nullif(btrim(coalesce(p_action, '')), ''),
                           split_part(n.body, E'\n', 1)));
  if length(v_text) > 300 then v_text := left(v_text, 297) || '...'; end if;

  r := public.portal_task_quick(
    p_project => v_project,
    p_action  => v_text,
    p_trade   => n.trade,
    p_target_date => p_target_date,
    p_assignee => p_assignee);
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

comment on function public.portal_note_to_task(uuid, text, date, uuid, uuid) is
'Turns a note into a simple task on the job and trade the note was taken against, keeping the full text as the task''s outcome when the note ran longer than its first line. A note with no job of its own can be told one (p_project) - that is what the end-of-day sweep does. Idempotent: a note that has already become a task hands back that task rather than making a second one.';

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
