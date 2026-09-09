-- 026 - the landing page's book gets its numbers.
--
-- Shahar: "there got to be a book of projects completed and in flight. The
-- houses built, and over time jobs completed." The houses were already in
-- public_company() - projects with a public_slug, built or in flight, with
-- their hero photos - and nobody signed in ever saw them, because the landing
-- page sent every signed-in visitor straight past itself. That is fixed in
-- the app. What was missing is the tally: how many houses, how many jobs.
--
-- EXTENDED, NOT DUPLICATED (rulebook 30): public_company() is the one
-- anon-safe view of Green Bergen and the landing page already calls it, so
-- the tally rides in the same payload. Four counts, all aggregates, nothing
-- about any one person or address that the page did not already show:
--
--   houses_built     public projects marked completed
--   houses_in_flight public projects not yet completed
--   jobs_done        homeowner bookings that reached done
--   jobs_in_flight   bookings posted or accepted and not yet closed
--
-- jobs_done is the number that grows over time and the one worth watching.
-- Today it is zero, and the page says so plainly rather than hiding the row.
create or replace function public.public_company()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'company_name', c.company_name,
    'main_phone', c.main_phone,
    'projects', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'project_name', p.project_name, 'address', p.address,
        'status', p.status, 'public_slug', p.public_slug,
        'hero_photo_url', a.hero_photo_url) order by p.project_name), '[]'::jsonb)
      from projects p
      left join project_about_pages a on a.project_id = p.id
      where p.public_slug is not null and not p.public_completed
    ),
    'completed', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'project_name', p.project_name, 'address', p.address,
        'public_slug', p.public_slug,
        'hero_photo_url', a.hero_photo_url) order by p.project_name), '[]'::jsonb)
      from projects p
      left join project_about_pages a on a.project_id = p.id
      where p.public_completed
    ),
    'showcase', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'project_name', p.project_name, 'address', p.address,
        'status', p.status, 'public_slug', p.public_slug,
        'completed', p.public_completed,
        'hero_photo_url', a.hero_photo_url)
        order by p.public_completed, p.project_name), '[]'::jsonb)
      from projects p
      left join project_about_pages a on a.project_id = p.id
      where p.showcase
    ),
    'tally', jsonb_build_object(
      'houses_built',     (select count(*) from projects p where p.public_completed),
      'houses_in_flight', (select count(*) from projects p where p.public_slug is not null and not p.public_completed),
      'jobs_done',        (select count(*) from project_bookings b where b.state = 'done' or b.done_at is not null),
      'jobs_in_flight',   (select count(*) from project_bookings b where b.state in ('posted','accepted'))
    )
  )
  from companies c where c.company_name = 'Green Bergen Development';
$function$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
