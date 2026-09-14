-- 112. A SEAT CAN BE TAKEN OFF THE JOB, AND EVERY SEAT HAS A NAME.
--
-- Shahar (2026-09-14), reading "Already on this job · 3" on the award screen:
-- "sg.other+2 was never added ... contractor - someone, not sure what this
-- line is. we need a way to modify the list of people on the project - remove
-- for example."
--
-- Both halves are fair.
--
-- "SOMEONE" is a seat held by an app_user with no contact row behind it -
-- project_members.app_user_id set, contact_id null. 107 read the name from
-- contacts and companies only, so anybody seated that way came back as the
-- word "Someone". A seat you cannot name is a seat you cannot act on, and
-- the name was always there - one join away, in app_users.
--
-- REMOVING. The board could put people on a job and had no way to take them
-- off, which makes every mistake permanent and is how a list stops being
-- believed. project_members already carries the honest mechanism - status
-- 'removed' and left_on, used elsewhere - so this is a governed call around
-- it rather than a new idea. Nothing is deleted: who held what, and when, is
-- the kind of fact you want to still have in a year.
--
-- What it will NOT do: remove the owner's own seat (the job would belong to
-- nobody), and it does not touch the contract. A placeholder contract with
-- no seat behind it is a loose end, not a lie, and tearing up an agreement
-- is a different decision from taking somebody off a job.

create or replace function public.portal_seat_remove(
  p_member uuid,
  p_why text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_project uuid; v_role text; v_status text; v_name text; v_contract uuid;
begin
  perform public.assert_own_hands();
  if public.current_app_user_id() is null then
    return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.');
  end if;

  select pm.project_id, pm.project_role, pm.status, pm.contract_id,
         coalesce(ct.person_name, ct.name, co.company_name, u.full_name, u.email, 'That seat')
    into v_project, v_role, v_status, v_contract, v_name
    from public.project_members pm
    left join public.contacts  ct on ct.id = pm.contact_id
    left join public.companies co on co.id = pm.company_id
    left join public.app_users u  on u.id = pm.app_user_id
   where pm.id = p_member;

  if v_project is null then
    return jsonb_build_object('ok', false, 'reason', 'That seat is not on file.');
  end if;
  if not public.can_edit_project(v_project) then
    return jsonb_build_object('ok', false, 'reason', 'Changing who is on this job is not yours to do.');
  end if;
  if v_role = 'asset owner' then
    return jsonb_build_object('ok', false, 'reason',
      'The owner''s seat cannot be taken off their own job.');
  end if;
  if v_status = 'removed' then
    return jsonb_build_object('ok', true, 'already', true, 'who', v_name,
      'note', v_name || ' was already off this job.');
  end if;

  update public.project_members
     set status = 'removed',
         left_on = current_date,
         notes = left(coalesce(notes || ' | ', '')
                 || 'Taken off the job ' || to_char(current_date, 'YYYY-MM-DD')
                 || coalesce(': ' || nullif(btrim(p_why), ''), '.'), 2000)
   where id = p_member;

  return jsonb_build_object('ok', true, 'who', v_name, 'project_id', v_project,
    'contract_id', v_contract,
    'note', v_name || ' is off this job. The record of what they held stays.');
end $fn$;

comment on function public.portal_seat_remove(uuid, text) is
  'Takes somebody off a job: project_members.status becomes removed with the date and the reason. Nothing is deleted and the contract is left alone. The owner''s own seat is refused; who may do it is can_edit_project.';

grant execute on function public.portal_seat_remove(uuid, text) to authenticated;

-- The board, now naming every seat and saying which ones can come off.
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
    -- A seat held by a login with no contact row is named from app_users -
    -- it is still a person, and "Someone" was never the answer.
    'awarded', case when not public.can_edit_project(p_project) then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
               'member_id', pm.id,
               'contact_id', pm.contact_id,
               'name', coalesce(ct.person_name, ct.name, co2.company_name, u.full_name, u.email, 'Unnamed seat'),
               'company', co.company_name,
               'seat', pm.project_role,
               'since', pm.joined_on,
               'contract_id', pm.contract_id,
               'contract', c.title,
               'contract_status', c.status,
               'may_remove', pm.project_role is distinct from 'asset owner',
               'trade', coalesce(c.trade, (select r.trade from public.contact_trade_roles r
                                            where r.contact_id = pm.contact_id limit 1)))
             order by coalesce(c.trade, 'zz'), coalesce(ct.person_name, ct.name, u.full_name, u.email))
        from public.project_members pm
        left join public.contacts ct on ct.id = pm.contact_id
        left join public.companies co on co.id = ct.company_id
        left join public.companies co2 on co2.id = pm.company_id
        left join public.app_users u on u.id = pm.app_user_id
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
  'What the award screen shows: the trades this job needs, who already holds a contract-bounded seat on it (named, and whether it can come off), and who the GC could hand work to.';

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
