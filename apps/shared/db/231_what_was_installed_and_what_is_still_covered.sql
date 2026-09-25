-- WHAT WAS INSTALLED, AND WHAT IS STILL COVERED.
--
-- Shahar, 2026-09-22: "similar to addendum, we need one more page: list of
-- all parts registered and warranty. workmanship warranty transferrable to
-- owner."
--
-- BOTH HALVES WERE ALREADY MODELLED AND NEITHER WAS EVER WRITTEN TO. assets
-- carries serial_number, install_date, warranty_length, warranty_start,
-- warranty_registered, warranty_transferable, warranty_doc_url and
-- warranty_status; contracts carries warranty_covers, warranty_term_months,
-- warranty_transferable and warranty_claim_contact. Two equipment rows exist
-- in the whole database, no contract has a warranty on it, and products - the
-- table that holds a manufacturer and a model - has never had a row. The
-- columns have been sitting there waiting for a screen.
--
-- A PART IS A CHILD OF THE HOUSE. assets already nests through
-- parent_asset_id, and the house is an asset (Ran's is real estate at 8 Jason
-- Woods Road). So the furnace is an asset under the house, and it outlives
-- the job that installed it - which is the point. A warranty that expires
-- with the project is not a warranty.
--
-- WHICH BREAKS THE EXISTING RLS, and that is the one thing here that needed
-- thought. assets is visible only where a PROJECT POINTS AT IT:
--
--   exists (select 1 from projects p where p.asset_id = assets.id and ...)
--
-- Nothing points at a child. So a part would be written and then be invisible
-- to the person who wrote it. The policies below reach one level up: a part is
-- seen and edited through the house it hangs on.
--
-- AND products FINALLY GETS ROWS. Make and model are not per-house facts -
-- two houses with the same water heater have the same warranty terms on it -
-- so portal_part_save finds or creates the product rather than copying
-- manufacturer and model onto every asset (rulebook 30). products is
-- reference data whose write policy is superadmin-only, which is right for a
-- catalogue and wrong for a person standing in a basement holding the box;
-- the function is SECURITY DEFINER and does the membership check itself.

-- ---- a part is seen and edited through its house --------------------------
drop policy if exists asset_part_visible_via_house on public.assets;
create policy asset_part_visible_via_house on public.assets for select to authenticated
  using (parent_asset_id is not null and public.is_asset_member(parent_asset_id));

drop policy if exists asset_part_update_via_house on public.assets;
create policy asset_part_update_via_house on public.assets for update to authenticated
  using (parent_asset_id is not null
         and exists (select 1 from public.projects p
                      where p.asset_id = assets.parent_asset_id
                        and p.trashed_at is null
                        and public.can_edit_project(p.id)));

-- ---- read -----------------------------------------------------------------
create or replace function public.portal_warranties(p_project uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $fn$
  with recursive gate as (select public.is_project_member(p_project) or public.is_superadmin() as ok),
  house as (select pr.asset_id, a.asset_name from public.projects pr
              left join public.assets a on a.id = pr.asset_id where pr.id = p_project),
  -- The job and everything under it, because the work - and its contracts -
  -- live on the children, not on the container.
  fam as (
    select p.id from public.projects p where p.id = p_project
    union all
    select c.id from public.projects c join fam on c.parent_project_id = fam.id),
  part as (
    select a.id, a.asset_name, a.serial_number, a.room, a.specific_location,
           a.install_date, a.warranty_length, a.warranty_start,
           coalesce(a.warranty_registered, false) as warranty_registered,
           coalesce(a.warranty_transferable, false) as warranty_transferable,
           a.warranty_doc_url, a.warranty_status,
           pr.manufacturer, pr.model, pr.part_number, pr.spec_url, pr.trade
      from public.assets a
      left join public.products pr on pr.id = a.product_id
     where a.parent_asset_id = (select asset_id from house))
  select case when not (select ok from gate) then null else jsonb_build_object(
    'house_asset_id', (select asset_id from house),
    'house', (select asset_name from house),
    -- No property on the job means nowhere to hang a part.
    'can_register', (select asset_id is not null from house),
    'parts_n',      (select count(*) from part),
    'registered_n', (select count(*) from part where warranty_registered),
    'transfers_n',  (select count(*) from part where warranty_transferable),
    'parts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.asset_name, 'serial', p.serial_number,
        'room', p.room, 'where', p.specific_location, 'installed_on', p.install_date,
        'warranty_length', p.warranty_length, 'warranty_start', p.warranty_start,
        'registered', p.warranty_registered, 'transferable', p.warranty_transferable,
        'doc_url', p.warranty_doc_url, 'status', p.warranty_status,
        'manufacturer', p.manufacturer, 'model', p.model,
        'part_number', p.part_number, 'spec_url', p.spec_url, 'trade', p.trade)
        order by p.trade nulls last, p.asset_name)
      from part p), '[]'::jsonb),

    -- WORKMANSHIP, which is the contractor's own promise rather than the
    -- manufacturer's, and the one Shahar named: does it follow the house to
    -- whoever owns it next?
    'workmanship', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'title', c.title, 'trade', c.trade, 'status', c.status,
        'project_id', c.project_id,
        'covers', c.warranty_covers, 'months', c.warranty_term_months,
        'transferable', c.warranty_transferable, 'claim_contact', c.warranty_claim_contact,
        'party', (select coalesce(ct.person_name, ct.name) from public.contacts ct
                   where ct.id = c.counterparty_contact_id),
        -- Nothing said either way is not the same as "it does not transfer",
        -- and a handover pack that quietly says no is worse than one that
        -- says nobody has been asked.
        'answered', c.warranty_term_months is not null or c.warranty_covers is not null
                    or c.warranty_transferable is not null)
        order by c.trade nulls last, c.title)
      from public.contracts c
     where c.project_id in (select id from fam)
       and coalesce(c.status, '') not in ('Cancelled', 'Superseded')), '[]'::jsonb),
    'workmanship_answered', (select count(*) from public.contracts c
                              where c.project_id in (select id from fam)
                                and coalesce(c.status,'') not in ('Cancelled','Superseded')
                                and (c.warranty_term_months is not null or c.warranty_covers is not null
                                     or c.warranty_transferable is not null)),
    'workmanship_n', (select count(*) from public.contracts c
                       where c.project_id in (select id from fam)
                         and coalesce(c.status,'') not in ('Cancelled','Superseded')))
  end;
$fn$;

comment on function public.portal_warranties(uuid) is
  'The handover register for a job: every part installed in the house with its model, serial and manufacturer warranty, and every contract''s workmanship warranty with whether it transfers to the owner. Parts hang off the house asset, so they outlive the job.';

revoke all on function public.portal_warranties(uuid) from public, anon;
grant execute on function public.portal_warranties(uuid) to authenticated, service_role;

-- ---- write: one part ------------------------------------------------------
create or replace function public.portal_part_save(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_project uuid; v_house uuid; v_id uuid; v_product uuid;
  v_make text; v_model text;
begin
  v_project := nullif(p->>'project_id', '')::uuid;
  if v_project is null then raise exception 'Which job?'; end if;
  if not (public.can_edit_project(v_project) or public.is_superadmin()) then
    raise exception 'Not allowed to edit this project';
  end if;
  select asset_id into v_house from public.projects where id = v_project;
  if v_house is null then
    raise exception 'This job is not attached to a property, so a part has nothing to be installed in.';
  end if;

  if coalesce(trim(p->>'name'), '') = '' then
    raise exception 'A part needs a name - what it is, in the words you would use on site.';
  end if;

  -- THE CATALOGUE, found or made. Matched case-insensitively on make AND
  -- model together, because "Rheem"/"XE50" typed twice must not become two
  -- products with two different warranty terms.
  v_make  := nullif(trim(p->>'manufacturer'), '');
  v_model := nullif(trim(p->>'model'), '');
  if v_model is not null then
    select pr.id into v_product from public.products pr
     where lower(coalesce(pr.manufacturer, '')) = lower(coalesce(v_make, ''))
       and lower(coalesce(pr.model, '')) = lower(v_model)
     limit 1;
    if v_product is null then
      insert into public.products (name, manufacturer, model, part_number, spec_url, trade, created_by)
      values (concat_ws(' ', v_make, v_model), v_make, v_model,
              nullif(trim(p->>'part_number'), ''), nullif(trim(p->>'spec_url'), ''),
              nullif(trim(p->>'trade'), ''), 'portal:warranty')
      returning id into v_product;
    else
      -- Fill the blanks on a product somebody else started; never overwrite.
      update public.products set
        part_number = coalesce(part_number, nullif(trim(p->>'part_number'), '')),
        spec_url    = coalesce(spec_url,    nullif(trim(p->>'spec_url'), '')),
        trade       = coalesce(trade,       nullif(trim(p->>'trade'), ''))
       where id = v_product;
    end if;
  end if;

  v_id := nullif(p->>'id', '')::uuid;
  if v_id is null then
    insert into public.assets
      (asset_name, asset_type, parent_asset_id, product_id, serial_number, room,
       specific_location, install_date, warranty_length, warranty_start,
       warranty_registered, warranty_transferable, warranty_doc_url, warranty_status, created_by)
    values (trim(p->>'name'), 'equipment', v_house, v_product,
            nullif(trim(p->>'serial'), ''), nullif(trim(p->>'room'), ''),
            nullif(trim(p->>'where'), ''), nullif(p->>'installed_on', '')::date,
            nullif(trim(p->>'warranty_length'), ''), nullif(p->>'warranty_start', '')::date,
            coalesce((p->>'registered')::boolean, false),
            coalesce((p->>'transferable')::boolean, false),
            nullif(trim(p->>'doc_url'), ''), nullif(trim(p->>'status'), ''),
            'portal:warranty')
    returning id into v_id;
  else
    -- Only a part of THIS house, so an id from elsewhere cannot be edited by
    -- handing it to this function.
    update public.assets set
      asset_name = trim(p->>'name'),
      product_id = coalesce(v_product, product_id),
      serial_number = nullif(trim(p->>'serial'), ''),
      room = nullif(trim(p->>'room'), ''),
      specific_location = nullif(trim(p->>'where'), ''),
      install_date = nullif(p->>'installed_on', '')::date,
      warranty_length = nullif(trim(p->>'warranty_length'), ''),
      warranty_start = nullif(p->>'warranty_start', '')::date,
      warranty_registered = coalesce((p->>'registered')::boolean, false),
      warranty_transferable = coalesce((p->>'transferable')::boolean, false),
      warranty_doc_url = nullif(trim(p->>'doc_url'), ''),
      warranty_status = nullif(trim(p->>'status'), ''),
      last_modified_by = 'portal:warranty'
     where id = v_id and parent_asset_id = v_house;
    if not found then raise exception 'That part is not installed in this property.'; end if;
  end if;

  return public.portal_warranties(v_project);
end;
$fn$;

revoke all on function public.portal_part_save(jsonb) from public, anon;
grant execute on function public.portal_part_save(jsonb) to authenticated, service_role;

-- ---- write: one contract's workmanship ------------------------------------
create or replace function public.portal_workmanship_save(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_contract uuid; v_project uuid; v_months int;
begin
  v_contract := nullif(p->>'contract_id', '')::uuid;
  if v_contract is null then raise exception 'Which contract?'; end if;
  select project_id into v_project from public.contracts where id = v_contract;
  if v_project is null then raise exception 'No such contract'; end if;
  if not (public.can_edit_project(v_project) or public.is_superadmin()) then
    raise exception 'Not allowed to edit this project';
  end if;

  v_months := nullif(p->>'months', '')::int;
  if v_months is not null and (v_months < 0 or v_months > 600) then
    raise exception 'A workmanship warranty is measured in months - 12, 24, 120. % is not.', v_months;
  end if;

  update public.contracts set
    warranty_covers = nullif(trim(p->>'covers'), ''),
    warranty_term_months = v_months,
    -- NULL IS KEPT AS NULL. "Nobody has been asked" and "no, it does not
    -- transfer" are different answers, and the register shows them
    -- differently, so this must not coalesce one into the other.
    warranty_transferable = case when p ? 'transferable' and p->>'transferable' is not null
                                 then (p->>'transferable')::boolean end,
    warranty_claim_contact = nullif(trim(p->>'claim_contact'), ''),
    last_modified_by = 'portal:warranty'
   where id = v_contract;

  return jsonb_build_object('ok', true, 'project_id', v_project);
end;
$fn$;

revoke all on function public.portal_workmanship_save(jsonb) from public, anon;
grant execute on function public.portal_workmanship_save(jsonb) to authenticated, service_role;
