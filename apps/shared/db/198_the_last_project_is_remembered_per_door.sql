-- 198: remembered per DOOR, because a seat is not a person.
--
-- Shahar (2026-09-19), after switching from homeowner to Professionals and
-- landing on the front page: "didn't we said that we will land on the last
-- page we were on in this seat?"
--
-- He was right about the intent and the shape was wrong. Migration 194
-- recorded ONE last project per person. Switching doors then had two bad
-- answers and no good one: send them to the last project whatever door it
-- was opened in - which can drop a homeowner's own house into the
-- Professionals app, where it means nothing - or ignore the memory, which is
-- what the switcher did. "In this seat" is the missing half.
--
-- THE SAME VOCABULARY AS app_users.default_door: homeowner / expert /
-- portal. The portal calls its own door 'admin' and the column has always
-- spelled it 'portal'; readDoors() already translates at the edge, and one
-- more spelling in the database would be a third thing to keep in step.
--
-- THE OLD SIGNATURES ARE DROPPED rather than left beside the new ones. Both
-- functions were added earlier today and nothing deployed calls them - the
-- code that does is still on a branch - so there is no compatibility to
-- keep, and two versions of one rule is how the two start disagreeing
-- (rulebook 30).

alter table public.user_project_prefs
  add column if not exists last_door text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_user_project_prefs_last_door') then
    alter table public.user_project_prefs
      add constraint chk_user_project_prefs_last_door
      check (last_door is null or last_door in ('homeowner', 'expert', 'portal'));
  end if;
end $$;

comment on column public.user_project_prefs.last_door is
  'Which door this project was last opened through - homeowner / expert / portal, the same vocabulary as app_users.default_door. NULL on a stamp written before migration 198, which my_last_project() treats as "not this door" rather than guessing.';

drop index if exists idx_user_project_prefs_last_opened;
create index if not exists idx_user_project_prefs_last_opened
  on public.user_project_prefs (app_user_id, last_door, last_opened_at desc)
  where last_opened_at is not null;

drop function if exists public.mark_project_opened(uuid);
drop function if exists public.my_last_project();

create or replace function public.mark_project_opened(p_project uuid, p_door text default null)
returns void
language sql
set search_path to 'public'
as $fn$
  insert into public.user_project_prefs (app_user_id, project_id, last_opened_at, last_door, updated_at)
  select public.current_app_user_id(), p_project, clock_timestamp(),
         nullif(p_door, ''), now()
   where public.current_app_user_id() is not null
     and p_project is not null
     and (p_door is null or p_door in ('homeowner', 'expert', 'portal'))
     and public.is_project_member(p_project)
  on conflict (app_user_id, project_id) do update
     set last_opened_at = clock_timestamp(),
         last_door = coalesce(nullif(excluded.last_door, ''), public.user_project_prefs.last_door);
$fn$;

comment on function public.mark_project_opened(uuid, text) is
  'Stamp that I have just opened this project, and through which door. Silently does nothing when I hold no seat on it, or when the door is not one of the three. An unknown door does not erase the one already recorded - a caller that forgets to say which door should lose nothing.';

create or replace function public.my_last_project(p_door text default null)
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
     and (p_door is null or up.last_door = p_door)
     and p.trashed_at is null
     and p.archived_at is null
     and p.disabled_at is null
   order by up.last_opened_at desc, up.project_id desc
   limit 1;
$fn$;

comment on function public.my_last_project(text) is
  'The project I last opened through this door and can still see, or null. Called with no door it answers across all of them, which is what a plain sign-in wants. A CLOSED project is deliberately still returned - the honest answer to "put me back where I was" is where I was, and one tap leaves it - while trashed, archived and disabled ones are not: those are gone rather than finished.';

revoke all on function public.mark_project_opened(uuid, text) from public;
revoke all on function public.my_last_project(text) from public;
grant execute on function public.mark_project_opened(uuid, text) to authenticated, service_role;
grant execute on function public.my_last_project(text) to authenticated, service_role;

update public.config set schema_version = 467, schema_updated_at = current_date;
