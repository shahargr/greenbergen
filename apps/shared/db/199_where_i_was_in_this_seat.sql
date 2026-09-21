-- 199: where I was, per seat - the PAGE, not the project.
--
-- Shahar (2026-09-20): "can you maintain my last logged in page as a user,
-- so next time i log in i can land on that particular page, inside a
-- project? have a last page visit per seat so i can jump between tablet,
-- mobile and desktop... or when i change my seat i can go back where i was
-- before."
--
-- WHY A NEW TABLE (rulebook 30 asks the question, so here is the sentence).
-- user_project_prefs is keyed PER PROJECT - it holds the pin and, since 194,
-- the last time each project was opened. This is keyed PER DOOR: one row per
-- person per seat, holding one path. Different grain, different lifetime,
-- and most of the paths worth remembering are not project pages at all -
-- /work, /packages, the inbox. Bolting a path onto a per-project row would
-- mean no row at all for those.
--
-- I ARGUED AGAINST STORING A PATH EARLIER TODAY and the objection was real:
-- a stored route points at screens that get renamed and at projects somebody
-- may have been removed from since. It is answered by validating on the way
-- out rather than trusting on the way in - the read below re-checks the
-- project through RLS, and a path whose project is gone returns nothing.
-- Shape is checked on the way in as well: a stored path is a redirect
-- target, so "//evil.example" must never survive being written.

create table if not exists public.user_seat_places (
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  door        text not null,
  path        text not null,
  -- Set when the path is inside a project, so the read can re-check the seat.
  -- Null for the pages that belong to no project.
  project_id  uuid references public.projects(id) on delete cascade,
  seen_at     timestamptz not null default now(),
  primary key (app_user_id, door),
  constraint chk_user_seat_places_door check (door in ('homeowner', 'expert', 'portal')),
  constraint chk_user_seat_places_path check (path ~ '^/[^/\s]' and length(path) <= 512)
);

comment on table public.user_seat_places is
  'Where each person was last standing in each seat - one row per person per door, holding the path. Read by the sign-in landing and the door switcher so a seat reopens where it was left, on any device. Separate from user_project_prefs, which is per PROJECT and holds the pin: this is per DOOR and most of what it remembers is not a project page at all.';

alter table public.user_seat_places enable row level security;

drop policy if exists "own places" on public.user_seat_places;
create policy "own places" on public.user_seat_places
  for all using (app_user_id = public.current_app_user_id())
  with check (app_user_id = public.current_app_user_id());

-- SECURITY INVOKER throughout (rulebook 71): the policy above decides the
-- write, and the join to projects decides the read. Neither needs a hole.

create or replace function public.remember_place(p_door text, p_path text, p_project uuid default null)
returns void
language sql
set search_path to 'public'
as $fn$
  insert into public.user_seat_places (app_user_id, door, path, project_id, seen_at)
  select public.current_app_user_id(), p_door, p_path, p_project, now()
   where public.current_app_user_id() is not null
     and p_door in ('homeowner', 'expert', 'portal')
     -- One leading slash and no whitespace: a stored path is a redirect
     -- target, and "//evil.example" is a different origin.
     and p_path ~ '^/[^/\s]'
     and length(p_path) <= 512
     and (p_project is null or public.is_project_member(p_project))
  on conflict (app_user_id, door) do update
     set path = excluded.path, project_id = excluded.project_id, seen_at = now();
$fn$;

comment on function public.remember_place(text, text, uuid) is
  'Record where I am standing in this seat. Silently does nothing on an unknown door, a path that is not a single-slash relative path, or a project I hold no seat on - a bad stamp must never be able to become a redirect.';

create or replace function public.my_last_place(p_door text)
returns text
language sql
stable
set search_path to 'public'
as $fn$
  select sp.path
    from public.user_seat_places sp
   where sp.app_user_id = public.current_app_user_id()
     and sp.door = p_door
     -- A project page is only offered back while the seat and the project
     -- both still stand. RLS on projects does the checking.
     and (sp.project_id is null or exists (
           select 1 from public.projects p
            where p.id = sp.project_id
              and p.trashed_at is null and p.archived_at is null and p.disabled_at is null))
   limit 1;
$fn$;

comment on function public.my_last_place(text) is
  'The path I was last on in this seat, or null. Null is the honest answer when the project behind it is gone or my seat on it was revoked - the caller then falls back to the door''s own entry.';

create or replace function public.my_last_places()
returns jsonb
language sql
stable
set search_path to 'public'
as $fn$
  select jsonb_object_agg(d.door, public.my_last_place(d.door))
    from (values ('homeowner'), ('expert'), ('portal')) as d(door);
$fn$;

comment on function public.my_last_places() is
  'Every seat''s last place in one read, for the door switcher - it has to build three links at once and a call per door would be three round trips on a menu tap.';

revoke all on function public.remember_place(text, text, uuid) from public;
revoke all on function public.my_last_place(text) from public;
revoke all on function public.my_last_places() from public;
grant execute on function public.remember_place(text, text, uuid) to authenticated, service_role;
grant execute on function public.my_last_place(text) to authenticated, service_role;
grant execute on function public.my_last_places() to authenticated, service_role;

update public.config set schema_version = 468, schema_updated_at = current_date;
