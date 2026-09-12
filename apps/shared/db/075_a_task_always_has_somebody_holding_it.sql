-- 075 - a task always has somebody holding it.
--
-- Shahar (2026-09-12): "the assigned to should be the PM if there is one, or
-- the GC if there isn't one, or project owner. assigned to should not be empty
-- (this can be updated in the database as a trigger - who ever create the task
-- should automatically assign the project owner, the PM or the GC pending on
-- task type. If someone order a job - turn key solution, that owner should be
-- set to system, allowing the system to progress the tasks till it is closed."
--
-- 312 open tasks had nobody on them. "Unassigned" is not a state of the world,
-- it is a gap in the record: somebody is responsible for every one of those,
-- and leaving the field empty only means the app cannot say who.
--
-- THE LADDER, and it is the authority ladder the whole system already runs on
-- (project_roles.authority_rank), read at the task's project and then up
-- through its parents, because a job's people usually sit on the house:
--
--   site project manager (50)   day-to-day - the default owner of work
--   site GC (60)                when nobody is managing the site
--   asset owner (70)            when nobody is running it at all
--
-- ...except a TURN-KEY package job, which Green Bergen runs, not a person:
-- those go to the system contact so the system can walk them to closed.
-- A DIY package (booking state 'planned') is the owner's own work and takes
-- the ladder like everything else.
--
-- It is a BEFORE INSERT trigger, so it holds however the row arrives - the
-- apps, a blueprint expansion, a function, an import - and it never overrides
-- an assignment somebody made.

-- THE SYSTEM, as a contact. Everything in this database that acts hangs off a
-- contact, so the system needs one to hold a task.
insert into public.contacts (name, person_name, created_by)
select 'Green Bergen', 'Green Bergen', 'system'
 where not exists (
   select 1 from public.contacts c
    where c.created_by = 'system' and lower(coalesce(c.person_name, c.name)) = 'green bergen');

create or replace function public.system_contact_id()
returns uuid
language sql stable set search_path to 'public'
as $$
  select c.id from public.contacts c
   where c.created_by = 'system' and lower(coalesce(c.person_name, c.name)) = 'green bergen'
   order by c.created_at limit 1
$$;

-- WHO HOLDS WORK ON THIS PROJECT. One answer, used by the trigger and by
-- anything else that needs it, so the rule lives in one place.
create or replace function public.project_default_assignee(p_project uuid)
returns uuid
language plpgsql stable set search_path to 'public'
as $$
declare
  v_turnkey boolean;
  v_who uuid;
begin
  if p_project is null then return null; end if;

  -- A job somebody ORDERED from us, turn-key: ours to run. A DIY plan is the
  -- owner's own work and falls through to the ladder.
  select exists (
    select 1 from public.project_bookings b
     where b.project_id = p_project and coalesce(b.state, '') <> 'planned'
  ) into v_turnkey;
  if v_turnkey then return public.system_contact_id(); end if;

  -- The ladder, at this project and then up through its parents: a job's
  -- people usually sit on the house above it.
  with recursive up as (
    select p.id, p.parent_project_id, 0 as depth
      from public.projects p where p.id = p_project
    union all
    select p.id, p.parent_project_id, up.depth + 1
      from public.projects p join up on p.id = up.parent_project_id
     where up.depth < 8
  )
  select pm.contact_id into v_who
    from up
    join public.project_members pm on pm.project_id = up.id
   where pm.status = 'active' and pm.contact_id is not null
     and coalesce(pm.project_role, pm.role) in ('site project manager', 'site GC', 'asset owner')
   order by up.depth,
            case coalesce(pm.project_role, pm.role)
              when 'site project manager' then 1
              when 'site GC' then 2
              else 3
            end
   limit 1;

  return v_who;
end $$;

-- THE TRIGGER. Never overrides a real assignment; only fills the hole.
create or replace function public.fn_actions_default_assignee()
returns trigger
language plpgsql security definer set search_path to 'public'
as $$
begin
  -- BOTH must be empty. A task can be held by a CONTACT or by a PERSONA and
  -- never both (chk_assigned_to_one_owner), and 160 open tasks are already
  -- held by a persona - filling the contact in beside one would break the
  -- row. Persona-held tasks are assigned; the screens simply do not draw them
  -- yet, which is a different bug.
  if new.assigned_to_contact_id is null and new.assigned_to_persona_id is null
     and new.project_id is not null then
    new.assigned_to_contact_id := public.project_default_assignee(new.project_id);
  end if;
  return new;
end $$;

drop trigger if exists trg_actions_default_assignee on public.actions;
create trigger trg_actions_default_assignee
  before insert on public.actions
  for each row execute function public.fn_actions_default_assignee();

-- AND THE 312 ALREADY OPEN. Closed ones are history and are left alone -
-- writing a name onto a finished record would be inventing it.
update public.actions a
   set assigned_to_contact_id = public.project_default_assignee(a.project_id)
 where a.assigned_to_contact_id is null
   and a.assigned_to_persona_id is null
   and a.project_id is not null
   and a.status not in ('Completed', 'Cancelled', 'Force Cancelled', 'Superseded')
   and public.project_default_assignee(a.project_id) is not null;

-- ---------------------------------------------------------------------------
-- THE ACCOUNTS THIS JOB HAS ACTUALLY BEEN PAID FROM.
--
-- Shahar (2026-09-12): "have a place to update one's payment sources for easy
-- select in the drop down. can we start with nothing, but as data progress it
-- is added to a drop down automatically (per project)."
--
-- So there is no list to maintain: the list IS the record. Every distinct
-- account a payment on this project (or anything beneath it) has gone out of,
-- most recently used first. Empty on a new job, and it fills itself the first
-- time somebody types "Business card 4821".
create or replace function public.portal_payment_accounts(p_project uuid)
returns jsonb
language sql stable security definer set search_path to 'public'
as $$
  with recursive down as (
    select p.id from public.projects p where p.id = p_project
    union all
    select p.id from public.projects p join down on p.parent_project_id = down.id
  )
  select coalesce(jsonb_agg(a.account order by a.last_used desc), '[]'::jsonb)
    from (
      select btrim(t.paid_from_account) as account, max(coalesce(t.paid_on, t.created_at::date)) as last_used
        from public.transactions t
       where t.project_id in (select id from down)
         and nullif(btrim(t.paid_from_account), '') is not null
       group by 1
    ) a
$$;
revoke all on function public.portal_payment_accounts(uuid) from public, anon;
grant execute on function public.portal_payment_accounts(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A CORRECTION TO 073. portal_transaction_edit created a new payee with
-- `contact_type`, a column contacts does not have - plpgsql does not resolve
-- column names until the branch runs, so it applied cleanly and would have
-- thrown the first time somebody renamed a payee to a name not on file. The
-- column is `source`, the same one task_payment_log writes.
create or replace function public.portal_transaction_edit(p_id uuid, p_patch jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  me       uuid := public.current_app_user_id();
  t        public.transactions;
  pm       public.payment_methods;
  v_status text;
  v_method uuid;
  v_payee  uuid;
  v_name   text;
  n        int;
  changed  text[] := '{}';
  v_amount numeric;
  v_paid   date;
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'Sign in first.'); end if;

  select * into t from public.transactions where id = p_id;
  if t.id is null then return jsonb_build_object('ok', false, 'reason', 'No such payment.'); end if;
  if t.project_id is null then
    return jsonb_build_object('ok', false, 'reason', 'That payment is not on a project.');
  end if;
  if not public.fin_may_record(t.project_id) then
    return jsonb_build_object('ok', false, 'reason', 'Money on this project is not yours to change.');
  end if;

  if p_patch ? 'description' then
    if nullif(btrim(p_patch->>'description'), '') is distinct from t.description then
      update public.transactions set description = nullif(btrim(p_patch->>'description'), '') where id = p_id;
      changed := changed || 'what it was';
    end if;
  end if;

  if p_patch ? 'amount' then
    v_amount := nullif(btrim(p_patch->>'amount'), '')::numeric;
    if v_amount is null or v_amount <= 0 then
      return jsonb_build_object('ok', false, 'reason', 'An amount has to be a number above zero.');
    end if;
    if v_amount is distinct from t.amount then
      update public.transactions set amount = v_amount where id = p_id;
      changed := changed || 'amount';
    end if;
  end if;

  if p_patch ? 'paid_on' then
    v_paid := nullif(btrim(p_patch->>'paid_on'), '')::date;
    if v_paid is null then
      return jsonb_build_object('ok', false, 'reason', 'A payment needs the day it moved.');
    end if;
    if v_paid > current_date then
      return jsonb_build_object('ok', false, 'reason', 'That day has not happened yet.');
    end if;
    if v_paid is distinct from t.paid_on then
      update public.transactions set paid_on = v_paid where id = p_id;
      changed := changed || 'date';
    end if;
  end if;

  if p_patch ? 'method' then
    v_method := nullif(btrim(p_patch->>'method'), '')::uuid;
    select * into pm from public.payment_methods where id = v_method and is_active;
    if pm.id is null then return jsonb_build_object('ok', false, 'reason', 'Pick how it was paid.'); end if;
    if pm.settlement_type = 'processor' then
      return jsonb_build_object('ok', false, 'reason', format('%s is collected in the app, not logged by hand.', pm.name));
    end if;
    if coalesce(pm.requires_reference, false)
       and nullif(btrim(coalesce(p_patch->>'reference', t.payment_reference)), '') is null then
      return jsonb_build_object('ok', false, 'reason',
        format('%s needs a reference (%s). A payment without one cannot be reconciled later.',
               pm.name, coalesce(pm.notes, 'confirmation number')));
    end if;
    if v_method is distinct from t.payment_method_id then
      update public.transactions set payment_method_id = v_method, paid_via = pm.name where id = p_id;
      changed := changed || 'how it was paid';
    end if;
  end if;

  if p_patch ? 'reference' then
    if nullif(btrim(p_patch->>'reference'), '') is distinct from t.payment_reference then
      update public.transactions set payment_reference = nullif(btrim(p_patch->>'reference'), '') where id = p_id;
      changed := changed || 'reference';
    end if;
  end if;

  if p_patch ? 'from_account' then
    if nullif(btrim(p_patch->>'from_account'), '') is distinct from t.paid_from_account then
      update public.transactions set paid_from_account = nullif(btrim(p_patch->>'from_account'), '') where id = p_id;
      changed := changed || 'account';
    end if;
  end if;

  if p_patch ? 'notes' then
    if nullif(btrim(p_patch->>'notes'), '') is distinct from t.notes then
      update public.transactions set notes = nullif(btrim(p_patch->>'notes'), '') where id = p_id;
      changed := changed || 'note';
    end if;
  end if;

  if p_patch ? 'payee' then
    v_name := nullif(btrim(p_patch->>'payee'), '');
    if v_name is null then
      return jsonb_build_object('ok', false, 'reason', 'Say who was paid.');
    end if;
    select count(*) into n from public.contacts c
     where c.disabled_at is null and lower(coalesce(c.person_name, c.name)) = lower(v_name);
    if n > 1 then
      return jsonb_build_object('ok', false, 'reason',
        format('There is more than one "%s" on file. Pick the right one from the list.', v_name));
    end if;
    select c.id into v_payee from public.contacts c
     where c.disabled_at is null and lower(coalesce(c.person_name, c.name)) = lower(v_name) limit 1;
    if v_payee is null then
      insert into public.contacts (name, person_name, source, created_by)
      values (v_name, v_name, 'transaction edit', 'portal:transaction-edit')
      returning id into v_payee;
    end if;
    if v_payee is distinct from t.contractor_id then
      update public.transactions set contractor_id = v_payee where id = p_id;
      changed := changed || 'who was paid';
    end if;
  end if;

  if p_patch ? 'status' then
    v_status := nullif(btrim(p_patch->>'status'), '');
    if v_status is not null and v_status not in
       ('paid', 'paid - pending confirmation', 'paid - receipt filed', 'refunded', 'disputed', 'cancelled') then
      return jsonb_build_object('ok', false, 'reason', 'That is not a state you can set by hand.');
    end if;
    if v_status is not null and v_status is distinct from t.status then
      update public.transactions set status = v_status where id = p_id;
      changed := changed || ('marked ' || v_status);
    end if;
  end if;

  if array_length(changed, 1) is null then
    return jsonb_build_object('ok', true, 'changed', '[]'::jsonb, 'nothing', true);
  end if;
  update public.transactions
     set last_modified_by = 'portal', last_modified_at = now()
   where id = p_id;
  return jsonb_build_object('ok', true, 'changed', to_jsonb(changed));
end $$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
