-- EVERY TRADE HANDS OVER ITS ASSETS.
--
-- Shahar, 2026-09-22: "each project needs to have a list of assets,
-- including: installation date, installed by, part number, serial number,
-- warranty, image installed. add this to the trade blue print as requirement.
-- contractor to have an interface to log all this information, so we push the
-- work to him."
--
-- 231 built the register and four of the six fields were already there.
-- The two that were not are the two that matter most in an argument:
--
--   INSTALLED BY - a serial number tells you what failed; who put it in
--   tells you whose warranty answers for it. assets had no column for it.
--
--   IMAGE INSTALLED - file_links reaches an action, a scope line, a bid
--   package, a transaction, and since 228 a gas appliance. It has never
--   reached an ASSET, so a photograph of the thing on the wall had nowhere
--   to hang.
--
-- AND IT BECOMES A REQUIREMENT, not a hope. blueprint_trade carries a bucket
-- called ALL - forty-four lines that land in every trade's scope, whatever
-- the trade - and that is where this belongs: it is not a plumbing rule or an
-- electrical rule, it is the deal. add_to_contract puts it in front of the
-- contractor before he signs, which is the only moment the work can honestly
-- be pushed to him.

-- ---- who put it in --------------------------------------------------------
alter table public.assets
  add column if not exists installed_by_contact_id uuid references public.contacts(id);

comment on column public.assets.installed_by_contact_id is
  'Who installed it. The serial number says what failed; this says whose warranty answers for it.';

-- ---- a photograph of the thing itself -------------------------------------
alter table public.file_links
  add column if not exists asset_id uuid references public.assets(id) on delete cascade;

create index if not exists file_links_asset_idx
  on public.file_links (asset_id) where asset_id is not null;

-- file_links' RLS resolves a row to a project. A part hangs off the house, and
-- the house may carry several jobs, so it resolves through the house to the
-- oldest live project there - the same route 228 took for a gas appliance.
do $mig$
declare
  src text; n int;
  a constant text := $q$    (select pr.id from public.gas_appliances ga$q$;
  b constant text := $q$    (select pr.id from public.assets ast
       join public.projects pr on pr.asset_id = ast.parent_asset_id and pr.trashed_at is null
      where ast.id = p_link.asset_id
      order by pr.created_at limit 1),
    (select pr.id from public.gas_appliances ga$q$;
begin
  src := pg_get_functiondef('public.file_link_project_id(public.file_links)'::regprocedure);
  n := (length(src) - length(replace(src, a, ''))) / length(a);
  if n <> 1 then raise exception 'The gas-appliance clause matched % times, expected 1.', n; end if;
  execute replace(src, a, b);
end $mig$;

-- ---- the register carries both -------------------------------------------
do $mig$
declare
  src text; n int;
  a1 constant text := $q$           a.warranty_doc_url, a.warranty_status,
           pr.manufacturer, pr.model, pr.part_number, pr.spec_url, pr.trade$q$;
  b1 constant text := $q$           a.warranty_doc_url, a.warranty_status,
           a.installed_by_contact_id,
           (select coalesce(ct.person_name, ct.name) from public.contacts ct
             where ct.id = a.installed_by_contact_id) as installed_by,
           pr.manufacturer, pr.model, pr.part_number, pr.spec_url, pr.trade$q$;
  a2 constant text := $q$        'part_number', p.part_number, 'spec_url', p.spec_url, 'trade', p.trade)$q$;
  b2 constant text := $q$        'part_number', p.part_number, 'spec_url', p.spec_url, 'trade', p.trade,
        'installed_by', p.installed_by, 'installed_by_contact_id', p.installed_by_contact_id,
        'photos', coalesce((
          select jsonb_agg(jsonb_build_object(
            'file_id', f.id, 'file_name', f.file_name, 'kind', f.kind,
            'mime', f.mime_type, 'bucket', f.bucket, 'path', f.path, 'at', fl.created_at)
            order by fl.created_at desc)
          from public.file_links fl join public.files f on f.id = fl.file_id
         where fl.asset_id = p.id), '[]'::jsonb))$q$;
begin
  src := pg_get_functiondef('public.portal_warranties(uuid)'::regprocedure);
  n := (length(src) - length(replace(src, a1, ''))) / length(a1);
  if n <> 1 then raise exception 'The part CTE matched % times, expected 1.', n; end if;
  n := (length(src) - length(replace(src, a2, ''))) / length(a2);
  if n <> 1 then raise exception 'The part row matched % times, expected 1.', n; end if;
  execute replace(replace(src, a1, b1), a2, b2);
end $mig$;

revoke all on function public.portal_warranties(uuid) from public, anon;
grant execute on function public.portal_warranties(uuid) to authenticated, service_role;

-- ---- and so does the save -------------------------------------------------
do $mig$
declare
  src text; n int;
  a1 constant text := $q$       warranty_registered, warranty_transferable, warranty_doc_url, warranty_status, created_by)$q$;
  b1 constant text := $q$       warranty_registered, warranty_transferable, warranty_doc_url, warranty_status,
       installed_by_contact_id, created_by)$q$;
  a2 constant text := $q$            nullif(trim(p->>'doc_url'), ''), nullif(trim(p->>'status'), ''),
            'portal:warranty')$q$;
  b2 constant text := $q$            nullif(trim(p->>'doc_url'), ''), nullif(trim(p->>'status'), ''),
            nullif(p->>'installed_by', '')::uuid,
            'portal:warranty')$q$;
  a3 constant text := $q$      warranty_status = nullif(trim(p->>'status'), ''),
      last_modified_by = 'portal:warranty'$q$;
  b3 constant text := $q$      warranty_status = nullif(trim(p->>'status'), ''),
      installed_by_contact_id = nullif(p->>'installed_by', '')::uuid,
      last_modified_by = 'portal:warranty'$q$;
begin
  src := pg_get_functiondef('public.portal_part_save(jsonb)'::regprocedure);
  n := (length(src) - length(replace(src, a1, ''))) / length(a1);
  if n <> 1 then raise exception 'The insert column list matched % times, expected 1.', n; end if;
  n := (length(src) - length(replace(src, a2, ''))) / length(a2);
  if n <> 1 then raise exception 'The insert values matched % times, expected 1.', n; end if;
  n := (length(src) - length(replace(src, a3, ''))) / length(a3);
  if n <> 1 then raise exception 'The update tail matched % times, expected 1.', n; end if;
  execute replace(replace(replace(src, a1, b1), a2, b2), a3, b3);
end $mig$;

revoke all on function public.portal_part_save(jsonb) from public, anon;
grant execute on function public.portal_part_save(jsonb) to authenticated, service_role;

-- ---- the photograph of the installed part ---------------------------------
create or replace function public.portal_part_photo_attach(p_file_id uuid, p_asset uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_house uuid; v_project uuid;
begin
  select parent_asset_id into v_house from public.assets where id = p_asset;
  if v_house is null then raise exception 'No such part'; end if;

  -- The file was uploaded against a project; the part hangs off a house. They
  -- have to be the same house, or a photograph from one address could be
  -- filed against a part at another.
  select f.project_id into v_project
    from public.files f join public.projects pr on pr.id = f.project_id
   where f.id = p_file_id and pr.asset_id = v_house;
  if v_project is null then
    raise exception 'That file does not belong to a job at this property';
  end if;
  if not (public.is_project_member(v_project) or public.is_superadmin()) then
    raise exception 'You are not on this project';
  end if;

  insert into public.file_links (file_id, role, project_id, asset_id, created_by_user_id)
  values (p_file_id, 'after', v_project, p_asset, public.current_app_user_id());

  return public.portal_warranties(v_project);
end;
$fn$;

revoke all on function public.portal_part_photo_attach(uuid, uuid) from public, anon;
grant execute on function public.portal_part_photo_attach(uuid, uuid) to authenticated, service_role;

-- ---- the requirement, in every trade's scope ------------------------------
--
-- ALL is the bucket that lands in every trade, whatever the trade. It goes
-- into the CONTRACT (add_to_contract) because that is the moment the work is
-- honestly pushed to the contractor rather than discovered by him at the end,
-- and onto the CHECKLIST because somebody has to be able to see it is done.
insert into public.blueprint_trade
  (trade, item, category, source, is_required, add_to_contract, add_to_checklist, audience, notes)
select 'ALL',
  'REGISTER EVERY PIECE OF EQUIPMENT YOU INSTALL, before you ask for the final payment. For each one: what it is, the manufacturer and model, the PART NUMBER and the SERIAL NUMBER off the plate, the date it went in, WHO INSTALLED IT, the manufacturer''s warranty and when it starts, whether you registered that warranty with the manufacturer, and a PHOTOGRAPH OF IT INSTALLED. A serial number tells you what failed; who put it in tells you whose warranty answers for it, and a photograph taken the day it went in settles both. This is logged in the app, by the trade that did the work - not handed over as a pile of paperwork for somebody else to type up.',
  'Closeout', 'shahar', true, true, true, 'contractor',
  'Added 2026-09-22. The register is portal_warranties; the trade logs it from the project''s Parts & warranty screen.'
where not exists (
  select 1 from public.blueprint_trade
   where trade = 'ALL' and item like 'REGISTER EVERY PIECE OF EQUIPMENT%');
