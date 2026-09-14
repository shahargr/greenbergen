-- 110. A JOB KNOWS WHICH TRADES IT NEEDS.
--
-- Shahar (2026-09-14), looking at the award screen on Ran's generator: "when
-- clicking award job, every job needs to have a clear list of possible trade
-- people to award. for example, generator should have electrician, plumber,
-- landscape, GC and project manager."
--
-- The screen was offering all eighty trades in one flat list, alphabetised by
-- the trades table's own order, with Stairs and Pest Control sitting at the
-- same weight as the electrician the job cannot happen without. Eighty
-- choices is not a choice.
--
-- The job already knows the answer: project_bid_needs holds what this job
-- needs, seeded from the blueprint when the job was made (for the generator:
-- Plumbing, Electrical, Handyman, the town permit, the generator itself).
-- Nothing new has to be invented - it just was not on this screen. So the
-- board hands it over and the screen leads with it.
--
-- Two additions to what gets seeded, both from the same observation:
--
--   LANDSCAPING on an equipment install. A standby generator means a pad and
--   a trench for the gas and the feeder, and the trench goes across the lawn.
--   Somebody puts the ground back. That is a trade on the job whether or not
--   anybody wrote it down, and it was missing because the seeder matches
--   words in the project's NAME against blueprint items - and nobody calls
--   the job "generator and lawn repair".
--
--   RUNNING THE JOB - General Contractor and Project manager - is not seeded
--   at all, and should not be: they are not things you put out to bid, they
--   are how the job is held. The award screen offers them in their own group
--   rather than the database pretending they are needs.

-- 1. The seeder, with the ground-restoration trade on an equipment install.
--    Unchanged otherwise.
create or replace function public.portal_bid_needs_seed(p_project uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_name text; v_subject text; v_thing text;
begin
  if not (public.can_edit_project(p_project) or public.is_superadmin()) then
    raise exception 'Not allowed to edit this project';
  end if;
  select project_name into v_name from projects where id = p_project;
  if v_name is null then raise exception 'No such project'; end if;
  v_subject := lower(regexp_replace(v_name, '^[^:]{1,20}:\s*', ''));

  with words as (
    select w from regexp_split_to_table(v_subject, '[^a-z]+') w
    where length(w) >= 5
      and w not in ('their','there','which','would','should','about','after','before',
                    'install','installing','installation','project','create','created',
                    'homeowner','through','portal','emergency','general','standard',
                    'required','system','systems','replace','replacement','repair','works')
  ),
  hits as (
    select distinct t.trade, t.sort_order,
      (select b2.item from blueprint_trade b2 join words w2 on b2.item ilike '%' || w2.w || '%'
        where b2.trade = t.trade
        order by length(b2.item) asc
        limit 1) as why
    from blueprint_trade b
    join words w on b.item ilike '%' || w.w || '%'
    join trades t on t.trade = b.trade
    where t.is_worker_trade
  )
  insert into project_bid_needs (project_id, trade, label, note, kind, sort_order, source, created_by)
  select p_project, h.trade, h.trade, left(h.why, 400), 'trade', h.sort_order, 'blueprint', 'portal_bid_needs_seed'
  from hits h
  on conflict (project_id, label) do nothing;

  insert into project_bid_needs (project_id, trade, label, note, kind, sort_order, source, created_by)
  select p_project, 'Town Official', 'Town permits',
    'Permit application, plan review, fees and inspections with the town. Not a competitive bid — it is work that has to be scheduled and paid for.',
    'permit', 900, 'blueprint', 'portal_bid_needs_seed'
  from projects p where p.id = p_project and coalesce(p.domain,'construction') = 'construction'
  on conflict (project_id, label) do nothing;

  v_thing := (select k from unnest(array['generator','boiler','furnace','water heater','heat pump',
    'air conditioner','elevator','ev charger','solar','battery','pool heater','sump pump']) k
    where v_subject like '%' || k || '%' limit 1);
  if v_thing is not null then
    insert into project_bid_needs (project_id, trade, label, note, kind, sort_order, source, created_by)
    values (p_project, 'Equipment', 'Purchase the ' || v_thing,
      'Supply of the ' || v_thing || ' itself — make, model, capacity and warranty. Priced separately from the labour so the equipment decision is never buried in a trade bid.',
      'purchase', 950, 'blueprint', 'portal_bid_needs_seed')
    on conflict (project_id, label) do nothing;

    -- The ground the equipment stands on and the trench that feeds it. Not
    -- required on every one of these - a pad on gravel behind the garage
    -- needs nobody - so it is offered, not insisted on.
    insert into project_bid_needs (project_id, trade, label, note, kind, is_required, sort_order, source, created_by)
    values (p_project, 'Landscaping', 'Landscaping',
      'Putting the ground back after the pad and the trench: the gas line and the feeder cross the lawn to get there, and somebody has to close it up.',
      'trade', false, 230, 'blueprint', 'portal_bid_needs_seed')
    on conflict (project_id, label) do nothing;
  end if;

  return public.portal_bid_needs(p_project);
end;
$fn$;

-- 2. The jobs already standing that were seeded before the rule existed.
--    Additive and removable (portal_bid_need_remove); it touches only
--    projects that already carry an equipment purchase from the seeder.
insert into public.project_bid_needs (project_id, trade, label, note, kind, is_required, sort_order, source, created_by)
select distinct n.project_id, 'Landscaping', 'Landscaping',
  'Putting the ground back after the pad and the trench: the gas line and the feeder cross the lawn to get there, and somebody has to close it up.',
  'trade', false, 230, 'blueprint', 'migration-110'
from public.project_bid_needs n
where n.kind = 'purchase'
  and n.trade = 'Equipment'
  and n.source = 'blueprint'
on conflict (project_id, label) do nothing;

-- 3. The award board carries the job's needs, so the screen can lead with
--    them instead of eighty trades in a row. Only the names: the screen puts
--    them in order against the trades table it already reads.
create or replace function public.portal_award_board(p_project uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'project_id', p_project,
    'project_name', (select project_name from public.projects where id = p_project),
    'may_award', public.can_edit_project(p_project),
    'takes_work', public.portal_task_takes_tasks(p_project),

    -- What this job needs, in the job's own words. A need with no trade
    -- against it (a purchase, a permit) is not something you award to a
    -- trade, so it does not come through here.
    'needs', case when not public.can_edit_project(p_project) then '[]'::jsonb else coalesce((
      select jsonb_agg(distinct n.trade)
        from public.project_bid_needs n
        join public.trades t on t.trade = n.trade
       where n.project_id = p_project
         and n.kind = 'trade'
         and t.is_worker_trade), '[]'::jsonb) end,

    -- Already awarded: the active contractor seats on this job, each with the
    -- contract it is bounded by. "placeholder" is the honest word for a
    -- contract with nothing agreed in it yet, and the screen says so.
    'awarded', case when not public.can_edit_project(p_project) then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
               'member_id', pm.id,
               'contact_id', pm.contact_id,
               'name', coalesce(ct.person_name, ct.name, co2.company_name, 'Someone'),
               'company', co.company_name,
               'seat', pm.project_role,
               'since', pm.joined_on,
               'contract_id', pm.contract_id,
               'contract', c.title,
               'contract_status', c.status,
               'trade', coalesce(c.trade, (select r.trade from public.contact_trade_roles r
                                            where r.contact_id = pm.contact_id limit 1)))
             order by coalesce(c.trade, 'zz'), coalesce(ct.person_name, ct.name))
        from public.project_members pm
        left join public.contacts ct on ct.id = pm.contact_id
        left join public.companies co on co.id = ct.company_id
        left join public.companies co2 on co2.id = pm.company_id
        left join public.contracts c on c.id = pm.contract_id
       where pm.project_id = p_project
         and pm.status = 'active'
         and public.seat_needs_contract(pm.project_role)), '[]'::jsonb) end,

    'people', case when not public.can_edit_project(p_project) then '[]'::jsonb else coalesce((
      select jsonb_agg(x order by x->>'name')
        from (
          select distinct jsonb_build_object(
            'contact_id', ct.id,
            'name', coalesce(ct.person_name, ct.name),
            'company', (select co.company_name from public.companies co where co.id = ct.company_id),
            'trades', coalesce((select jsonb_agg(r.trade order by r.trade)
                                  from public.contact_trade_roles r where r.contact_id = ct.id), '[]'::jsonb),
            'here', exists (select 1 from public.project_members pm
                             where pm.project_id = p_project and pm.contact_id = ct.id
                               and pm.status = 'active')) as x
            from public.contacts ct
           where ct.disabled_at is null
             and (exists (select 1 from public.project_members pm
                           join public.projects pr on pr.id = pm.project_id
                          where pm.contact_id = ct.id and pm.status = 'active'
                            and public.can_edit_project(pr.id))
               or exists (select 1 from public.transactions t
                           where t.project_id = p_project and t.contractor_id = ct.id))
        ) q), '[]'::jsonb) end
  );
$$;

comment on function public.portal_award_board(uuid) is
  'What the award screen shows: the trades this job needs, who already holds a contract-bounded seat on it, and who the GC could hand work to.';

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
