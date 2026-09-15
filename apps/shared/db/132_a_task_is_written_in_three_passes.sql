-- 132. A TASK IS WRITTEN IN THREE PASSES.
--
-- Shahar (2026-09-15): "on task creation - image comes next. so change this to
-- a step by step, where first step saves some info. needs to be a total of 3
-- steps. if no contract can be attached, you need to enable me create a shell
-- contract that will be used later but referenced already from the start."
--
-- The screen was one form fourteen fields long with the camera at the bottom,
-- which is exactly backwards for the way it gets used: you are standing in
-- front of the thing, you photograph it, and everything else is typed later.
-- Worse, nothing existed until Save, so a photograph taken first had no task
-- to belong to and a phone call halfway through lost the lot.
--
-- Three passes, and the FIRST ONE SAVES: what it is, then who and when, then
-- the pictures. After pass one there is a real task with a real id, so pass
-- three attaches to something rather than carrying ids in a hidden field, and
-- walking away after pass one loses nothing.
--
-- Which needed three things the database could not yet do: attach files to a
-- task that already exists, patch the fields only creation could set, and
-- make a contract that does not exist yet.

-- 1. ATTACH TO A TASK THAT ALREADY EXISTS. portal_task_create has always
-- taken p_file_ids and linked them on the way in; there was no way to do the
-- same thing a minute later. Same rule, same checks - a file has to belong to
-- the project before it can be linked to work on it.
create or replace function public.portal_task_attach(p_action_id uuid, p_file_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  me uuid := public.current_app_user_id();
  a public.actions; f uuid; n int := 0;
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.'); end if;
  if not public.can_see_action(p_action_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'reason', 'That task is not yours to add to.');
  end if;
  select * into a from public.actions where id = p_action_id;
  if not public.can_edit_project(a.project_id) then
    return jsonb_build_object('ok', false, 'code', 'READ_ONLY', 'reason', 'You have read-only access on this project.');
  end if;
  if p_file_ids is null or cardinality(p_file_ids) = 0 then
    return jsonb_build_object('ok', true, 'attached', 0);
  end if;

  foreach f in array p_file_ids loop
    if not exists (select 1 from public.files x where x.id = f and x.project_id = a.project_id) then
      return jsonb_build_object('ok', false, 'reason', 'One of those files does not belong to this project.');
    end if;
    delete from public.file_links where file_id = f;
    insert into public.file_links (file_id, action_id, role, created_by_user_id)
    values (f, a.id,
            case when (select kind from public.files where id = f) = 'photo' then 'evidence' else 'invoice' end,
            me);
    n := n + 1;
  end loop;

  return jsonb_build_object('ok', true, 'attached', n);
end $function$;

comment on function public.portal_task_attach(uuid, uuid[]) is
'Link files already uploaded and recorded (record_project_file) to an existing task. The same rule portal_task_create applies on the way in - the file has to be on the same project - so a task written in three passes can take its photographs in the third one.';

-- 2. THE FOUR FIELDS ONLY CREATION COULD SET. portal_task_edit knew the
-- subject, the outcome, the priority, the date, the stage, the status line and
-- the holder - and nothing about the contract, the trade, the photo gate or
-- the block. Which is why a task written in two passes could not have them:
-- they had to be decided in the same breath as the name or not at all.
--
-- `contract` was worse than missing: the key was simply ignored, so an app
-- could send it, get {ok: true} back and nothing would have happened.
do $patch$
declare src text; out_ text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'portal_task_edit';

  out_ := replace(src,
    E'  v_status text; v_assignee uuid; v_date date;\n',
    E'  v_status text; v_assignee uuid; v_date date;\n'
    || E'  v_contract uuid; v_trade text; v_flag boolean;\n');

  out_ := replace(out_,
    E'  if cardinality(changed) = 0 then return jsonb_build_object(\'ok\', true, \'changed\', \'[]\'::jsonb); end if;\n',
    -- WHAT IT IS AGREED UNDER. Null clears it: a task can stop belonging to a
    -- contract, which is how a mistake gets undone.
    E'  if p_patch ? \'contract\' then\n'
    || E'    v_contract := nullif(btrim(p_patch->>\'contract\'), \'\')::uuid;\n'
    || E'    if v_contract is not null and not exists (\n'
    || E'        select 1 from public.contracts c\n'
    || E'         where c.id = v_contract\n'
    || E'           and c.project_id in (select project_id from public.project_ancestry(a.project_id))) then\n'
    || E'      return jsonb_build_object(\'ok\', false, \'code\', \'NOT_ON_PROJECT\', \'reason\', \'That contract is not on this project.\');\n'
    || E'    end if;\n'
    || E'    if v_contract is distinct from a.contract_id then a.contract_id := v_contract; changed := array_append(changed, \'contract\'); end if;\n'
    || E'  end if;\n'
    || E'  if p_patch ? \'trade\' then\n'
    || E'    v_trade := nullif(btrim(p_patch->>\'trade\'), \'\');\n'
    || E'    if v_trade is not null and not exists (select 1 from public.trades t where t.trade = v_trade) then\n'
    || E'      return jsonb_build_object(\'ok\', false, \'reason\', format(\'"%s" is not a trade on file.\', v_trade));\n'
    || E'    end if;\n'
    || E'    if v_trade is distinct from a.trade then a.trade := v_trade; changed := array_append(changed, \'trade\'); end if;\n'
    || E'  end if;\n'
    || E'  if p_patch ? \'requires_photo\' then\n'
    || E'    v_flag := coalesce((p_patch->>\'requires_photo\')::boolean, false);\n'
    || E'    if v_flag is distinct from coalesce(a.requires_photo_evidence, false) then\n'
    || E'      a.requires_photo_evidence := v_flag; changed := array_append(changed, \'photo gate\');\n'
    || E'    end if;\n'
    || E'  end if;\n'
    -- A gate with nothing to gate is a tick that does nothing. Same refusal
    -- portal_task_create gives, in the same words.
    || E'  if p_patch ? \'is_gate\' then\n'
    || E'    v_flag := coalesce((p_patch->>\'is_gate\')::boolean, false);\n'
    || E'    if v_flag and a.parent_action_id is null then\n'
    || E'      return jsonb_build_object(\'ok\', false, \'code\', \'GATE_NEEDS_PARENT\',\n'
    || E'        \'reason\', \'A task that blocks its parent has to be part of one. Pick what it is part of, or leave the block off.\');\n'
    || E'    end if;\n'
    || E'    if v_flag is distinct from coalesce(a.is_gate, false) then\n'
    || E'      a.is_gate := v_flag; changed := array_append(changed, \'block\');\n'
    || E'    end if;\n'
    || E'  end if;\n'
    || E'\n'
    || E'  if cardinality(changed) = 0 then return jsonb_build_object(\'ok\', true, \'changed\', \'[]\'::jsonb); end if;\n');

  out_ := replace(out_,
    E'    assigned_to_contact_id = a.assigned_to_contact_id, assigned_to_persona_id = a.assigned_to_persona_id, assigned_to = a.assigned_to,\n',
    E'    assigned_to_contact_id = a.assigned_to_contact_id, assigned_to_persona_id = a.assigned_to_persona_id, assigned_to = a.assigned_to,\n'
    || E'    contract_id = a.contract_id, trade = a.trade,\n'
    || E'    requires_photo_evidence = a.requires_photo_evidence, is_gate = a.is_gate,\n');

  if out_ = src then
    raise exception 'portal_task_edit has drifted - none of the three patches applied.';
  end if;
  execute out_;
end $patch$;

-- 3. A CONTRACT THAT DOES NOT EXIST YET. "if no contract can be attached, you
-- need to enable me create a shell contract that will be used later but
-- referenced already from the start."
--
-- The shape is not invented here: fn_members_ensure_contract has been writing
-- exactly this row since seats became contract-bounded - status 'placeholder',
-- payable, the project's signing entity on our side, the trade if there is
-- one, and no value, no scope, nothing agreed. Seventeen of them exist. This
-- is the same row, made deliberately from a screen instead of as a side
-- effect of seating somebody.
--
-- IT STILL NEEDS SOMEBODY ON THE OTHER SIDE, and that is the database's rule
-- rather than a choice made here: chk_contracts_one_counterparty says exactly
-- one of a company or a contact. A contract with nobody on the other end is
-- not a shell of a contract, it is a note - so this asks who, and takes a
-- company NAME when the person is not on file yet.
create or replace function public.portal_contract_shell(
  p_project uuid, p_title text default null, p_trade text default null,
  p_counterparty uuid default null, p_company_name text default null,
  p_amount numeric default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  me uuid := public.current_app_user_id();
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_trade text := nullif(btrim(coalesce(p_trade, '')), '');
  v_co    text := nullif(btrim(coalesce(p_company_name, '')), '');
  v_entity uuid; v_signer_contact uuid; v_company uuid; v_who text; v_id uuid;
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.'); end if;
  if not public.can_edit_project(p_project) then
    return jsonb_build_object('ok', false, 'reason', 'Adding a contract to this job is not yours to do.');
  end if;
  if v_trade is not null and not exists (select 1 from public.trades t where t.trade = v_trade) then
    return jsonb_build_object('ok', false, 'reason', format('"%s" is not a trade on file.', v_trade));
  end if;
  if p_amount is not null and p_amount < 0 then
    return jsonb_build_object('ok', false, 'reason', 'A contract value is a positive number, or nothing at all.');
  end if;

  if p_counterparty is not null then
    select coalesce(c.person_name, c.name) into v_who
      from public.contacts c where c.id = p_counterparty and c.disabled_at is null;
    if v_who is null then
      return jsonb_build_object('ok', false, 'reason', 'That person is not on file.');
    end if;
  elsif v_co is not null then
    select id into v_company from public.companies
     where lower(btrim(company_name)) = lower(v_co) limit 1;
    if v_company is null then
      begin
        insert into public.companies (company_name, source, created_by, needs_review)
        values (v_co, 'pro-app:shell-contract', 'pro-app:shell-contract', true)
        returning id into v_company;
      exception when unique_violation then
        select id into v_company from public.companies
         where lower(btrim(company_name)) = lower(v_co) limit 1;
      end;
    end if;
    v_who := v_co;
  else
    return jsonb_build_object('ok', false, 'code', 'NEEDS_PARTY',
      'reason', 'Say who it will be with - somebody on the job, or a company name. A contract with nobody on the other side is a note, not a contract.');
  end if;

  -- Our side. The project's signing entity where there is one; failing that
  -- the person making it, because the constraint wants exactly one signer and
  -- an unsigned shell is still better than no record of the commitment.
  v_entity := public.project_signing_entity(p_project);
  if v_entity is null then
    select u.contact_id into v_signer_contact from public.app_users u where u.id = me;
    if v_signer_contact is null then
      return jsonb_build_object('ok', false, 'reason',
        'This job has no signing entity set, so there is nothing to put on our side of a contract yet.');
    end if;
  end if;

  insert into public.contracts
    (title, contract_type, status, direction, project_id, trade, amount,
     signer_company_id, signer_contact_id, counterparty_company_id, counterparty_contact_id,
     created_by, last_modified_by, notes)
  values (
    coalesce(v_title, v_who || coalesce(' - ' || v_trade, '') || ' (placeholder)'),
    case when v_trade is not null then 'construction trade contract' else 'service agreement' end,
    'placeholder', 'payable', p_project, v_trade, p_amount,
    v_entity, v_signer_contact, v_company, p_counterparty,
    'pro-app:shell-contract', 'pro-app:shell-contract',
    'Shell contract, made from the task screen so the work is contract-bounded from the start. '
    || 'Status is placeholder: no value agreed, no scope, nothing signed. Replace the terms when the real '
    || 'agreement exists - do not create a second contract.')
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'who', v_who, 'trade', v_trade,
    'label', coalesce(v_title, v_who || coalesce(' - ' || v_trade, '')) || ' (placeholder)');
end $function$;

comment on function public.portal_contract_shell(uuid, text, text, uuid, text, numeric) is
'Make a placeholder contract deliberately, from a screen - the same row fn_members_ensure_contract writes as a side effect of seating somebody: payable, status placeholder, the project''s signing entity on our side, no value and no scope. Needs a counterparty (a contact on file, or a company name it will create), because chk_contracts_one_counterparty says a contract has exactly one other side.';

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
