-- THE ATTIC. Not a migration - never run this file.
--
-- Migration 022 dropped 45 functions nothing calls. Most were either the
-- deleted contractor site's token API (the 22 app_*) or superseded by a
-- function the app actually calls, so their loss costs nothing: the
-- replacement is live and better.
--
-- These eight are the exceptions - uncalled, but NOT superseded by anything
-- wired, and not cheap to re-derive from memory. They are kept here verbatim
-- so the drop is reversible: paste one back if the surface it belonged to
-- comes back. Everything else is in the migration's comment by name.
--
--   can_see_contract_money   the per-contract money gate; rulebook 70 names
--                            can_view_project_financials instead, so this was
--                            a second answer to a question already answered
--   file_unfile              detach a file from a task/contract and re-file it
--                            on the project; portal_project_file_delete only
--                            deletes
--   fn_propose_space_scope   walks blueprint_spaces + item_dependencies to
--                            SUGGEST scope for a room. The scope surface was
--                            rebuilt around portal_scope_candidates, which
--                            does not do the dependency walk - this is the
--                            only place that logic exists
--   log_persona_action_event a trigger function attached to no trigger.
--                            log_action_event now logs assignment at INSERT,
--                            which is exactly what this did
--   project_files            the old files-tab payload; portal_brief_files is
--                            the live one
--   record_project_photo     photo upload with a path guard; record_project_file
--                            and homeowner_photo_add both supersede it
--   set_portal_domains       saves app_users.portal_domains, the per-user
--                            domain filter. portal_tasks still takes p_domain,
--                            so the filter exists - only the saved preference
--                            is unwired
--   start_participation      creates a project_participants row and the parent
--                            "Hire <trade> contractor" action, letting
--                            trg_actions_expand_blueprint generate the steps.
--                            The bid flow (portal_bid_*) took over hiring
--
-- Archived 2026-09-09.

-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_see_contract_money(p_contract_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.is_superadmin() or exists (
    select 1 from public.contracts c
     where c.id = p_contract_id
       and public.is_project_member(c.project_id)
       and case when public.is_contract_bounded_member(c.project_id)
                then public.my_authority_rank(c.project_id) >= 40
                     and c.id in (select contract_id from public.my_contract_ids(c.project_id))
                else public.can_view_project_financials(c.project_id) end)
$function$;

-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.file_unfile(p_file_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := public.current_app_user_id(); v_proj uuid; v_kind text;
begin
  perform public.assert_own_hands();
  select project_id, kind into v_proj, v_kind from public.files where id = p_file_id;
  if v_proj is null or not public.can_see_file(p_file_id) then
    return jsonb_build_object('ok', false, 'reason', 'That file is not yours.');
  end if;
  if not public.can_edit_project(v_proj) then
    return jsonb_build_object('ok', false, 'reason', 'You have read-only access on this project.');
  end if;
  delete from public.file_links where file_id = p_file_id;
  insert into public.file_links (file_id, project_id, role, created_by_user_id)
  values (p_file_id, v_proj, case when v_kind = 'photo' then 'progress' else 'reference' end, me);
  return jsonb_build_object('ok', true);
end $function$;

-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_propose_space_scope(p_project_id uuid, p_space_type text, p_min_relevance integer DEFAULT 0)
 RETURNS TABLE(item_id uuid, item text, trade text, category text, relevance integer, from_space text, suggestion text, required_by text, dependency_reason text, already_on_project boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with recursive chain as (
    select code, parent_code, 0 as depth from blueprint_spaces where code = p_space_type
    union all
    select s.code, s.parent_code, c.depth + 1 from blueprint_spaces s
      join chain c on s.code = c.parent_code
  ),
  seeded as (
    select ic.id, ic.name, ic.trade, ic.category, bsi.relevance,
           bsi.space_type, ch.depth
    from blueprint_space_items bsi
    join chain ch on ch.code = bsi.space_type
    join item_catalogue ic on ic.id = bsi.item_id
    where bsi.relevance >= p_min_relevance
  ),
  deps as (
    select req.id, req.name, req.trade, req.category,
           case when d.strength = 'requires' then 100 else 60 end as relevance,
           'dependency' as space_type, 99 as depth,
           parent.name as required_by, d.reason, d.strength
    from seeded s
    join item_dependencies d on d.item_id = s.id
    join item_catalogue parent on parent.id = d.item_id
    join item_catalogue req on req.id = d.requires_item_id
  )
  select s.id, s.name, s.trade, s.category, s.relevance,
         s.space_type,
         case when s.relevance >= 80 then 'default yes'
              when s.relevance >= 50 then 'ask'
              else 'rarely' end,
         null::text, null::text,
         exists (select 1 from project_scope_items x
                 where x.project_id = p_project_id and x.item = s.name)
  from seeded s
  union all
  select d.id, d.name, d.trade, d.category, d.relevance,
         d.space_type,
         case when d.strength = 'requires' then 'auto-add if parent chosen'
              else 'ask if parent chosen' end,
         d.required_by, d.reason,
         exists (select 1 from project_scope_items x
                 where x.project_id = p_project_id and x.item = d.name)
  from deps d
  order by 7, 5 desc, 3, 2;
$function$;

-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_persona_action_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.assigned_by is not null and new.assigned_to is not null then
    insert into public.action_events (action_id, event_type, from_value, to_value, actor)
    values (new.id, 'assignment', null, new.assigned_to, new.assigned_by);
  end if;
  return new;
end $function$;

-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.project_files(p_project_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v jsonb; v_contracts jsonb;
begin
  if not public.is_project_member(p_project_id) then return null; end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'trade', c.trade)
                            order by c.trade, c.title), '[]'::jsonb)
    into v_contracts
    from public.contracts c
   where c.project_id = p_project_id
     and public.can_see_contract(c.id);

  select jsonb_build_object(
    'can_edit', public.can_edit_project(p_project_id),
    'contracts', v_contracts,
    'files', coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb)
  ) into v
  from (
    select jsonb_build_object(
             'id', f.id, 'bucket', f.bucket, 'path', f.path,
             'name', coalesce(f.file_name, right(f.path, 40)),
             'kind', f.kind, 'mime', f.mime_type, 'size', f.size_bytes,
             'caption', f.caption, 'created_at', f.created_at,
             'by', coalesce(u.full_name, u.email, 'someone'),
             'link_id', fl.id, 'role', fl.role,
             'filed', (fl.action_id is not null or fl.contract_id is not null
                       or fl.payment_stage_id is not null or fl.project_scope_item_id is not null),
             'action_id', fl.action_id, 'action', a.action,
             'contract_id', fl.contract_id, 'contract', c.title
           ) as x
      from public.files f
      join public.file_links fl on fl.file_id = f.id
      left join public.app_users u on u.id = f.uploaded_by_user_id
      left join public.actions a   on a.id = fl.action_id
      left join public.contracts c on c.id = fl.contract_id
     where f.project_id = p_project_id and f.is_latest and public.can_see_file(f.id)
  ) s;

  return v;
end $function$;

-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_project_photo(p_project_id uuid, p_path text, p_file_name text, p_mime text DEFAULT NULL::text, p_size bigint DEFAULT NULL::bigint, p_caption text DEFAULT NULL::text, p_action_id uuid DEFAULT NULL::uuid, p_role text DEFAULT 'evidence'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
  perform public.assert_own_hands();
  if not public.can_edit_project(p_project_id) then
    raise exception 'PHOTO_DENIED: you may not add files to this project' using errcode = 'P0001';
  end if;
  if p_path is null or p_path not like (p_project_id::text || '/%') then
    raise exception 'PHOTO_BAD_PATH: must live under %/', p_project_id using errcode = 'P0001';
  end if;
  if p_action_id is not null and not public.can_see_action(p_action_id) then
    raise exception 'PHOTO_UNKNOWN_TASK' using errcode = 'P0001';
  end if;
  if p_role not in ('before','after','evidence','progress') then
    raise exception 'PHOTO_BAD_ROLE: %', p_role using errcode = 'P0001';
  end if;

  insert into public.files (project_id, bucket, path, file_name, mime_type, size_bytes,
                            kind, caption, visibility, uploaded_by_user_id,
                            uploaded_by_contact_id, taken_at)
  values (p_project_id, 'project-media', p_path, p_file_name, p_mime, p_size,
          'photo', p_caption, 'internal', public.current_app_user_id(),
          public.my_contact_id(), now())
  returning id into v_id;

  -- file_links is XOR across targets, so a photo is linked to the TASK when one
  -- was named and to the project otherwise.
  if p_action_id is not null then
    insert into public.file_links (file_id, role, action_id, created_by_user_id)
    values (v_id, p_role, p_action_id, public.current_app_user_id());
  else
    insert into public.file_links (file_id, role, project_id, created_by_user_id)
    values (v_id, 'progress', p_project_id, public.current_app_user_id());
  end if;

  return v_id;
end $function$;

-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_portal_domains(p_domains text[])
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := public.current_app_user_id(); v text[];
begin
  perform public.assert_own_hands();
  if me is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  -- An empty selection means "no filter", not "show me nothing" - a dashboard
  -- that silently hides every project looks broken rather than configured.
  if p_domains is null or cardinality(p_domains) = 0 then
    v := null;
  else
    select array_agg(d.name order by d.name) into v
      from public.domains d
     where d.name = any(p_domains) and d.is_active;
    if v is null then
      raise exception 'PREF_UNKNOWN_DOMAIN' using errcode = 'P0001';
    end if;
  end if;

  update public.app_users set portal_domains = v, last_modified_at = now() where id = me;
  return v;
end $function$;

-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_participation(p_trade text, p_project uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  eng_id uuid;
  v_type_id uuid;
  v_parent_id uuid;
BEGIN
  SELECT id INTO eng_id FROM project_participants WHERE trade=p_trade AND project_id=p_project LIMIT 1;
  IF eng_id IS NULL THEN
    INSERT INTO project_participants (trade, project_id, stage, created_by)
    VALUES (p_trade, p_project, 'bid', 'playbook') RETURNING id INTO eng_id;
  END IF;

  SELECT id INTO v_type_id FROM blueprint_activity
  WHERE name = 'Hire contractor' AND is_active LIMIT 1;
  IF v_type_id IS NULL THEN
    RAISE EXCEPTION 'start_participation: no active Hire contractor activity blueprint found';
  END IF;

  SELECT id INTO v_parent_id FROM actions
  WHERE engagement_id = eng_id
    AND activity_blueprint_id = v_type_id
  LIMIT 1;

  IF v_parent_id IS NULL THEN
    INSERT INTO actions (
      action, status, priority, domain, project_id, engagement_id,
      depth_level, activity_blueprint_id, source, created_by, notes
    )
    VALUES (
      'Hire ' || p_trade || ' contractor',
      'Not Started', 'High', 'construction',
      p_project, eng_id, 2, v_type_id, 'playbook', 'playbook',
      'Created by start_participation. Child steps are generated automatically from the Hire contractor activity blueprint by trg_actions_expand_blueprint.'
    )
    RETURNING id INTO v_parent_id;
  END IF;

  RETURN eng_id;
END;
$function$;
