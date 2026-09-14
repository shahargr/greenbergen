-- 095 - One status line replaces three pending fields.
--
-- Shahar (2026-09-14): "a. take content from pending on, why and type column
-- and merge into Status (text field). b. delete Pending on, why and type
-- fields."
--
-- Three fields asked three questions to describe one thing - who has the ball,
-- what for, and which flavour of waiting it is - and the screen made you fill
-- two of them before it would let you save. Across 504 tasks they had been
-- used 9, 23 and 6 times. One line, in your own words, says all of it.
--
-- On the name: actions.status already exists and holds 'In Progress',
-- 'Pending on Others' and friends - what the screen calls STAGE. The new field
-- is what the screen calls STATUS. Two things called status in one table is a
-- trap, so the column is status_note and only the label says Status.
--
-- It is a STANDING statement, not a log entry: "Waiting on Steve at Andersen
-- for the revised quote", overwritten when that stops being true. The running
-- history stays where it has always been, in action_events and the comments.

alter table public.actions add column if not exists status_note text;

comment on column public.actions.status_note is
  'Where this task stands right now, in one line - who holds the ball and what for. Overwritten, not appended; the history lives in action_events. Labelled "Status" on screen, while actions.status is labelled "Stage".';

-- The merge. pending_on was a person, pending_reason the reason, and
-- pending_category one of decision/financial/inspection. Read back as a
-- sentence they say the same thing they always meant.
update public.actions
   set status_note = nullif(btrim(concat_ws(' — ',
         case when nullif(btrim(pending_on), '') is not null
              then 'Waiting on ' || btrim(pending_on) end,
         nullif(btrim(pending_reason), ''),
         case when nullif(btrim(pending_category), '') is not null
              then '(' || btrim(pending_category) || ')' end)), '')
 where status_note is null
   and (nullif(btrim(pending_on), '') is not null
     or nullif(btrim(pending_reason), '') is not null
     or nullif(btrim(pending_category), '') is not null);

-- ------------------------------------------------- the functions that read --
do $patch$
declare j record; src text; patched text; found int;
begin
  for j in
    select * from (values
      -- The blueprint push wrote a reason and a category; the category folds
      -- into the sentence.
      ('fn_propagate_blueprint_trade_item',
       $f$(action, status, pending_reason, pending_category, priority, project_id,$f$,
       $f$(action, status, status_note, priority, project_id,$f$, 1),
      ('fn_propagate_blueprint_trade_item',
       $f$not a text edit.',$f$,
       $f$not a text edit. (decision)',$f$, 1),
      ('fn_propagate_blueprint_trade_item',
       $f$'decision', 'High', proj.id$f$,
       $f$'High', proj.id$f$, 1),

      -- The payment-chase task: same value, new column name.
      ('fn_transactions_notify_task',
       $f$action, status, pending_reason, priority, domain, project_id, contract_id, asset_id,$f$,
       $f$action, status, status_note, priority, domain, project_id, contract_id, asset_id,$f$, 1),

      -- The change log treats it as prose, so a long status reads as a diff
      -- rather than a before/after pair.
      ('log_action_event',
       $f$array['action','notes','desired_outcome','pending_reason']$f$,
       $f$array['action','notes','desired_outcome','status_note']$f$, 1),
      ('log_action_event',
       $f$when 'desired_outcome' then NEW.desired_outcome else NEW.pending_reason end;$f$,
       $f$when 'desired_outcome' then NEW.desired_outcome else NEW.status_note end;$f$, 1),
      ('log_action_event',
       $f$when 'desired_outcome' then OLD.desired_outcome else OLD.pending_reason end;$f$,
       $f$when 'desired_outcome' then OLD.desired_outcome else OLD.status_note end;$f$, 1),

      -- The task screen gets one key where it had three.
      ('portal_task_detail',
       $f$'pending_on', a.pending_on, 'pending_reason', a.pending_reason, 'pending_category', a.pending_category,$f$,
       $f$'status_note', a.status_note,$f$, 1),

      -- These two publish the value under its old key, which their callers
      -- (the homeowner app's booking view, the public project page) are typed
      -- against. The COLUMN is what Shahar asked to delete; renaming their
      -- output too would break two apps for no gain today.
      ('homeowner_booking',
       $f$'pending_reason', a.pending_reason,$f$,
       $f$'pending_reason', a.status_note,$f$, 1),
      ('project_overview',
       $f$a.completed_on, a.desired_outcome, a.pending_reason,$f$,
       $f$a.completed_on, a.desired_outcome, a.status_note as pending_reason,$f$, 1)
    ) as v(fn, pat, rep, hits)
  loop
    select pg_get_functiondef(p.oid) into src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = j.fn;
    if src is null then raise exception 'PATCH_NO_FUNCTION: public.%', j.fn; end if;

    found := (length(src) - length(replace(src, j.pat, ''))) / length(j.pat);
    if found <> j.hits then
      raise exception 'PATCH_COUNT: % in % appears % time(s), expected %', j.pat, j.fn, found, j.hits;
    end if;
    execute replace(src, j.pat, j.rep);
  end loop;
end $patch$;

-- ------------------------------------------------ the function that writes --
-- portal_task_edit accepted three keys and refused to save a Pending task
-- without a reason. Now it takes one, and the rule it enforces is the honest
-- version of the old one: if you park a task on somebody else, say where it
-- stands.
create or replace function public.portal_task_edit(p_action_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  a public.actions; me uuid := public.current_app_user_id();
  v_status text; v_assignee uuid; v_date date;
  changed text[] := '{}';
begin
  perform public.assert_own_hands();
  if me is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.can_see_action(p_action_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'reason', 'That task is not yours to edit.');
  end if;
  select * into a from public.actions where id = p_action_id;
  if not public.can_edit_project(a.project_id) then
    return jsonb_build_object('ok', false, 'code', 'READ_ONLY', 'reason', 'You have read-only access on this project.');
  end if;
  if a.status in ('Completed','Cancelled','Force Cancelled') then
    return jsonb_build_object('ok', false, 'code', 'CLOSED', 'reason', 'This task is ' || lower(a.status) || '. Reopening is a portal action.');
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'BAD_PATCH', 'reason', 'Nothing to change.');
  end if;

  if p_patch ? 'action' then
    if nullif(btrim(p_patch->>'action'), '') is null then
      return jsonb_build_object('ok', false, 'code', 'NO_SUBJECT', 'reason', 'A task needs a subject.');
    end if;
    if btrim(p_patch->>'action') is distinct from a.action then
      a.action := btrim(p_patch->>'action'); changed := array_append(changed, 'subject');
    end if;
  end if;
  if p_patch ? 'desired_outcome' and nullif(btrim(p_patch->>'desired_outcome'), '') is distinct from a.desired_outcome then
    a.desired_outcome := nullif(btrim(p_patch->>'desired_outcome'), ''); changed := array_append(changed, 'outcome');
  end if;
  if p_patch ? 'priority' and nullif(btrim(p_patch->>'priority'), '') is distinct from a.priority then
    a.priority := coalesce(nullif(btrim(p_patch->>'priority'), ''), 'Missing'); changed := array_append(changed, 'priority');
  end if;
  if p_patch ? 'target_date' then
    begin
      v_date := nullif(btrim(p_patch->>'target_date'), '')::date;
    exception when others then
      return jsonb_build_object('ok', false, 'code', 'BAD_DATE', 'reason', 'That is not a date.');
    end;
    if v_date is distinct from a.target_date then a.target_date := v_date; changed := array_append(changed, 'completion target'); end if;
  end if;
  if p_patch ? 'status' then
    v_status := btrim(p_patch->>'status');
    if lower(v_status) in ('completed','done','complete','closed','cancelled','canceled','force cancelled') then
      return jsonb_build_object('ok', false, 'code', 'USE_CLOSE', 'reason', 'Use Mark complete to close a task - it records the why and the photo.');
    end if;
    if v_status is distinct from a.status then a.status := v_status; changed := array_append(changed, 'stage'); end if;
  end if;
  if p_patch ? 'status_note' and nullif(btrim(p_patch->>'status_note'), '') is distinct from a.status_note then
    a.status_note := nullif(btrim(p_patch->>'status_note'), ''); changed := array_append(changed, 'status');
  end if;
  -- Parking a task on somebody else without saying where it stands leaves the
  -- next person nothing to act on. Same rule as before, one field instead of two.
  if a.status like '%Pending%' and nullif(btrim(coalesce(a.status_note, '')), '') is null then
    return jsonb_build_object('ok', false, 'code', 'NEEDS_STATUS', 'reason', 'Pending on Others needs a status - who you are waiting on, and what for.');
  end if;
  if p_patch ? 'assignee' then
    v_assignee := nullif(btrim(p_patch->>'assignee'), '')::uuid;
    if v_assignee is not null and not exists (
        select 1 from public.project_members pm
         where pm.project_id in (select project_id from public.project_ancestry(a.project_id))
           and pm.status = 'active'
           and coalesce(pm.contact_id, (select u.contact_id from public.app_users u where u.id = pm.app_user_id)) = v_assignee) then
      return jsonb_build_object('ok', false, 'code', 'NOT_ON_PROJECT', 'reason', 'That person is not on this project.');
    end if;
    if v_assignee is distinct from a.assigned_to_contact_id then
      a.assigned_to_contact_id := v_assignee;
      if v_assignee is not null then a.assigned_to_persona_id := null; a.assigned_to := null; end if;
      changed := array_append(changed, 'assignee');
    end if;
  end if;

  if cardinality(changed) = 0 then return jsonb_build_object('ok', true, 'changed', '[]'::jsonb); end if;

  update public.actions set
    action = a.action, desired_outcome = a.desired_outcome, priority = a.priority, target_date = a.target_date,
    status = a.status, status_note = a.status_note,
    assigned_to_contact_id = a.assigned_to_contact_id, assigned_to_persona_id = a.assigned_to_persona_id, assigned_to = a.assigned_to,
    last_updated = now(), last_modified_by = 'portal:task-edit'
  where id = a.id;

  return jsonb_build_object('ok', true, 'changed', to_jsonb(changed));
end $function$;

-- ------------------------------------------------------------- and they go --
alter table public.actions drop column pending_on;
alter table public.actions drop column pending_reason;
alter table public.actions drop column pending_category;

do $$
declare n int; names text;
begin
  select count(*), string_agg(p.proname, ', ') into n, names
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and pg_get_functiondef(p.oid) ~* '\m(pending_on|pending_category)\M';
  if n > 0 then
    raise exception 'STILL_REFERENCED: %', names;
  end if;
end $$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
