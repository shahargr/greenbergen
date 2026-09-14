-- 107. THE AWARD SCREEN HAS SOMETHING TO READ.
--
-- Shahar (2026-09-14): "i need that screen, as i will award a stairs guy
-- soon." 106 gave the GC a way to hand a trade the work; this gives the
-- screen the two things it has to show before he can press the button - who
-- already holds what on this job, and who he could hand it to - plus the
-- case 106 could not cover: a stairs guy who is not on file yet.
--
-- portal_bid_candidates already answers "who could I invite", but it answers
-- it for the BID flow: it carries already_invited and is gated on
-- bid_can_manage. This is a different question on a different screen, so it
-- gets its own read rather than a second meaning bolted onto that one.

-- WHO HOLDS WHAT, AND WHO ELSE THERE IS.
--
-- people: everyone on a job this GC runs, or who has been paid on this one -
-- the same reach portal_bid_candidates has, which is "people I already work
-- with" rather than a directory of strangers. Each carries their trades, so
-- the screen can put the electricians at the top when the trade is Electrical
-- without hiding anybody: a man who has only ever framed for you may still be
-- the one you hand the stairs to.
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
  'What the award screen shows: who already holds a contract-bounded seat on this job, and who the GC could hand work to.';

grant execute on function public.portal_award_board(uuid) to authenticated;

-- SOMEBODY NOT ON FILE YET.
--
-- "i will award a stairs guy soon" - and there is no stairs guy in the
-- contacts table. Making him first on another screen and coming back is two
-- screens and a lost thought, so the award screen can take a name.
--
-- It creates the least it can get away with: a contact, and a company only
-- when a company name was actually given. Everything else about him -
-- certificates, a W-9, a login - happens if and when he joins; a name and a
-- phone number is what a GC has at the moment he says "it's yours".
create or replace function public.portal_award_add_trade(
  p_project uuid,
  p_name text,
  p_trade text default null,
  p_company text default null,
  p_phone text default null,
  p_email text default null,
  p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_co   text := nullif(btrim(coalesce(p_company, '')), '');
  v_contact uuid; v_company uuid;
begin
  perform public.assert_own_hands();
  if public.current_app_user_id() is null then
    return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.');
  end if;
  if not public.can_edit_project(p_project) then
    return jsonb_build_object('ok', false, 'reason', 'Awarding work on this job is not yours to do.');
  end if;
  if v_name is null then
    return jsonb_build_object('ok', false, 'reason', 'Give them a name.');
  end if;

  -- Somebody with this name already on file is the same somebody, not a
  -- second row. A GC who types "Franklin Moreno" again means the Franklin
  -- Moreno he already knows.
  select c.id into v_contact from public.contacts c
   where c.disabled_at is null
     and lower(btrim(coalesce(c.person_name, c.name))) = lower(v_name)
   limit 1;

  if v_contact is null then
    if v_co is not null then
      select id into v_company from public.companies
       where lower(btrim(company_name)) = lower(v_co) limit 1;
      if v_company is null then
        insert into public.companies (company_name, main_phone, main_email, source, created_by, needs_review)
        values (v_co, nullif(btrim(coalesce(p_phone, '')), ''), nullif(btrim(coalesce(p_email, '')), ''),
                'pro-app:award', 'pro-app:award', true)
        returning id into v_company;
      end if;
    end if;

    insert into public.contacts (name, person_name, phone, email_a, company_id, source, created_by)
    values (v_name, v_name, nullif(btrim(coalesce(p_phone, '')), ''),
            nullif(btrim(coalesce(p_email, '')), ''), v_company, 'pro-app:award', 'pro-app:award')
    returning id into v_contact;
  end if;

  return public.portal_award_trade(p_project, v_contact, p_trade, p_note);
end $$;

comment on function public.portal_award_add_trade(uuid, text, text, text, text, text, text) is
  'Awards a trade to somebody who is not on file yet: makes the contact (and the company, when one was named), then hands it to portal_award_trade. A name that already exists is reused, never duplicated.';

grant execute on function public.portal_award_add_trade(uuid, text, text, text, text, text, text) to authenticated;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
