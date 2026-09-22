-- ONLY A GAS JOB ASKS ABOUT GAS.
--
-- The survey belongs on the scope screen of a generator job and nowhere near
-- a paint job. Eight questions about pool heaters on a job that has nothing
-- to do with gas is how a screen teaches people to scroll past it, and the
-- one time it matters they scroll past it then too.
--
-- The flag lives on the PACKAGE rather than in the screen's head, because
-- the next gas job - a tankless water heater, a pool heater, a gas line for
-- a range - wants the same eight questions and should not need a code change
-- to get them. Today exactly one package sets it.
alter table public.blueprint_packages
  add column if not exists needs_gas_survey boolean not null default false;

comment on column public.blueprint_packages.needs_gas_survey is
  'Whether a job taken from this package asks the house what it already burns. True wherever the work adds or moves a gas load, because the meter''s capacity is the constraint the whole job turns on.';

update public.blueprint_packages set needs_gas_survey = true where code = 'generator';

-- The screen reads one function, so the answer to "should I ask this at all"
-- rides back with the survey rather than costing a second round trip.
do $mig$
declare
  src text; n int;
  a constant text := $q$      'can_survey', (select asset_id is not null from house),$q$;
  b constant text := $q$      'can_survey', (select asset_id is not null from house),
      -- Whether this job asks at all. The scope screen shows the survey step
      -- only when this is true (migration 230).
      'asked', coalesce((select bp.needs_gas_survey
                           from public.projects pr
                           join public.blueprint_packages bp on bp.code = pr.package_code
                          where pr.id = p_project), false),$q$;
begin
  src := pg_get_functiondef('public.portal_gas_survey(uuid)'::regprocedure);
  n := (length(src) - length(replace(src, a, ''))) / length(a);
  if n <> 1 then raise exception 'The can_survey line matched % times, expected 1.', n; end if;
  execute replace(src, a, b);
end $mig$;

revoke all on function public.portal_gas_survey(uuid) from public, anon;
grant execute on function public.portal_gas_survey(uuid) to authenticated, service_role;
