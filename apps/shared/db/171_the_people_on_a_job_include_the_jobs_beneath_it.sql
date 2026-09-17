-- 171: THE PEOPLE ON A JOB INCLUDE THE JOBS BENEATH IT; A BACKFILLED STEP
--      KEEPS ITS PLACE.
--
-- Shahar (2026-09-17), on the Note sheet with 55 Walnut Drive chosen: "default
-- is me - good, but there is only one name on the drop down, makes no sense."
--
-- It made no sense because the list was honest about the wrong thing.
-- portal_compose_targets listed the SEATS ON THAT ROW, and the only seat on
-- the property is his. The plumber, the mason, the framers all sit one level
-- down, on the New build job - as seats there, or as parties to a contract
-- there with no seat at all. A task can be held by any of them (rulebook 12:
-- a holder is a contact), so the list has to reach them.
--
-- Two functions read the same way and both now look DOWN as well as up:
--   * portal_compose_targets: for each project you hold a seat on, the people
--     are the seats on it and on every project beneath it, plus the parties
--     to the contracts you can see there. You come first, then by rank.
--   * portal_project_phone_book: the family is ancestors AND descendants, so
--     the property's phone book has the trades on its jobs.
--
-- And one thing 170 turned up: fn_blueprint_step_backfill wrote the new
-- Delivery step under the three open Stairs packages with no step_order, no
-- action_type and none of the step's other columns - only the expansion
-- trigger copied them. The backfill now writes what the expansion writes,
-- and the three rows are put in their place.

-- ---------------------------------------------------------------------------
-- The backfill writes the whole step.
create or replace function public.fn_blueprint_step_backfill()
returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  -- A new step on an activity blueprint reaches every action of that type
  -- still IN FLIGHT. The parent is never modified; a new CHILD appears
  -- beneath it. Closed parents are historical record and are skipped.
  insert into public.actions (
    action, status, priority, domain, project_id, engagement_id,
    parent_action_id, assigned_to, assigned_by, depth_level,
    source, created_by, notes,
    step_order, action_type, hidden_from_trades, is_gate, cadence, trade, contract_id
  )
  select new.step_name,
         'Not Started',
         coalesce(p.priority, 'Missing'),
         p.domain,
         p.project_id,
         p.engagement_id,
         p.id,
         new.default_assigned_to,
         p.assigned_to,
         least(coalesce(p.depth_level, 2) + 1, 5),
         'system:blueprint',
         'system:blueprint',
         new.notes,
         new.step_order,
         new.action_type,
         coalesce(new.hidden_from_trades, false),
         coalesce(new.is_gate, false),
         coalesce(new.cadence, 'one-time'),
         p.trade,
         p.contract_id
    from public.actions p
   where p.activity_blueprint_id = new.activity_blueprint_id
     and p.status not in ('Completed', 'Cancelled', 'Force Cancelled')
     and not exists (select 1 from public.actions c
                      where c.parent_action_id = p.id and c.action = new.step_name);
  return new;
end $$;

-- The three Delivery rows 170 wrote, put in their place.
update public.actions c
   set step_order = s.step_order,
       action_type = coalesce(c.action_type, s.action_type),
       trade = coalesce(c.trade, p.trade),
       contract_id = coalesce(c.contract_id, p.contract_id)
  from public.actions p
  join public.blueprint_activity_steps s on s.activity_blueprint_id = p.activity_blueprint_id
 where c.parent_action_id = p.id
   and c.action = s.step_name
   and c.step_order is null
   and c.source = 'system:blueprint';

-- ---------------------------------------------------------------------------
-- WHO CAN HOLD A TASK ON A PROJECT: the seats on it and beneath it, and the
-- parties to its contracts.
create or replace function public.portal_compose_targets()
returns jsonb
language sql stable security definer set search_path = public as $$
  with me as (
    select u.id as app_user_id, u.contact_id
      from public.app_users u where u.id = public.current_app_user_id()
  ),
  my_projects as (
    select distinct p.id, p.project_name
      from me, public.project_members pm
      join public.projects p on p.id = pm.project_id
     where pm.status = 'active'
       and (pm.app_user_id = me.app_user_id
            or (pm.app_user_id is null and pm.contact_id = me.contact_id))
       and p.trashed_at is null and not p.is_template
  ),
  fam as (
    select q.id as root_id, d.id as project_id
      from my_projects q, public.project_ancestry_down(q.id) d
  ),
  seats as (
    select f.root_id as project_id,
           c.id as contact_id,
           coalesce(c.person_name, c.name) as name,
           (array_agg(coalesce(pm2.project_role, pm2.role)
                      order by (pm2.project_id = f.root_id) desc, coalesce(pr.authority_rank, 0) desc))[1] as seat,
           max(coalesce(pr.authority_rank, 0)) as rank
      from fam f
      join public.project_members pm2 on pm2.project_id = f.project_id and pm2.status = 'active'
      left join public.project_roles pr on pr.role = pm2.project_role
      join public.contacts c
        on c.id = coalesce(pm2.contact_id,
                           (select u3.contact_id from public.app_users u3 where u3.id = pm2.app_user_id))
     where c.disabled_at is null
     group by f.root_id, c.id, coalesce(c.person_name, c.name)
  ),
  parties as (
    select f.root_id as project_id,
           c.id as contact_id,
           coalesce(c.person_name, c.name) as name,
           min(ct.trade) as seat,
           0 as rank
      from fam f
      join public.contracts ct on ct.project_id = f.project_id
      cross join lateral (values (ct.contractor_id), (ct.counterparty_contact_id)) x(contact_id)
      join public.contacts c on c.id = x.contact_id and c.disabled_at is null
     where lower(coalesce(ct.status, '')) not in ('cancelled', 'void', 'placeholder')
       and public.can_see_contract(ct.id)
     group by f.root_id, c.id, coalesce(c.person_name, c.name)
  ),
  people as (
    select * from seats
    union all
    select p.* from parties p
     where not exists (select 1 from seats s where s.project_id = p.project_id and s.contact_id = p.contact_id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'project_id', q.id,
    'project_name', q.project_name,
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
               'contact_id', s.contact_id, 'name', s.name, 'seat', s.seat, 'rank', s.rank,
               'me', (s.contact_id = (select contact_id from me)))
             order by (s.contact_id = (select contact_id from me)) desc, s.rank desc, s.name)
        from people s where s.project_id = q.id), '[]'::jsonb)
  ) order by q.project_name), '[]'::jsonb)
  from my_projects q;
$$;

-- ---------------------------------------------------------------------------
-- The phone book's family runs down as well as up.
do $patch$
declare src text; out_ text;
begin
  src := pg_get_functiondef('public.portal_project_phone_book(uuid)'::regprocedure);
  out_ := replace(src,
    E'  with fam as (\n    select project_id as id from public.project_ancestry(p_project)\n    union select p_project\n  ),',
    E'  with fam as (\n    select project_id as id from public.project_ancestry(p_project)\n    union select p_project\n    union select id from public.project_ancestry_down(p_project)\n  ),');
  if out_ = src then raise exception 'portal_project_phone_book has drifted - fam CTE not found'; end if;
  execute out_;
end $patch$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
