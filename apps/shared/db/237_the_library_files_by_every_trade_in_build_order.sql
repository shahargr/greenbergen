-- THE LIBRARY FILES BY EVERY TRADE, IN BUILD ORDER.
--
-- Shahar, 2026-09-25, on the "File into..." picker: "the file into should
-- allow me to file into every trade in the project. one of the categories
-- should be permits. sort the list based on the building schedule."
--
-- Three changes, all in the database (the picker lists the folders
-- portal_library returns, in the order it returns them):
--
--   1. EVERY TRADE ON THE PROJECT HAS A SHELF. Opening the library lays
--      down a folder for each trade the project touches - a task, a
--      contract, a bid package, a bid need, a scope line or a schedule
--      activity on it or a job beneath it - that no folder carries yet.
--      A trade folder fills itself (migration 228's walk), so this also
--      empties "Everything else" of every file already tied to a trade.
--   2. PERMITS is a standard shelf: seeded on a new library, added once
--      to the libraries that exist. It carries no trade - a permit is the
--      town's paper for many trades - so it is filled by hand.
--   3. BUILD ORDER. library_schedule_rank(trade) turns the trade vocabulary
--      into one number: the stage the trade is SCHEDULED in (trades.
--      schedule_stage, else trades.stage, ordered by trade_stages), then
--      the trade's own sort_order. The shelves without a trade sit where
--      they belong on that scale: Topo survey beside Survey, Permits at the
--      head of Site preparation, then Proposals, Signed contracts and
--      Warranties at the end. sort_order holds the rank, so there is still
--      one order and the existing read is unchanged.

-- The rank: stage x 1000 + the trade's place inside it. An unknown trade
-- (or none) ranks after everything.
create or replace function public.library_schedule_rank(p_trade text)
returns integer
language sql
stable
set search_path to 'public'
as $function$
  select coalesce(
    (select coalesce(ts.sort_order, 99) * 1000 + least(coalesce(t.sort_order, 999), 999)
       from public.trades t
       left join public.trade_stages ts on ts.stage = coalesce(t.schedule_stage, t.stage)
      where t.trade = p_trade),
    99999);
$function$;

comment on function public.library_schedule_rank(text) is
  'A trade''s place in the building schedule as one integer: trade_stages.sort_order of the stage it is SCHEDULED in (schedule_stage, else stage) x 1000, plus its own trades.sort_order. library_folders.sort_order holds this for trade folders (migration 237).';

-- The shelves: seed a new library, then add a folder for every trade the
-- project touches that no folder carries. Called by portal_library.
create or replace function public.library_sync_folders(p_project uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.bid_can_manage(p_project) then return; end if;

  if not exists (select 1 from public.library_folders where project_id = p_project) then
    insert into public.library_folders (project_id, name, trade, auto, sort_order, created_by) values
      (p_project, 'Deed & title',                  'Attorney',                   null,        public.library_schedule_rank('Attorney'),                   'portal:library'),
      (p_project, 'Asbestos',                      'Asbestos',                   null,        public.library_schedule_rank('Asbestos'),                   'portal:library'),
      (p_project, 'Lead',                          'Lead Paint',                 null,        public.library_schedule_rank('Lead Paint'),                 'portal:library'),
      (p_project, 'Oil tank',                      'Oil Tank Sweep & Detection', null,        public.library_schedule_rank('Oil Tank Sweep & Detection'), 'portal:library'),
      (p_project, 'Architectural design',          'Architecture',               null,        public.library_schedule_rank('Architecture'),               'portal:library'),
      (p_project, 'Renderings',                    'Architectural Rendering',    null,        public.library_schedule_rank('Architectural Rendering'),    'portal:library'),
      (p_project, 'Survey',                        'Surveyor',                   null,        public.library_schedule_rank('Surveyor'),                   'portal:library'),
      (p_project, 'Topo survey',                   null,                         null,        public.library_schedule_rank('Surveyor') + 1,               'portal:library'),
      (p_project, 'Permits',                       null,                         null,        public.library_schedule_rank('Utilities & Municipalities') / 1000 * 1000, 'portal:library'),
      (p_project, 'Pest control',                  'Pest Control',               null,        public.library_schedule_rank('Pest Control'),               'portal:library'),
      (p_project, 'Interior design',               'Interior Design',            null,        public.library_schedule_rank('Interior Design'),            'portal:library'),
      (p_project, 'Proposals',                     null,                         'proposals', 99500,                                                      'portal:library'),
      (p_project, 'Signed contracts & addendums',  null,                         'contracts', 99510,                                                      'portal:library'),
      (p_project, 'Warranties',                    null,                         null,        99900,                                                      'portal:library');
  end if;

  insert into public.library_folders (project_id, name, trade, sort_order, created_by)
  select p_project, tr.trade, tr.trade, public.library_schedule_rank(tr.trade), 'portal:library'
    from public.trades tr
   where tr.trade not in ('ALL', 'Meta')
     and not exists (select 1 from public.library_folders lf
                      where lf.project_id = p_project and lf.trade = tr.trade)
     and exists (
       select 1
         from public.project_ancestry_down(p_project) d
        where exists (select 1 from public.actions a
                       where a.project_id = d.id and lower(a.trade) = lower(tr.trade)
                         and a.status not in ('Cancelled', 'Force Cancelled', 'Superseded'))
           or exists (select 1 from public.contracts c
                       where c.project_id = d.id and lower(btrim(c.trade)) = lower(tr.trade))
           or exists (select 1 from public.bid_packages bp
                       where bp.project_id = d.id and lower(bp.trade) = lower(tr.trade))
           or exists (select 1 from public.project_bid_needs n
                       where n.project_id = d.id and n.trade = tr.trade)
           or exists (select 1 from public.project_scope_items si
                       where si.project_id = d.id and lower(si.trade) = lower(tr.trade))
           or exists (select 1 from public.schedule_activities sa
                        join public.project_stages ps on ps.id = sa.project_stage_id
                       where ps.project_id = d.id and sa.trade = tr.trade))
  on conflict (project_id, name) do nothing;
end $function$;

comment on function public.library_sync_folders(uuid) is
  'Lays out a project''s library shelves: the standard set on first open (Permits included), then one folder per trade the project or a job beneath it touches (tasks, contracts, bid packages, bid needs, scope lines, schedule activities) that no folder carries. sort_order = library_schedule_rank. Called by portal_library; refuses silently unless bid_can_manage (migration 237).';

-- portal_library: the seeding moves into library_sync_folders; the read is
-- migration 228's, with the trade picker in build order.
create or replace function public.portal_library(p_project uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_folders jsonb; v_rest jsonb;
begin
  if not public.bid_can_manage(p_project) then
    return jsonb_build_object('ok', false, 'reason', 'This project''s library is not yours to see.');
  end if;

  perform public.library_sync_folders(p_project);

  with fl_walk as (
    select fl.file_id,
           fl.library_folder_id,
           lower(coalesce(c.trade, bp.trade, bbp.trade, a.trade, tc.trade, ta.trade, psc.trade)) as trade_l,
           (fl.contract_id is not null or fl.payment_stage_id is not null
            or tx.contract_id is not null) as via_contract,
           (fl.bid_package_id is not null or fl.bid_id is not null) as via_proposal,
           coalesce(c.title, tc.title, psc.title, bp.trade, bbp.trade, a.action, tx.description) as detail
      from public.file_links fl
      join public.files f on f.id = fl.file_id and f.project_id = p_project
      left join public.contracts c on c.id = fl.contract_id
      left join public.bid_packages bp on bp.id = fl.bid_package_id
      left join public.bids b on b.id = fl.bid_id
      left join public.bid_packages bbp on bbp.id = b.package_id
      left join public.actions a on a.id = fl.action_id
      left join public.transactions tx on tx.id = fl.transaction_id
      left join public.contracts tc on tc.id = tx.contract_id
      left join public.actions ta on ta.id = tx.action_id
      left join public.payment_stages ps on ps.id = fl.payment_stage_id
      left join public.contracts psc on psc.id = ps.contract_id
  ),
  shelf as (
    select lf.id as folder_id, w.file_id, 'filed'::text as via, null::text as detail
      from fl_walk w join public.library_folders lf on lf.id = w.library_folder_id
    union
    select lf.id, w.file_id, 'trade', max(w.detail)
      from fl_walk w
      join public.library_folders lf
        on lf.project_id = p_project and lf.trade is not null and lower(lf.trade) = w.trade_l
     group by lf.id, w.file_id
    union
    select lf.id, w.file_id, 'contract', max(w.detail)
      from fl_walk w
      join public.library_folders lf on lf.project_id = p_project and lf.auto = 'contracts'
     where w.via_contract group by lf.id, w.file_id
    union
    select lf.id, w.file_id, 'proposal', max(w.detail)
      from fl_walk w
      join public.library_folders lf on lf.project_id = p_project and lf.auto = 'proposals'
     where w.via_proposal group by lf.id, w.file_id
  ),
  fjson as (
    select s.folder_id,
           jsonb_agg(jsonb_build_object(
             'id', f.id, 'file_name', f.file_name, 'kind', f.kind,
             'mime_type', f.mime_type, 'size_bytes', f.size_bytes,
             'caption', f.caption, 'created_at', f.created_at,
             'bucket', f.bucket, 'path', f.path,
             'via', s.via, 'detail', s.detail
           ) order by f.created_at desc) as files
      from (select folder_id, file_id, min(via) as via, max(detail) as detail
              from shelf group by folder_id, file_id) s
      join public.files f on f.id = s.file_id
     group by s.folder_id
  )
  select jsonb_agg(jsonb_build_object(
           'id', lf.id, 'name', lf.name, 'trade', lf.trade, 'auto', lf.auto,
           'sort_order', lf.sort_order,
           'files', coalesce(fj.files, '[]'::jsonb)
         ) order by lf.sort_order, lf.name)
    into v_folders
    from public.library_folders lf
    left join fjson fj on fj.folder_id = lf.id
   where lf.project_id = p_project;

  with fl_walk as (
    select fl.file_id,
           fl.library_folder_id,
           lower(coalesce(c.trade, bp.trade, bbp.trade, a.trade, tc.trade, ta.trade, psc.trade)) as trade_l,
           (fl.contract_id is not null or fl.payment_stage_id is not null
            or tx.contract_id is not null) as via_contract,
           (fl.bid_package_id is not null or fl.bid_id is not null) as via_proposal
      from public.file_links fl
      left join public.contracts c on c.id = fl.contract_id
      left join public.bid_packages bp on bp.id = fl.bid_package_id
      left join public.bids b on b.id = fl.bid_id
      left join public.bid_packages bbp on bbp.id = b.package_id
      left join public.actions a on a.id = fl.action_id
      left join public.transactions tx on tx.id = fl.transaction_id
      left join public.contracts tc on tc.id = tx.contract_id
      left join public.actions ta on ta.id = tx.action_id
      left join public.payment_stages ps on ps.id = fl.payment_stage_id
      left join public.contracts psc on psc.id = ps.contract_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', f.id, 'file_name', f.file_name, 'kind', f.kind,
           'mime_type', f.mime_type, 'size_bytes', f.size_bytes,
           'caption', f.caption, 'created_at', f.created_at,
           'bucket', f.bucket, 'path', f.path,
           'via', 'loose', 'detail', null
         ) order by f.created_at desc), '[]'::jsonb)
    into v_rest
    from public.files f
   where f.project_id = p_project
     and not exists (
       select 1 from fl_walk w
        where w.file_id = f.id
          and (w.library_folder_id is not null
               or w.via_contract or w.via_proposal
               or exists (select 1 from public.library_folders lf2
                           where lf2.project_id = p_project and lf2.trade is not null
                             and lower(lf2.trade) = w.trade_l)));

  return jsonb_build_object('ok', true,
    'folders', coalesce(v_folders, '[]'::jsonb),
    'loose', v_rest,
    'trades', (select jsonb_agg(t.trade order by public.library_schedule_rank(t.trade), t.trade)
                 from public.trades t
                where t.trade not in ('ALL', 'Meta')));
end $function$;

comment on function public.portal_library(uuid) is
  'The project library in one read: library_sync_folders lays the shelves (standard set, Permits, one per project trade), then every project file lands on them - filed by hand, by trade walked through its links, or on the auto contracts/proposals shelves - and whatever lands nowhere comes back as loose. Folders in build order (sort_order = library_schedule_rank). VOLATILE because it writes shelves. Migrations 228, 237.';

-- A new folder carrying a trade lands at that trade's place in the build;
-- re-trading one moves it there unless a sort_order is given.
create or replace function public.portal_library_folder_save(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_project uuid;
  v_name text := nullif(btrim(coalesce(p->>'name', '')), '');
  v_trade text := nullif(p->>'trade', '');
begin
  if v_id is not null then
    select project_id into v_project from public.library_folders where id = v_id;
    if v_project is null then return jsonb_build_object('ok', false, 'reason', 'That folder does not exist.'); end if;
  else
    v_project := nullif(p->>'project_id', '')::uuid;
  end if;
  if v_project is null or not public.bid_can_manage(v_project) then
    return jsonb_build_object('ok', false, 'reason', 'This project''s library is not yours to arrange.');
  end if;

  if coalesce((p->>'delete')::boolean, false) and v_id is not null then
    delete from public.library_folders where id = v_id;
    return jsonb_build_object('ok', true);
  end if;

  if v_id is null then
    if v_name is null then return jsonb_build_object('ok', false, 'reason', 'Give the folder a name.'); end if;
    if exists (select 1 from public.library_folders f
                where f.project_id = v_project and lower(btrim(f.name)) = lower(v_name)) then
      return jsonb_build_object('ok', false, 'reason', 'This library already has that folder.');
    end if;
    insert into public.library_folders (project_id, name, trade, sort_order, created_by)
    values (v_project, v_name, v_trade,
            coalesce(nullif(p->>'sort_order', '')::int,
                     case when v_trade is not null then public.library_schedule_rank(v_trade) end,
                     (select coalesce(max(sort_order), 0) + 10 from public.library_folders
                       where project_id = v_project)),
            'portal:library')
    returning id into v_id;
  else
    update public.library_folders f set
      name       = case when p ? 'name' then coalesce(v_name, f.name) else f.name end,
      trade      = case when p ? 'trade' then v_trade else f.trade end,
      sort_order = case when p ? 'sort_order' then coalesce(nullif(p->>'sort_order', '')::int, f.sort_order)
                        when p ? 'trade' and v_trade is not null then public.library_schedule_rank(v_trade)
                        else f.sort_order end
    where f.id = v_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $function$;

-- The libraries that exist: re-rank their shelves on the new scale and
-- give each a Permits shelf.
update public.library_folders lf set sort_order = case
    when lf.trade is not null        then public.library_schedule_rank(lf.trade)
    when lf.auto = 'proposals'       then 99500
    when lf.auto = 'contracts'       then 99510
    when lf.name = 'Warranties'      then 99900
    when lf.name = 'Topo survey'     then public.library_schedule_rank('Surveyor') + 1
    else 99000 + least(lf.sort_order, 499)
  end;

insert into public.library_folders (project_id, name, trade, sort_order, created_by)
select distinct lf.project_id, 'Permits', null::text,
       public.library_schedule_rank('Utilities & Municipalities') / 1000 * 1000, 'portal:library'
  from public.library_folders lf
on conflict (project_id, name) do nothing;

update public.config set schema_version = schema_version + 1, schema_updated_at = current_date;
