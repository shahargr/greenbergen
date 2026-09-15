-- 131. A BUILD IS FOUR THINGS BEFORE IT IS WORK.
--
-- Shahar (2026-09-15), writing "Internal stairs" on the new-task screen:
-- "task type : Build. / sort assigned to drop down: first, list the PM, GC,
-- Owner. then, list the rest of the assigned contractors. add an option to
-- add new assigned to / will require to create a contact - or company if does
-- not exist. / Trigger : create 4 child tasks when type is building: define
-- scope / contractor selection / legal & insurance / punch list & inspection.
-- something I should have done for every trade, and will help me classified
-- tasks under every trade."
--
-- That is the whole shape of how a trade gets onto a site, and it is the same
-- four steps every time - stairs, framing, plumbing, the generator pad. What
-- the four have in common is that NONE of them is the building: they are the
-- things that have to be true before anybody turns up with tools, plus the
-- one that has to be true before they leave.
--
-- HOW IT IS BUILT. Not as a new trigger. A "Build" task is given the
-- blueprint's id on the way in and fn_actions_expand_blueprint - which has
-- fanned blueprints out into child tasks since the beginning, and since
-- migration 129 carries their order with them - does the rest. So the four
-- steps are DATA in blueprint_activity_steps, editable like every other
-- process here, rather than four literals inside a trigger.

-- 1. THE KIND. First in the list, because on a construction job it is the
-- commonest thing anybody writes down. needs_money is true: a build is where
-- the trade and the money live, and it is the one kind whose target cost and
-- payee are the point rather than an afterthought.
insert into public.action_types (action_type, label, description, needs_money, sort_order, is_active)
values ('build', 'Build',
  'A trade''s work on this job - the stairs, the framing, the pad. Carries the trade, what you expect it to cost '
  || 'and who gets paid, and comes with the four steps every trade goes through before anybody turns up: the scope, '
  || 'choosing who does it, the paperwork that keeps it legal, and the punch list at the end.',
  true, 0, true)
on conflict (action_type) do update
  set label = excluded.label, description = excluded.description,
      needs_money = excluded.needs_money, sort_order = excluded.sort_order, is_active = true;

-- 2. THE FOUR STEPS.
insert into public.blueprint_activity (name, domain, description, recurrence_note, auto_close_condition, created_by)
values (
  'Build - a trade package',
  'construction',
  'What has to be true before a trade starts on site, and before it leaves. Attached automatically to every task of '
  || 'kind "Build" (migration 131), so a trade''s work is never a single line that says "stairs" and nothing about how '
  || 'the stairs get built. THE ORDER IS NOT OPTIONAL: the scope is what you bid, the bid is what you sign, and what '
  || 'you signed is what the punch list is measured against. Skipping straight to a contractor means negotiating '
  || 'against a scope nobody wrote down, which is the single most expensive mistake on a build.',
  'Once per trade per job. Four steps whatever the trade is - stairs, framing, plumbing, the generator pad.',
  'The trade is finished, inspected and the punch list is clear',
  'Shahar (2026-09-15)'
)
on conflict (name) do nothing;

insert into public.blueprint_activity_steps
  (activity_blueprint_id, step_order, step_name, default_assigned_to, necessity, cadence, notes)
select b.id, s.step_order, s.step_name, s.who, s.necessity, s.cadence, s.notes
from public.blueprint_activity b,
lateral (values
  (10, 'Define the scope', 'PM / Owner', 'required', 'one-time',
   'IN WRITING, because this is the document every later argument is settled against. What is being built, to what '
   || 'spec, with what materials, and - the half everybody forgets - what is NOT included and WHO SUPPLIES WHAT. '
   || 'Measurements taken on site, not off a drawing. Attach the drawings and the spec to this task so the same '
   || 'scope goes to every bidder; three prices against three different readings of the job are not three prices.'),

  (20, 'Contractor selection', 'PM / Owner', 'required', 'one-time',
   'Bid the SAME scope to three. Meet the shortlist in person and go and look at a job they have running - a live '
   || 'site tells you in ten minutes what references never will. Compare like for like: a cheaper number usually '
   || 'means something was left out of it, so find the line rather than assume the discount. Negotiate, then sign. '
   || 'The "Hire contractor" blueprint is this step in full if you want it as its own list of fifteen.'),

  (30, 'Legal and insurance', 'PM / Owner', 'required', 'one-time',
   'THE PAPERWORK THAT HAS TO EXIST BEFORE ANYBODY IS ON SITE, not after: a certificate of insurance naming you as '
   || 'additional insured, workers'' compensation (their injury on your property is your problem without it), the '
   || 'licence for trades that need one, a W-9 before the first payment, and the signed contract with its payment '
   || 'schedule and retainage. If this trade needs its own permit, it is filed here. Chasing a certificate after the '
   || 'work has started is chasing somebody who no longer needs anything from you.'),

  (40, 'Punch list and inspection', 'PM / Owner', 'required', 'per-inspection',
   'Walk it WITH the trade while they are still on site and write the list there and then, with a date against each '
   || 'line. Photograph what is wrong. Where the town inspects this trade, book it and pass it before the final '
   || 'payment - a failed inspection after the last cheque is your money. Hold the retainage until the list is clear, '
   || 'then close this out, collect the warranty and say so on the job.')
) as s(step_order, step_name, who, necessity, cadence, notes)
where b.name = 'Build - a trade package'
on conflict (activity_blueprint_id, step_order) do nothing;

-- 3. A BUILD TASK CARRIES THE BLUEPRINT IN. Only a top-level one: "Define the
-- scope" under a build is a step, and a step that explodes into four more
-- steps of its own is a screen nobody can read.
do $patch$
declare src text; out_ text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'portal_task_create';

  out_ := replace(src,
    E'  select coalesce(pr.domain, \'construction\') into v_dom\n    from public.projects pr where pr.id = p_project;\n',
    E'  select coalesce(pr.domain, \'construction\') into v_dom\n    from public.projects pr where pr.id = p_project;\n'
    || E'\n'
    || E'  -- A BUILD COMES WITH ITS FOUR STEPS (migration 131). The id goes on\n'
    || E'  -- the row and fn_actions_expand_blueprint does the fanning out, so\n'
    || E'  -- the steps stay data rather than becoming literals in here.\n'
    || E'  if v_type = \'build\' and p_parent is null then\n'
    || E'    select b.id into v_blueprint from public.blueprint_activity b\n'
    || E'     where b.name = \'Build - a trade package\' limit 1;\n'
    || E'  end if;\n');

  out_ := replace(out_,
    E'  v_dom   text;\n  f       uuid;\n',
    E'  v_dom   text;\n  v_blueprint uuid;\n  f       uuid;\n');

  out_ := replace(out_,
    E'     trade, contract_id, requires_photo_evidence, is_gate,\n     source, created_by, last_modified_by)\n',
    E'     trade, contract_id, requires_photo_evidence, is_gate, activity_blueprint_id,\n     source, created_by, last_modified_by)\n');

  out_ := replace(out_,
    E'     coalesce(p_requires_photo, false), coalesce(p_is_gate, false),\n     \'portal:new-task\', \'portal:new-task\', \'portal:new-task\')\n',
    E'     coalesce(p_requires_photo, false), coalesce(p_is_gate, false), v_blueprint,\n     \'portal:new-task\', \'portal:new-task\', \'portal:new-task\')\n');

  out_ := replace(out_,
    E'  return jsonb_build_object(\'ok\', true, \'id\', v_id, \'action\', left(v_name, 300));\n',
    E'  return jsonb_build_object(\'ok\', true, \'id\', v_id, \'action\', left(v_name, 300),\n'
    || E'    \'steps\', (select count(*) from public.actions ch where ch.parent_action_id = v_id));\n');

  if out_ = src then
    raise exception 'portal_task_create has drifted - none of the five patches applied.';
  end if;
  execute out_;
end $patch$;

-- 4. WHO IS ON THIS JOB, IN THE ORDER YOU WOULD SAY THEM. Shahar: "first,
-- list the PM, GC, Owner. then, list the rest of the assigned contractors."
-- project_roles.authority_rank already holds that order (asset owner 70, site
-- GC 60, site PM 50, contractor 30, sub 10-20, crew 5); it had simply never
-- been handed to the app, so every picker sorted by whatever order the rows
-- came back in.
--
-- It also fixes a duplicate that was always possible here: the old
-- jsonb_agg(distinct ...) deduplicated whole OBJECTS, so somebody holding two
-- seats on one job appeared twice with two different seat names. One row per
-- contact now, carrying their highest seat.
create or replace function public.portal_compose_targets()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
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
  seats as (
    select pm2.project_id,
           c.id as contact_id,
           coalesce(c.person_name, c.name) as name,
           (array_agg(coalesce(pm2.project_role, pm2.role)
                      order by coalesce(pr.authority_rank, 0) desc))[1] as seat,
           max(coalesce(pr.authority_rank, 0)) as rank
      from public.project_members pm2
      left join public.project_roles pr on pr.role = pm2.project_role
      join public.contacts c
        on c.id = coalesce(pm2.contact_id,
                           (select u3.contact_id from public.app_users u3 where u3.id = pm2.app_user_id))
     where pm2.status = 'active'
       and pm2.project_id in (select id from my_projects)
     group by pm2.project_id, c.id, coalesce(c.person_name, c.name)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'project_id', q.id,
    'project_name', q.project_name,
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
               'contact_id', s.contact_id, 'name', s.name, 'seat', s.seat, 'rank', s.rank,
               'me', (s.contact_id = (select contact_id from me)))
             order by s.rank desc, s.name)
        from seats s where s.project_id = q.id), '[]'::jsonb)
  ) order by q.project_name), '[]'::jsonb)
  from my_projects q;
$function$;

-- 5. SOMEBODY WHO IS NOT ON THE LIST YET. "add an option to add new assigned
-- to / will require to create a contact - or company if does not exist."
--
-- The identity rule is the one migration 111 wrote for awarding a trade, and
-- it is lifted out here so both doors use it rather than growing two versions
-- of it: look up the email AND the phone before believing either, and refuse
-- when they name two different people, because that is the case that quietly
-- writes a job onto a stranger's record.
create or replace function public.contact_resolve(
  p_name text, p_email text default null, p_phone text default null,
  p_company text default null, p_source text default 'portal')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_name  text := nullif(btrim(coalesce(p_name, '')), '');
  v_co    text := nullif(btrim(coalesce(p_company, '')), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
  v_contact uuid; v_company uuid; v_matched text; v_found text;
  v_by_email uuid; v_by_phone uuid; v_email_name text; v_phone_name text;
begin
  if v_name is null then
    return jsonb_build_object('ok', false, 'reason', 'Give them a name.');
  end if;

  if v_email is not null then
    select c.id, coalesce(c.person_name, c.name) into v_by_email, v_email_name
      from public.contacts c
     where c.disabled_at is null and lower(c.email_a) = lower(v_email)
     limit 1;
  end if;
  if v_phone is not null then
    select c.id, coalesce(c.person_name, c.name) into v_by_phone, v_phone_name
      from public.contacts c
     where c.disabled_at is null and public.phone_key(c.phone) = public.phone_key(v_phone)
     limit 1;
  end if;

  if v_by_email is not null and v_by_phone is not null and v_by_email <> v_by_phone then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT', 'reason',
      'That email is ' || v_email_name || ' and that number is ' || v_phone_name
      || ' - two different people on file. Leave whichever one is wrong blank, or pick them from the list.');
  end if;

  -- The email leads: it is what an account here is claimed with, and a phone
  -- can be an office line that three people answer.
  if v_by_email is not null then
    v_contact := v_by_email; v_found := v_email_name; v_matched := 'email';
  elsif v_by_phone is not null then
    v_contact := v_by_phone; v_found := v_phone_name; v_matched := 'phone';
  else
    select c.id, coalesce(c.person_name, c.name) into v_contact, v_found
      from public.contacts c
     where c.disabled_at is null
       and lower(btrim(coalesce(c.person_name, c.name))) = lower(v_name)
     limit 1;
    if v_contact is not null then v_matched := 'name'; end if;
  end if;

  if v_contact is null then
    if v_co is not null then
      if v_email is not null then
        select id into v_company from public.companies where lower(main_email) = lower(v_email) limit 1;
      end if;
      if v_company is null and v_phone is not null then
        select id into v_company from public.companies
         where public.phone_key(main_phone) = public.phone_key(v_phone) limit 1;
      end if;
      if v_company is null then
        select id into v_company from public.companies
         where lower(btrim(company_name)) = lower(v_co) limit 1;
      end if;
      if v_company is null then
        begin
          insert into public.companies (company_name, main_phone, main_email, source, created_by, needs_review)
          values (v_co, v_phone, v_email, p_source, p_source, true)
          returning id into v_company;
        exception when unique_violation then
          select id into v_company from public.companies
           where public.phone_key(main_phone) = public.phone_key(v_phone)
              or lower(main_email) = lower(v_email)
              or lower(btrim(company_name)) = lower(v_co)
           limit 1;
        end;
      end if;
    end if;

    begin
      insert into public.contacts (name, person_name, phone, email_a, company_id, source, created_by)
      values (v_name, v_name, v_phone, v_email, v_company, p_source, p_source)
      returning id into v_contact;
      v_matched := 'new';
    exception when unique_violation then
      select c.id, coalesce(c.person_name, c.name),
             case when v_email is not null and lower(c.email_a) = lower(v_email) then 'email' else 'phone' end
        into v_contact, v_found, v_matched
        from public.contacts c
       where (v_email is not null and lower(c.email_a) = lower(v_email))
          or (v_phone is not null and public.phone_key(c.phone) = public.phone_key(v_phone))
       limit 1;
      if v_contact is null then
        return jsonb_build_object('ok', false, 'reason',
          'That phone or email is already on somebody else''s record. Check it, or pick them from the list.');
      end if;
    end;
  end if;

  return jsonb_build_object('ok', true, 'contact_id', v_contact, 'matched', v_matched,
    'found', v_found, 'company_id', v_company,
    'note', case
      when v_matched is null or v_matched = 'new' then null
      when lower(coalesce(v_found, '')) = lower(v_name) then null
      when v_matched = 'email' then 'That email is already ' || v_found || ' - used them.'
      when v_matched = 'phone' then 'That number is already ' || v_found || ' - used them.'
      else null end);
end $function$;

comment on function public.contact_resolve(text, text, text, text, text) is
'Find or make a contact, and their company, from a name plus whatever identifiers you have. Looks up the email AND the phone before believing either and REFUSES when they name two different people (migration 111''s rule, lifted out here so every door uses one version of it). Never seats anybody anywhere - that is the caller''s business.';

create or replace function public.portal_project_person_add(
  p_project uuid, p_name text, p_role text default 'contractor',
  p_company text default null, p_email text default null, p_phone text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  me uuid := public.current_app_user_id();
  v_role text := nullif(btrim(coalesce(p_role, '')), '');
  v_rank int; v_mine int; v_app_role text; r jsonb; v_contact uuid; v_existing uuid;
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.'); end if;
  if not public.can_edit_project(p_project) then
    return jsonb_build_object('ok', false, 'reason', 'Adding people to this job is not yours to do.');
  end if;
  v_mine := coalesce(public.my_authority_rank(p_project), 0);
  if not public.is_superadmin() and v_mine < 50 then
    return jsonb_build_object('ok', false, 'reason', 'Adding people to this job is the manager''s to do.');
  end if;

  select pr.authority_rank into v_rank from public.project_roles pr where pr.role = v_role;
  if not found then
    return jsonb_build_object('ok', false, 'reason', format('"%s" is not a seat on a project.', v_role));
  end if;
  -- You cannot seat somebody above yourself. Without this a site manager
  -- could put a stranger in the owner's chair and then act as them.
  if not public.is_superadmin() and coalesce(v_rank, 0) > v_mine then
    return jsonb_build_object('ok', false, 'reason',
      format('"%s" sits above your own seat here, so it is not yours to hand out.', v_role));
  end if;

  r := public.contact_resolve(p_name, p_email, p_phone, p_company, 'pro-app:add-person');
  if not coalesce((r->>'ok')::boolean, false) then return r; end if;
  v_contact := (r->>'contact_id')::uuid;

  -- The app-access role the seat implies. project_members.role is the coarse
  -- one the CHECK constraint allows; project_role is the word people use.
  v_app_role := case when coalesce(v_rank, 0) >= 70 then 'owner'
                     when coalesce(v_rank, 0) >= 50 then 'manager'
                     when coalesce(v_rank, 0) >= 5  then 'collaborator'
                     else 'viewer' end;

  select pm.id into v_existing from public.project_members pm
   where pm.project_id = p_project and pm.contact_id = v_contact and pm.status = 'active'
   limit 1;

  if v_existing is not null then
    return r || jsonb_build_object('ok', true, 'contact_id', v_contact, 'already', true,
      'name', (select coalesce(c.person_name, c.name) from public.contacts c where c.id = v_contact));
  end if;

  insert into public.project_members (project_id, contact_id, role, project_role, status, accepted_at, notes)
  values (p_project, v_contact, v_app_role, v_role, 'active', now(), 'Added from the new-task screen.');

  return r || jsonb_build_object('ok', true, 'contact_id', v_contact, 'already', false,
    'seat', v_role,
    'name', (select coalesce(c.person_name, c.name) from public.contacts c where c.id = v_contact));
end $function$;

comment on function public.portal_project_person_add(uuid, text, text, text, text, text) is
'Put somebody on a project who is not on it yet, making the contact and the company if they do not exist (contact_resolve). A manager''s to do - rank 50 - and never into a seat above your own. Returns the contact so a picker can select them without a round trip.';

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
