-- 176: A PROCESS IS WRITTEN AND CHANGED IN THE APP, AND EVERY STEP HAS A
--      PICTURE AND AN EXPLANATION.
--
-- Shahar (2026-09-17): "need to simplify both creation and adjustment of
-- processes for each DIY project, and add photo and explanation to every
-- step."
--
-- Until now a process was written by hand in SQL, which means one person can
-- write one and nobody can correct it standing on site. Six functions make
-- it an ordinary screen: list them, read one whole, save the process, save a
-- step, remove a step, move a step. Steps renumber to 10, 20, 30 on every
-- save, so nothing ever fights over a number and "move it up" is one tap.
--
-- A STEP IS NOW THREE THINGS: what to do (the name), WHY and HOW (notes -
-- the explanation, which every step must have), and WHAT IT LOOKS LIKE (a
-- photograph). The picture is the half that was missing and it is the half
-- a DIY homeowner reads first: a nameplate with the BTU rating circled says
-- more than a paragraph about nameplates.
--
-- WHAT PROPAGATES AND WHAT DOES NOT, unchanged and deliberate (help topic
-- blueprints): ADDING a step reaches every job of that kind still in flight;
-- EDITING or REMOVING one does not, because a job already under way was
-- quoted and scoped on the steps it was given. The editor says so on screen.

alter table public.blueprint_activity_steps
  add column if not exists photo_url text;
comment on column public.blueprint_activity_steps.photo_url is
  'What this step looks like - a photograph or diagram, public-media. Migration 176.';
comment on column public.blueprint_activity_steps.notes is
  'THE EXPLANATION: why this step exists, how to do it, and what goes wrong when it is skipped. Copied onto every task made from the step.';

alter table public.actions
  add column if not exists step_photo_url text;
comment on column public.actions.step_photo_url is
  'The picture from the blueprint step this task came from (migration 176). Not evidence - evidence is file_links.';

-- Expansion and backfill carry the picture down.
do $patch$
declare src text; out_ text;
begin
  src := pg_get_functiondef('public.fn_actions_expand_blueprint()'::regprocedure);
  out_ := replace(src, E'    asks, decides, answers, only_if\n  )', E'    asks, decides, answers, only_if, step_photo_url\n  )');
  out_ := replace(out_, E'         s.asks, s.decides, s.answers, s.only_if\n', E'         s.asks, s.decides, s.answers, s.only_if, s.photo_url\n');
  if out_ = src or position('s.photo_url' in out_) = 0 then
    raise exception 'fn_actions_expand_blueprint has drifted';
  end if;
  execute out_;
end $patch$;

do $patch$
declare src text; out_ text;
begin
  src := pg_get_functiondef('public.fn_blueprint_step_backfill()'::regprocedure);
  out_ := replace(src, E'    asks, decides, answers, only_if\n  )', E'    asks, decides, answers, only_if, step_photo_url\n  )');
  out_ := replace(out_, E'         new.asks, new.decides, new.answers, new.only_if\n', E'         new.asks, new.decides, new.answers, new.only_if, new.photo_url\n');
  if out_ = src or position('new.photo_url' in out_) = 0 then
    raise exception 'fn_blueprint_step_backfill has drifted';
  end if;
  execute out_;
end $patch$;

do $patch$
declare src text; out_ text;
begin
  src := pg_get_functiondef('public.portal_task_detail(uuid)'::regprocedure);
  out_ := replace(src, E'      ''only_if'', a.only_if, ''answer'', a.answer,\n',
                       E'      ''only_if'', a.only_if, ''answer'', a.answer, ''step_photo_url'', a.step_photo_url,\n');
  if out_ = src then raise exception 'portal_task_detail has drifted - answer key not found'; end if;
  execute out_;
end $patch$;

-- ---------------------------------------------------------------------------
-- READING. Anyone signed in may read a process: it is the instructions, and
-- a contractor following one should be able to see it.
create or replace function public.portal_processes()
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', b.id, 'name', b.name, 'domain', b.domain, 'description', b.description,
      'is_active', b.is_active,
      'steps', (select count(*) from public.blueprint_activity_steps s where s.activity_blueprint_id = b.id),
      'with_photo', (select count(*) from public.blueprint_activity_steps s
                      where s.activity_blueprint_id = b.id and s.photo_url is not null),
      'packages', (select jsonb_agg(p.name order by p.name) from public.blueprint_packages p
                    where p.activity_blueprint_id = b.id),
      'in_flight', (select count(*) from public.actions a
                     where a.activity_blueprint_id = b.id
                       and a.status not in ('Completed','Cancelled','Force Cancelled','Superseded')))
    order by b.domain, b.name)
    from public.blueprint_activity b), '[]'::jsonb)
  where public.current_app_user_id() is not null;
$$;
revoke all on function public.portal_processes() from public, anon;
grant execute on function public.portal_processes() to authenticated;

create or replace function public.portal_process(p_blueprint uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.current_app_user_id() is null then null else
    (select jsonb_build_object(
      'id', b.id, 'name', b.name, 'domain', b.domain, 'description', b.description,
      'is_active', b.is_active, 'recurrence_note', b.recurrence_note,
      'can_edit', public.is_superadmin(),
      'in_flight', (select count(*) from public.actions a
                     where a.activity_blueprint_id = b.id
                       and a.status not in ('Completed','Cancelled','Force Cancelled','Superseded')),
      'packages', (select jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name) order by p.name)
                     from public.blueprint_packages p where p.activity_blueprint_id = b.id),
      'steps', coalesce((select jsonb_agg(jsonb_build_object(
          'id', s.id, 'step_order', s.step_order, 'step_name', s.step_name,
          'notes', s.notes, 'photo_url', s.photo_url,
          'default_assigned_to', s.default_assigned_to, 'necessity', s.necessity,
          'action_type', s.action_type, 'is_gate', s.is_gate, 'cadence', s.cadence,
          'asks', s.asks, 'decides', s.decides, 'answers', to_jsonb(s.answers), 'only_if', s.only_if)
        order by s.step_order)
        from public.blueprint_activity_steps s where s.activity_blueprint_id = b.id), '[]'::jsonb),
      -- Every fact any step decides, so a step being edited can pick one
      -- rather than have its condition typed from memory.
      'facts', coalesce((select jsonb_agg(distinct jsonb_build_object('decides', s2.decides, 'answers', to_jsonb(s2.answers)))
        from public.blueprint_activity_steps s2
       where s2.activity_blueprint_id = b.id and s2.decides is not null), '[]'::jsonb))
    from public.blueprint_activity b where b.id = p_blueprint) end;
$$;
revoke all on function public.portal_process(uuid) from public, anon;
grant execute on function public.portal_process(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- WRITING. A process is the library, shared by every job of its kind, so
-- changing one is a platform act.
create or replace function public.portal_process_save(
  p_blueprint uuid default null, p_name text default null,
  p_description text default null, p_domain text default 'construction',
  p_is_active boolean default true)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid := p_blueprint; v_name text := nullif(btrim(coalesce(p_name, '')), '');
begin
  perform public.assert_own_hands();
  if not public.is_superadmin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ALLOWED',
      'reason', 'A process is the library every job of its kind follows. Changing one is not yours to do.');
  end if;
  if v_id is null and v_name is null then
    return jsonb_build_object('ok', false, 'reason', 'Give the process a name - what it is a process FOR.');
  end if;
  if not exists (select 1 from public.domains d where d.domain = coalesce(p_domain, 'construction')) then
    return jsonb_build_object('ok', false, 'reason', format('"%s" is not a domain on file.', p_domain));
  end if;

  if v_id is null then
    if exists (select 1 from public.blueprint_activity b where lower(b.name) = lower(v_name)) then
      return jsonb_build_object('ok', false, 'code', 'EXISTS',
        'reason', format('"%s" already exists. Open it and change it rather than writing a second one.', v_name));
    end if;
    insert into public.blueprint_activity (name, domain, description, is_active, created_by)
    values (v_name, coalesce(p_domain, 'construction'), nullif(btrim(p_description), ''),
            coalesce(p_is_active, true), 'portal:process')
    returning id into v_id;
    return jsonb_build_object('ok', true, 'id', v_id, 'created', true, 'name', v_name);
  end if;

  update public.blueprint_activity
     set name = coalesce(v_name, name),
         description = coalesce(nullif(btrim(p_description), ''), description),
         domain = coalesce(p_domain, domain),
         is_active = coalesce(p_is_active, is_active)
   where id = v_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'That process is not on file.'); end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'created', false,
    'name', (select name from public.blueprint_activity where id = v_id));
end $$;
revoke all on function public.portal_process_save(uuid, text, text, text, boolean) from public, anon;
grant execute on function public.portal_process_save(uuid, text, text, text, boolean) to authenticated;

-- ONE STEP: what to do, why (the explanation), and what it looks like.
create or replace function public.portal_process_step_save(
  p_step uuid default null, p_blueprint uuid default null,
  p_name text default null, p_notes text default null, p_photo_url text default null,
  p_after uuid default null, p_assignee text default null, p_action_type text default null,
  p_is_gate boolean default false, p_necessity text default 'required',
  p_asks text default null, p_decides text default null, p_answers text[] default null,
  p_only_if jsonb default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id    uuid := p_step;
  v_bp    uuid := p_blueprint;
  v_name  text := nullif(btrim(coalesce(p_name, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_order integer;
  v_made  boolean := false;
begin
  perform public.assert_own_hands();
  if not public.is_superadmin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ALLOWED',
      'reason', 'A process is the library every job of its kind follows. Changing one is not yours to do.');
  end if;
  if v_id is not null then
    select activity_blueprint_id into v_bp from public.blueprint_activity_steps where id = v_id;
    if v_bp is null then return jsonb_build_object('ok', false, 'reason', 'That step is not on file.'); end if;
  end if;
  if v_bp is null then return jsonb_build_object('ok', false, 'reason', 'Say which process the step belongs to.'); end if;
  if v_id is null and v_name is null then
    return jsonb_build_object('ok', false, 'reason', 'Give the step a name - what has to happen.');
  end if;
  -- EVERY STEP CARRIES ITS EXPLANATION (Shahar, 2026-09-17). A step with a
  -- name and nothing else is a line somebody has to interpret on site.
  if v_id is null and v_notes is null then
    return jsonb_build_object('ok', false, 'code', 'NEEDS_EXPLANATION',
      'reason', 'Every step needs its explanation: why it exists, how to do it, and what goes wrong when it is skipped.');
  end if;
  if p_action_type is not null and not exists (
      select 1 from public.action_types t where t.action_type = p_action_type and t.is_active) then
    return jsonb_build_object('ok', false, 'reason', format('"%s" is not a kind of task.', p_action_type));
  end if;
  if p_necessity is not null and p_necessity not in ('required','recommended','optional') then
    return jsonb_build_object('ok', false, 'reason', 'A step is required, recommended or optional.');
  end if;

  if v_id is null then
    -- Where it lands: right after the step named, else at the end. The
    -- renumber below turns whatever comes out into 10, 20, 30.
    select coalesce((select s.step_order + 5 from public.blueprint_activity_steps s where s.id = p_after),
                    (select coalesce(max(s.step_order), 0) + 10 from public.blueprint_activity_steps s
                      where s.activity_blueprint_id = v_bp))
      into v_order;
    insert into public.blueprint_activity_steps
      (activity_blueprint_id, step_order, step_name, notes, photo_url, default_assigned_to,
       necessity, action_type, is_gate, asks, decides, answers, only_if)
    values (v_bp, v_order, v_name, v_notes, nullif(btrim(p_photo_url), ''), nullif(btrim(p_assignee), ''),
            coalesce(p_necessity, 'required'), p_action_type, coalesce(p_is_gate, false),
            nullif(btrim(p_asks), ''), nullif(btrim(p_decides), ''), p_answers, p_only_if)
    returning id into v_id;
    v_made := true;
  else
    update public.blueprint_activity_steps
       set step_name = coalesce(v_name, step_name),
           notes = coalesce(v_notes, notes),
           photo_url = case when p_photo_url is null then photo_url
                            when btrim(p_photo_url) = '' then null
                            else btrim(p_photo_url) end,
           default_assigned_to = nullif(btrim(coalesce(p_assignee, default_assigned_to)), ''),
           necessity = coalesce(p_necessity, necessity),
           action_type = p_action_type,
           is_gate = coalesce(p_is_gate, is_gate),
           asks = nullif(btrim(coalesce(p_asks, '')), ''),
           decides = nullif(btrim(coalesce(p_decides, '')), ''),
           answers = p_answers,
           only_if = p_only_if
     where id = v_id;
  end if;

  -- RENUMBER, always: 10, 20, 30. Nothing ever collides and "move it up"
  -- becomes an ordinary save.
  with ranked as (
    select id, row_number() over (order by step_order, step_name) * 10 as n
      from public.blueprint_activity_steps where activity_blueprint_id = v_bp)
  update public.blueprint_activity_steps s set step_order = r.n
    from ranked r where r.id = s.id and s.step_order is distinct from r.n;

  return jsonb_build_object('ok', true, 'id', v_id, 'created', v_made,
    'propagated', v_made and exists (select 1 from public.actions a
      where a.activity_blueprint_id = v_bp
        and a.status not in ('Completed','Cancelled','Force Cancelled')),
    'steps', (select count(*) from public.blueprint_activity_steps where activity_blueprint_id = v_bp));
end $$;
revoke all on function public.portal_process_step_save(uuid, uuid, text, text, text, uuid, text, text, boolean, text, text, text, text[], jsonb) from public, anon;
grant execute on function public.portal_process_step_save(uuid, uuid, text, text, text, uuid, text, text, boolean, text, text, text, text[], jsonb) to authenticated;

create or replace function public.portal_process_step_move(p_step uuid, p_up boolean default true)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_bp uuid; v_order integer; v_other uuid; v_other_order integer;
begin
  perform public.assert_own_hands();
  if not public.is_superadmin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ALLOWED', 'reason', 'Changing a process is not yours to do.');
  end if;
  select activity_blueprint_id, step_order into v_bp, v_order
    from public.blueprint_activity_steps where id = p_step;
  if v_bp is null then return jsonb_build_object('ok', false, 'reason', 'That step is not on file.'); end if;

  if coalesce(p_up, true) then
    select id, step_order into v_other, v_other_order from public.blueprint_activity_steps
     where activity_blueprint_id = v_bp and step_order < v_order order by step_order desc limit 1;
  else
    select id, step_order into v_other, v_other_order from public.blueprint_activity_steps
     where activity_blueprint_id = v_bp and step_order > v_order order by step_order limit 1;
  end if;
  if v_other is null then
    return jsonb_build_object('ok', true, 'moved', false,
      'reason', case when coalesce(p_up, true) then 'It is already first.' else 'It is already last.' end);
  end if;
  update public.blueprint_activity_steps set step_order = v_other_order where id = p_step;
  update public.blueprint_activity_steps set step_order = v_order where id = v_other;
  return jsonb_build_object('ok', true, 'moved', true);
end $$;
revoke all on function public.portal_process_step_move(uuid, boolean) from public, anon;
grant execute on function public.portal_process_step_move(uuid, boolean) to authenticated;

create or replace function public.portal_process_step_delete(p_step uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_bp uuid; v_name text; v_live integer;
begin
  perform public.assert_own_hands();
  if not public.is_superadmin() then
    return jsonb_build_object('ok', false, 'code', 'NOT_ALLOWED', 'reason', 'Changing a process is not yours to do.');
  end if;
  select activity_blueprint_id, step_name into v_bp, v_name
    from public.blueprint_activity_steps where id = p_step;
  if v_bp is null then return jsonb_build_object('ok', false, 'reason', 'That step is not on file.'); end if;

  -- What is already out there stays. Removing a step takes it out of the
  -- LIBRARY; the jobs that were given it keep it, because they were scoped
  -- and priced on the steps they were given.
  select count(*) into v_live
    from public.actions a
    join public.actions p on p.id = a.parent_action_id and p.activity_blueprint_id = v_bp
   where a.action = v_name and a.status not in ('Completed','Cancelled','Force Cancelled');

  delete from public.blueprint_activity_steps where id = p_step;
  with ranked as (
    select id, row_number() over (order by step_order, step_name) * 10 as n
      from public.blueprint_activity_steps where activity_blueprint_id = v_bp)
  update public.blueprint_activity_steps s set step_order = r.n
    from ranked r where r.id = s.id and s.step_order is distinct from r.n;

  return jsonb_build_object('ok', true, 'removed', v_name, 'still_open_on_jobs', v_live);
end $$;
revoke all on function public.portal_process_step_delete(uuid) from public, anon;
grant execute on function public.portal_process_step_delete(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- WHICH PROCESS A JOB WOULD FOLLOW, for the button that starts it.
create or replace function public.portal_project_process(p_project uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not (public.is_project_member(p_project) or public.is_superadmin()) then null else
    (select jsonb_build_object(
      'blueprint_id', bp.activity_blueprint_id,
      'name', (select b.name from public.blueprint_activity b where b.id = bp.activity_blueprint_id),
      'steps', (select count(*) from public.blueprint_activity_steps s where s.activity_blueprint_id = bp.activity_blueprint_id),
      'takes_tasks', public.portal_task_takes_tasks(p_project),
      'started', (select a.id from public.actions a
                   where a.project_id = p_project and a.activity_blueprint_id = bp.activity_blueprint_id
                     and a.status not in ('Completed','Cancelled','Force Cancelled','Superseded')
                   order by a.created_at limit 1))
     from public.projects p
     left join public.blueprint_packages bp on bp.code = p.package_code
    where p.id = p_project) end;
$$;
revoke all on function public.portal_project_process(uuid) from public, anon;
grant execute on function public.portal_project_process(uuid) to authenticated;

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
