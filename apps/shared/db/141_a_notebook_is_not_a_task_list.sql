-- 141. A NOTEBOOK IS NOT A TASK LIST.
--
-- Shahar (2026-09-15): "what i am missing as a contractor or even a home
-- owner, is a list of things i'd like to get back to later on. like a
-- notebook. with many notes on every trade engagement and project phase.
-- something that would float on every screen allowing me to take a note. i
-- would like to go back to notes as needed, and in some cases turn them into
-- tasks, a thing that needs to be done."
--
-- A task has a holder, a date, a status ladder and an audience. A note has
-- none of those, and that is the whole point: the moment writing something
-- down costs you a decision about who owns it and when it is due, you stop
-- writing things down. "Ask Javier whether the LVL needs a third jack stud"
-- is not work yet. It might become work. Most of it will not.
--
-- THREE PROPERTIES DECIDE THE DESIGN.
--
-- It is PRIVATE. A note is yours alone - no seat, no rank, no project
-- membership opens it. That is what makes it safe to write in, and it is
-- enforced by a row policy rather than by the screen that wrote it. A
-- superadmin does not read these either.
--
-- It REMEMBERS WHERE YOU WERE STANDING. "Notes on every trade engagement and
-- project phase" does not mean filing each one by hand; it means the notebook
-- catches the job, the trade and the task you were looking at when you opened
-- it. A note taken inside Framing on New build is a Framing note without
-- anybody saying so.
--
-- It can BECOME work, once. Promotion is the one-way door between the two
-- kinds of thing: the note keeps the id of the task it became, so going back
-- through the notebook never asks you the same question twice.
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  body text not null,
  -- Where you were standing. All three are optional - a note taken on the
  -- home screen is still a note - and all three go soft rather than taking
  -- the note with them if the thing they point at is deleted.
  project_id uuid references public.projects(id) on delete set null,
  trade text references public.trades(trade) on delete set null,
  action_id uuid references public.actions(id) on delete set null,
  screen text,
  pinned boolean not null default false,
  -- The task it became, if it became one.
  became_action_id uuid references public.actions(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  last_updated timestamptz not null default now(),
  constraint chk_notes_body_said_something check (length(btrim(body)) > 0)
);

comment on table public.notes is
'A private notebook, one row per note (migration 141). Not a task: no holder, no date, no status - a note is a thought with a place, and the place is whatever screen it was written on. Readable and writable only by its author, including against a superadmin. A note can be promoted to a task exactly once, and keeps the id of the task it became.';

comment on column public.notes.screen is
'The path the note was written on, so "take me back to where I wrote this" is answerable. It is a route, never a secret - nothing about the note depends on it resolving.';

create index if not exists idx_notes_mine on public.notes (app_user_id, archived_at, created_at desc);
create index if not exists idx_notes_project on public.notes (project_id) where project_id is not null;

alter table public.notes enable row level security;

-- YOURS ALONE, and said once, here, rather than in five screens.
drop policy if exists note_is_mine on public.notes;
create policy note_is_mine on public.notes
  for all
  using (app_user_id = public.current_app_user_id())
  with check (app_user_id = public.current_app_user_id());

-- ---------------------------------------------------------------------------
-- WRITING ONE DOWN. Everything except the words is optional, and what is not
-- given is worked out from what is: a note taken on a task knows the task's
-- job and the task's trade without being told either.
create or replace function public.portal_note_add(
  p_body text,
  p_project uuid default null,
  p_trade text default null,
  p_action uuid default null,
  p_screen text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_me uuid; v_project uuid; v_trade text; v_action uuid; v_id uuid;
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

  -- The job. Same rule: it is filed against a job you are on, or against no
  -- job at all - the note survives either way.
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

  insert into public.notes (app_user_id, body, project_id, trade, action_id, screen)
  values (v_me, btrim(p_body), v_project, v_trade, v_action, nullif(btrim(coalesce(p_screen, '')), ''))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id,
    'project_id', v_project, 'trade', v_trade, 'action_id', v_action);
end $function$;

comment on function public.portal_note_add(text, uuid, text, uuid, text) is
'Writes one note. Only the words are required; the job, the trade and the task are inferred from where you were standing and are dropped rather than trusted when they name something you cannot read.';

-- ---------------------------------------------------------------------------
-- GOING BACK THROUGH THEM. Pinned first, then newest - which is how a
-- notebook actually reads: the two things you keep meaning to deal with, then
-- the pile.
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
              else n.archived_at is null end)
     order by n.pinned desc, n.created_at desc
     limit greatest(coalesce(p_limit, 200), 0)
  )
  select jsonb_build_object(
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'body', m.body,
        'project_id', m.project_id,
        'project', (select p.project_name from public.projects p where p.id = m.project_id),
        'trade', m.trade,
        'action_id', m.action_id,
        'task', (select a.action from public.actions a where a.id = m.action_id),
        'screen', m.screen,
        'pinned', m.pinned,
        'created_at', m.created_at,
        'archived', m.archived_at is not null,
        'became_action_id', m.became_action_id,
        'became', (select a.action from public.actions a where a.id = m.became_action_id))
        order by m.pinned desc, m.created_at desc)
      from mine m), '[]'::jsonb),
    -- The counts the floating button wears, so it can say how much is waiting
    -- without the sheet being opened.
    'open', (select count(*) from public.notes n
              where n.app_user_id = public.current_app_user_id() and n.archived_at is null),
    'here', (select count(*) from public.notes n
              where n.app_user_id = public.current_app_user_id() and n.archived_at is null
                and (p_project is null or n.project_id = p_project)
                and (p_trade is null or lower(n.trade) = lower(p_trade))));
$function$;

comment on function public.portal_notes(uuid, text, text, integer) is
'Your notebook, pinned first then newest. Optionally narrowed to one job or one trade - which is how the sheet opens where you are standing. Returns nobody else''s notes under any seat.';

create or replace function public.portal_note_edit(
  p_note uuid, p_body text default null, p_pinned boolean default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_me uuid;
begin
  v_me := public.current_app_user_id();
  if p_body is not null and length(btrim(p_body)) = 0 then
    return jsonb_build_object('ok', false, 'code', 'EMPTY',
      'reason', 'A note needs some words. Put it away instead of emptying it.');
  end if;

  update public.notes n
     set body = coalesce(nullif(btrim(coalesce(p_body, '')), ''), n.body),
         pinned = coalesce(p_pinned, n.pinned),
         last_updated = now()
   where n.id = p_note and n.app_user_id = v_me;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_YOURS',
      'reason', 'That note is not in your notebook.');
  end if;
  return jsonb_build_object('ok', true, 'id', p_note);
end $function$;

-- Putting one away is not deleting it. A notebook you cannot look back
-- through is a scratchpad.
create or replace function public.portal_note_archive(
  p_note uuid, p_undo boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update public.notes n
     set archived_at = case when coalesce(p_undo, false) then null else now() end,
         last_updated = now()
   where n.id = p_note and n.app_user_id = public.current_app_user_id();
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_YOURS',
      'reason', 'That note is not in your notebook.');
  end if;
  return jsonb_build_object('ok', true, 'id', p_note, 'archived', not coalesce(p_undo, false));
end $function$;

-- ---------------------------------------------------------------------------
-- "AND IN SOME CASES TURN THEM INTO TASKS."
--
-- The one-way door. It writes a SIMPLE task (migration 137) - one line, no
-- steps beneath it - because that is what a note is: if it turns out to need
-- a scope, a contract and four steps, it wants the wizard, not a promotion.
-- The job and the trade come from where the note was taken, so a Framing note
-- on New build becomes a Framing task on New build without being asked
-- anything. The note is then put away and keeps the task's id, so the
-- notebook never offers to promote the same thought twice.
create or replace function public.portal_note_to_task(
  p_note uuid,
  p_action text default null,
  p_target_date date default null,
  p_assignee uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n public.notes; r jsonb; v_text text;
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
  if n.project_id is null then
    return jsonb_build_object('ok', false, 'code', 'NO_PROJECT',
      'reason', 'This note is not against a job, so there is nowhere to put the task. Open the job and try from there.');
  end if;

  -- A task's name is one line. A note can be a paragraph, so the first line
  -- becomes the task and the whole note follows it into the description -
  -- nothing you wrote is thrown away by promoting it.
  v_text := btrim(coalesce(nullif(btrim(coalesce(p_action, '')), ''),
                           split_part(n.body, E'\n', 1)));
  if length(v_text) > 300 then v_text := left(v_text, 297) || '...'; end if;

  r := public.portal_task_quick(
    p_project => n.project_id,
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
         archived_at = coalesce(archived_at, now()),
         last_updated = now()
   where id = p_note;

  return r || jsonb_build_object('note', p_note, 'existed', false);
end $function$;

comment on function public.portal_note_to_task(uuid, text, date, uuid) is
'Turns a note into a simple task on the job and trade the note was taken against, keeping the full text as the task''s outcome when the note ran longer than its first line. Idempotent: a note that has already become a task hands back that task rather than making a second one.';

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
