-- THE GAS SURVEY READS AND WRITES, AND GOES WITH THE BID.
--
-- 228 built the table. This is the door onto it, and the door is the reason
-- the last line of Shahar's note - "this info be sent along the bid" - needs
-- no new machinery at all.
--
-- portal_scope_evidence already lets a BIDDER see a project's scope photos:
--
--   is_project_member(p) or bid_is_bidder_on(p) or is_superadmin()
--
-- That third clause is how an invited contractor sees the job without being
-- on it. The survey uses the same gate, so the plumber you invite to quote
-- the gas line opens the room and finds the house's appliance list already
-- there, with the plate photographs - no attaching, no forwarding, and no
-- second copy that can go stale.
--
-- THE TOTAL IS REPORTED AS PARTIAL WHEN IT IS PARTIAL. Adding up four of
-- eight appliances and calling it "the connected load" is how somebody
-- answers step 20 - does the meter carry the house plus the generator? -
-- with a number that is too small, and a meter upsize discovered late is the
-- single longest delay on this job. So the survey hands back answered-of-8
-- next to the sum, and a bid room showing the sum without the caveat is a
-- bug in that screen.

-- ---- read -----------------------------------------------------------------
create or replace function public.portal_gas_survey(p_project uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $fn$
  with gate as (
    select public.is_project_member(p_project)
        or public.bid_is_bidder_on(p_project)
        or public.is_superadmin() as ok),
  house as (
    select pr.asset_id, a.asset_name
      from public.projects pr
      left join public.assets a on a.id = pr.asset_id
     where pr.id = p_project),
  row_ as (
    select k.key, k.label, k.sort_order, k.typical_btuh_low, k.typical_btuh_high, k.hint,
           ga.id, ga.present, ga.manufacturer, ga.model, ga.input_btuh, ga.fuel,
           ga.location, ga.note, ga.surveyed_at, ga.surveyed_by
      from public.gas_appliance_kinds k
      left join house h on true
      left join public.gas_appliances ga
             on ga.asset_id = h.asset_id and ga.kind = k.key)
  select case when not (select ok from gate) then null else
    jsonb_build_object(
      'asset_id', (select asset_id from house),
      'house',    (select asset_name from house),
      -- No asset on the job means nowhere to keep this. The screen says so
      -- rather than showing eight fields that cannot be saved.
      'can_survey', (select asset_id is not null from house),
      'of',       (select count(*) from public.gas_appliance_kinds),
      'answered', (select count(*) from row_ where present is not null),
      'present_n',(select count(*) from row_ where present),
      -- Only what is actually there, and only where somebody gave a rating.
      'total_btuh', coalesce((select sum(input_btuh) from row_ where present and input_btuh is not null), 0),
      'rated_n',  (select count(*) from row_ where present and input_btuh is not null),
      -- True whenever the sum cannot be trusted as the whole load: something
      -- unanswered, or present with no rating on it.
      'total_is_partial', (select exists (select 1 from row_ where present is null)
                                or exists (select 1 from row_ where present and input_btuh is null)),
      'rows', coalesce((select jsonb_agg(jsonb_build_object(
          'kind', r.key, 'label', r.label, 'hint', r.hint,
          'typical_low', r.typical_btuh_low, 'typical_high', r.typical_btuh_high,
          'id', r.id, 'present', r.present, 'manufacturer', r.manufacturer,
          'model', r.model, 'input_btuh', r.input_btuh, 'fuel', r.fuel,
          'location', r.location, 'note', r.note,
          'surveyed_at', r.surveyed_at, 'surveyed_by', r.surveyed_by,
          'photos', coalesce((
            select jsonb_agg(jsonb_build_object(
              'file_id', f.id, 'file_name', f.file_name, 'kind', f.kind,
              'mime', f.mime_type, 'bucket', f.bucket, 'path', f.path,
              'role', fl.role, 'at', fl.created_at)
              order by fl.created_at desc)
            from public.file_links fl join public.files f on f.id = fl.file_id
           where fl.gas_appliance_id = r.id), '[]'::jsonb))
          order by r.sort_order)
        from row_ r), '[]'::jsonb))
  end;
$fn$;

comment on function public.portal_gas_survey(uuid) is
  'What the house at this project burns: every appliance kind, answered or not, with its plate photographs. Readable by anyone on the job AND by an invited bidder - the same gate portal_scope_evidence uses - which is how the survey travels with the bid. total_is_partial says whether the sum can be trusted as the whole connected load.';

revoke all on function public.portal_gas_survey(uuid) from public, anon;
grant execute on function public.portal_gas_survey(uuid) to authenticated, service_role;

-- ---- write ----------------------------------------------------------------
create or replace function public.portal_gas_appliance_save(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_project uuid; v_asset uuid; v_kind text; v_present boolean; v_id uuid;
begin
  v_project := nullif(p->>'project_id', '')::uuid;
  v_kind    := nullif(trim(p->>'kind'), '');
  if v_project is null then raise exception 'Which job?'; end if;
  if not (public.can_edit_project(v_project) or public.is_superadmin()) then
    raise exception 'Not allowed to edit this project';
  end if;
  if not exists (select 1 from public.gas_appliance_kinds where key = v_kind) then
    raise exception 'There is no gas appliance called %', coalesce(v_kind, '(none)');
  end if;

  select asset_id into v_asset from public.projects where id = v_project;
  if v_asset is null then
    raise exception 'This job is not attached to a property, so there is nowhere to keep the survey.';
  end if;

  -- Three answers, and the difference matters all the way into the bid:
  -- true = it is there, false = asked and there is none, null = not asked.
  v_present := case when p ? 'present' and p->>'present' is not null
                    then (p->>'present')::boolean else null end;

  insert into public.gas_appliances as g
    (asset_id, kind, present, manufacturer, model, input_btuh, fuel, location, note,
     surveyed_at, surveyed_by, created_by, last_modified_by)
  values (v_asset, v_kind, v_present,
          case when v_present then nullif(trim(p->>'manufacturer'), '') end,
          case when v_present then nullif(trim(p->>'model'), '') end,
          case when v_present then nullif(p->>'input_btuh', '')::numeric end,
          nullif(trim(p->>'fuel'), ''),
          nullif(trim(p->>'location'), ''),
          nullif(trim(p->>'note'), ''),
          case when v_present is not null then now() end,
          public.current_app_user_id()::text,
          public.current_app_user_id()::text,
          public.current_app_user_id()::text)
  on conflict (asset_id, kind) do update set
    present      = excluded.present,
    -- An appliance answered "not there" drops whatever was recorded about it,
    -- which is also what the table's own check constraint insists on.
    manufacturer = case when excluded.present then coalesce(excluded.manufacturer, g.manufacturer) end,
    model        = case when excluded.present then coalesce(excluded.model, g.model) end,
    input_btuh   = case when excluded.present then coalesce(excluded.input_btuh, g.input_btuh) end,
    fuel         = coalesce(excluded.fuel, g.fuel),
    location     = coalesce(excluded.location, g.location),
    note         = excluded.note,
    surveyed_at  = coalesce(excluded.surveyed_at, g.surveyed_at),
    surveyed_by  = coalesce(excluded.surveyed_by, g.surveyed_by),
    last_modified_at = now(),
    last_modified_by = public.current_app_user_id()::text
  returning g.id into v_id;

  return public.portal_gas_survey(v_project);
end;
$fn$;

revoke all on function public.portal_gas_appliance_save(jsonb) from public, anon;
grant execute on function public.portal_gas_appliance_save(jsonb) to authenticated, service_role;

-- ---- the plate photograph -------------------------------------------------
create or replace function public.portal_gas_photo_attach(p_file_id uuid, p_gas_appliance uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_asset uuid; v_project uuid;
begin
  select asset_id into v_asset from public.gas_appliances where id = p_gas_appliance;
  if v_asset is null then raise exception 'No such appliance'; end if;

  -- The file was uploaded against a project, and the appliance belongs to a
  -- house. They have to be the same house, or a photograph from one address
  -- could be filed against another.
  select f.project_id into v_project
    from public.files f join public.projects pr on pr.id = f.project_id
   where f.id = p_file_id and pr.asset_id = v_asset;
  if v_project is null then
    raise exception 'That file does not belong to a job at this property';
  end if;
  if not (public.is_project_member(v_project) or public.is_superadmin()) then
    raise exception 'You are not on this project';
  end if;

  insert into public.file_links (file_id, role, project_id, gas_appliance_id, created_by_user_id)
  values (p_file_id, 'evidence', v_project, p_gas_appliance, public.current_app_user_id());

  return public.portal_gas_survey(v_project);
end;
$fn$;

revoke all on function public.portal_gas_photo_attach(uuid, uuid) from public, anon;
grant execute on function public.portal_gas_photo_attach(uuid, uuid) to authenticated, service_role;
