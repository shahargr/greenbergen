-- 169. THE FRONT DOOR SAYS WHAT WE ARE - two public reads, one data change.
--
-- Action a8d869ca (Marketing Group, "Rewrite Green Bergen Development
-- website: positioning and homepage copy"; spec agreed with Shahar
-- 2026-09-16, implemented 2026-09-17). The site is repositioned as a
-- technology company that builds homes, with one KPI: inquiries for new
-- builds and for the home available. The words live in the apps; what the
-- database adds is:
--
--   * public_company() names the project a NEW-BUILD inquiry lands on - the
--     company's own root project - so "Build with us" on the front door can
--     write a lead through about_inquire without the app carrying an id.
--   * public_showcase(slug) carries the job's target finish (required_finish)
--     so the 55 Walnut page can say when, once that date is set.
--   * The front door promotes the three at-cost community jobs Shahar named
--     (EV charger, water heater, standby generator); the other four come off
--     the front. Data, not code - Admin > Packages edits the same flag.
--
-- Both reads stay anon and read-only (rulebook 71); the inquiry path is the
-- one that existed (about_inquire -> project_inquiries -> a lead task).

do $patch$
declare src text; out_ text;
begin
  select pg_get_functiondef('public.public_company()'::regprocedure) into src;
  out_ := replace(src,
    $a$    'main_phone', c.main_phone,$a$,
    $b$    'main_phone', c.main_phone,
    'inquiry_project_id', (select p.id from projects p
                            where p.project_name = c.company_name and p.parent_project_id is null
                              and p.trashed_at is null
                            order by p.created_at limit 1),$b$);
  if out_ = src then raise exception 'public_company has drifted - the main_phone anchor was not found'; end if;
  execute out_;
end $patch$;

do $patch$
declare src text; out_ text;
begin
  select pg_get_functiondef('public.public_showcase(text)'::regprocedure) into src;
  out_ := replace(src,
    $a$      'project_id', p.id,
      'about', public.about_page(p.id),$a$,
    $b$      'project_id', p.id,
      'target_finish', p.required_finish,
      'about', public.about_page(p.id),$b$);
  if out_ = src then raise exception 'public_showcase has drifted - the about anchor was not found'; end if;
  execute out_;
end $patch$;

update public.blueprint_packages
   set promote = (code in ('ev_charger', 'water_heater', 'generator')),
       last_modified_by = 'migration 169'
 where promote is distinct from (code in ('ev_charger', 'water_heater', 'generator'));

update public.config
   set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
