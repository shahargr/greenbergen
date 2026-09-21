-- EVERY PROJECT THIS PERSON MAY SEE, WITH THE FOUR THINGS YOU SEARCH BY.
--
-- Shahar, 2026-09-20: "a search option to look for projects based on owner /
-- address / type / contractor."
--
-- portal_home's overview carries id, name, address, status, parent, domain
-- and an open count - and NEITHER an owner NOR a contractor. Two of the four
-- fields simply were not on the wire, so the search could not have been built
-- against it however the filtering was written.
--
-- SECURITY DEFINER and scoped the same way portal_project_cards is: the
-- projects you hold an active seat on, plus everything when a superadmin asks
-- for it. Names are resolved here rather than in the page so one round trip
-- answers the whole screen.
create or replace function public.portal_project_search(p_all boolean default false)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
with mine as (
  select distinct pm.project_id
    from project_members pm
   where pm.app_user_id = public.current_app_user_id()
     and pm.status = 'active'
  union
  select p.id from projects p where p_all and public.is_superadmin()
),
proj as (
  select p.* from projects p join mine m on m.project_id = p.id
   where p.trashed_at is null and not p.is_template
),
-- One owner and one contractor per project, picked deterministically so the
-- same row does not change name between two loads.
party as (
  select pm.project_id,
         min(case when pm.role = 'owner'
             then coalesce(u.full_name, c.name, u.email) end) as owner_name,
         min(case when coalesce(pm.project_role, pm.role) in
                  ('contractor','sub-contractor','sub-contractor manager',
                   'contractor manager','site GC','crew')
             then coalesce(c.name, u.full_name, u.email) end) as contractor_name
    from project_members pm
    left join app_users u on u.id = pm.app_user_id
    left join contacts  c on c.id = pm.contact_id
   where pm.status = 'active'
   group by pm.project_id
)
select coalesce((
  select jsonb_agg(jsonb_build_object(
    'id', p.id,
    'name', p.project_name,
    'address', p.address,
    -- THE TYPE, AS A PERSON WOULD SAY IT. domain is the stored vocabulary;
    -- a root with no parent and an address is a house, anything under one is
    -- a job. Derived here so the page does not re-derive it a second way.
    'type', case
              when lower(coalesce(p.domain, 'construction')) <> 'construction'
                then lower(coalesce(p.domain, 'construction'))
              when p.parent_project_id is null then 'house'
              else 'project' end,
    'status', p.status,
    'owner', pa.owner_name,
    'contractor', pa.contractor_name,
    'parent_id', p.parent_project_id
  ) order by p.project_name)
  from proj p left join party pa on pa.project_id = p.id
), '[]'::jsonb);
$$;

comment on function public.portal_project_search(boolean) is
  'Projects the caller may see, each with owner, contractor, address and type - the four fields the portal search box filters on.';

revoke all on function public.portal_project_search(boolean) from public;
grant execute on function public.portal_project_search(boolean) to authenticated;
