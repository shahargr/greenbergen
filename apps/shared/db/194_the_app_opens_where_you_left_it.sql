-- 194: the app opens where you left it.
--
-- WHAT WAS MISSING. /after-login remembered the DOOR (app_users.default_door)
-- and nothing inside it, so every sign-in landed on a list - /pro/work,
-- /home/project, /my - however deep in a job you were when you last closed
-- the tab.
--
-- WHY A STAMP AND NOT A DERIVED NUMBER. Rulebook 34 prefers a figure that
-- FALLS OUT of data something else already forces to be accurate, and the
-- obvious candidate was change_events, which admin_usage_stats() already
-- reads. It cannot answer this: change_events records WRITES. Opening a
-- project and reading it leaves no row, so the very person this is for - a
-- contractor who signs in to look at the week and types nothing - derives to
-- nothing at all. Section 34's own test fails here, so the fact is stored.
-- It is not the hygiene field that section warns about either: no human has
-- to remember to move it, the app writes it on navigation.
--
-- NO NEW TABLE (rulebook 30). user_project_prefs already models exactly this
-- pair - one row per person per project, primary key on the pair - and
-- carried is_priority, the pin that floats a tile to the top of /my. A second
-- table keyed the same way is the duplication that section exists to prevent.
--
-- NOT LOGGED, deliberately (rulebook 33). This column is written on every
-- project open; logging it would bury change_events under navigation noise
-- for a fact nobody will ever audit. The same exclusion as app_sessions:
-- churn by design.

alter table public.user_project_prefs
  add column if not exists last_opened_at timestamptz;

comment on column public.user_project_prefs.last_opened_at is
  'When this person last OPENED this project (migration 194). Written by mark_project_opened() as the app navigates, read by my_last_project() so a sign-in lands back where it left off. Not an audit trail, and deliberately not logged - churn by design.';

create index if not exists idx_user_project_prefs_last_opened
  on public.user_project_prefs (app_user_id, last_opened_at desc)
  where last_opened_at is not null;

-- BOTH FUNCTIONS ARE SECURITY INVOKER, on purpose. Rulebook 71: a SECURITY
-- DEFINER function is a hole punched through RLS, and neither of these needs
-- one. The read joins user_project_prefs (policy: own prefs) to projects, so
-- a project whose membership was revoked simply stops joining and the landing
-- falls back to the door. Re-authorisation on read is structural here rather
-- than something a future edit has to remember.

create or replace function public.mark_project_opened(p_project uuid)
returns void
language sql
set search_path to 'public'
as $fn$
  insert into public.user_project_prefs (app_user_id, project_id, last_opened_at, updated_at)
  select public.current_app_user_id(), p_project, now(), now()
   where public.current_app_user_id() is not null
     and p_project is not null
     and public.is_project_member(p_project)
  on conflict (app_user_id, project_id) do update set last_opened_at = now();
$fn$;

comment on function public.mark_project_opened(uuid) is
  'Stamp that I have just opened this project. Silently does nothing when I hold no seat on it - a stamp on a project I cannot see would only mask the real one, since my_last_project() is RLS-bound and would skip it. updated_at is touched only when the row is created: opening a project is not a change to the pin.';

create or replace function public.my_last_project()
returns uuid
language sql
stable
set search_path to 'public'
as $fn$
  select p.id
    from public.user_project_prefs up
    join public.projects p on p.id = up.project_id
   where up.app_user_id = public.current_app_user_id()
     and up.last_opened_at is not null
     and p.trashed_at is null
     and p.archived_at is null
     and p.disabled_at is null
   order by up.last_opened_at desc
   limit 1;
$fn$;

comment on function public.my_last_project() is
  'The project I last opened and can still see, or null. A CLOSED project is deliberately still returned: the honest answer to "put me back where I was" is where I was, and one tap leaves it. Trashed, archived and disabled projects are not - those are gone rather than finished.';

revoke all on function public.mark_project_opened(uuid) from public;
revoke all on function public.my_last_project() from public;
grant execute on function public.mark_project_opened(uuid) to authenticated, service_role;
grant execute on function public.my_last_project() to authenticated, service_role;

update public.config
   set schema_version = 462,
       schema_updated_at = current_date,
       release_notes = 'v462 (repo 194) - The app opens where you left it. user_project_prefs.last_opened_at is stamped by mark_project_opened() as the apps navigate; my_last_project() reads the most recent one still visible, and /after-login sends a sign-in to that project inside whichever door it resolved rather than to the door''s list. Both functions are SECURITY INVOKER so a revoked seat falls back to the door on its own.';
