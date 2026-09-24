-- THE PROJECT LIBRARY READS ITS OWN SHELVES.
--
-- Shahar, 2026-09-24: "Replace Award work panel with project library.
-- Project library will hold deliveries by trades by order. For example,
-- pest control, asbestos, lead, oil tank, survey, topo survey, deed,
-- architectural design, interior design, rendering, warranties, proposals,
-- signed contracts and addendums, etc. enable a folder like view, where I
-- can drag and drop files here." And minutes later: "the system should be
-- smart enough to show the files by scanning all existing contracts and
-- proposals it can find the system, and filter based on trades, and even
-- if they are not attached to anything."
--
-- So a folder is a VIEW, not a box. The file store already holds one row
-- per file with many links (help: files); the library adds a small ordered
-- vocabulary of folders per project, and ONE read that files every project
-- file onto its shelves four ways:
--
--   1. FILED BY HAND - file_links.library_folder_id, the drag-and-drop.
--   2. BY TRADE - the file's links walk to a trade (contract, bid package,
--      bid, action, or a transaction's contract/action), and a folder
--      carrying that trade shows it automatically.
--   3. AUTO SHELVES - a folder with auto='contracts' gathers every file
--      hanging on a contract or payment stage; auto='proposals' gathers
--      every file on a bid package or bid.
--   4. EVERYTHING ELSE - files attached to nothing, shown anyway, because
--      a delivery nobody filed is exactly what he wants to see.
--
-- A file can sit on several shelves at once - that is the point of
-- file_links, and why nothing is ever copied (rule 30).

create table if not exists public.library_folders (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  name        text not null,
  -- Which trade fills this shelf automatically. Vocabulary, never free text.
  trade       text references public.trades(trade) on update cascade on delete set null,
  -- 'contracts' | 'proposals': the shelf that scans the system instead of
  -- waiting to be fed.
  auto        text check (auto in ('contracts', 'proposals')),
  sort_order  int not null default 100,
  created_at  timestamptz not null default now(),
  created_by  text,
  unique (project_id, name)
);
alter table public.library_folders enable row level security;

comment on table public.library_folders is
  'The project library''s shelves (228): an ordered, per-project list of '
  'delivery folders. A folder with a trade fills itself from every file '
  'whose links walk to that trade; auto=contracts/proposals scan the whole '
  'system; the rest hold what is dragged onto them (file_links.'
  'library_folder_id).';

alter table public.file_links
  add column if not exists library_folder_id uuid
    references public.library_folders(id) on delete cascade;

comment on column public.file_links.library_folder_id is
  'A hand-filing into a project library folder (228). One row per shelf a '
  'file was explicitly put on; deleting the folder unfiles, never deletes '
  'the file.';

create unique index if not exists file_links_one_filing_per_shelf
  on public.file_links (file_id, library_folder_id)
  where library_folder_id is not null;

-- THE READ. Volatile on purpose: the first open of a project's library
-- lays out the standard shelf set Shahar named, in his order, so the
-- screen never starts empty-handed.
create or replace function public.portal_library(p_project uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_folders jsonb; v_rest jsonb;
begin
  if not public.bid_can_manage(p_project) then
    return jsonb_build_object('ok', false, 'reason', 'This project''s library is not yours to see.');
  end if;

  if not exists (select 1 from public.library_folders where project_id = p_project) then
    insert into public.library_folders (project_id, name, trade, auto, sort_order, created_by) values
      (p_project, 'Pest control',                  'Pest Control',                 null,        10, 'portal:library'),
      (p_project, 'Asbestos',                      'Asbestos',                     null,        20, 'portal:library'),
      (p_project, 'Lead',                          'Lead Paint',                   null,        30, 'portal:library'),
      (p_project, 'Oil tank',                      'Oil Tank Sweep & Detection',   null,        40, 'portal:library'),
      (p_project, 'Survey',                        'Surveyor',                     null,        50, 'portal:library'),
      (p_project, 'Topo survey',                   null,                           null,        60, 'portal:library'),
      (p_project, 'Deed & title',                  'Attorney',                     null,        70, 'portal:library'),
      (p_project, 'Architectural design',          'Architecture',                 null,        80, 'portal:library'),
      (p_project, 'Interior design',               'Interior Design',              null,        90, 'portal:library'),
      (p_project, 'Renderings',                    'Architectural Rendering',      null,       100, 'portal:library'),
      (p_project, 'Proposals',                     null,                           'proposals',110, 'portal:library'),
      (p_project, 'Signed contracts & addendums',  null,                           'contracts',120, 'portal:library'),
      (p_project, 'Warranties',                    null,                           null,       130, 'portal:library');
  end if;

  -- Every link of every project file, walked to a trade and a source.
  with fl_walk as (
    select fl.file_id,
           fl.library_folder_id,
           lower(coalesce(c.trade, bp.trade, bbp.trade, a.trade, tc.trade, ta.trade, psc.trade)) as trade_l,
           (fl.contract_id is not null or fl.payment_stage_id is not null
            or tx.contract_id is not null) as via_contract,
           (fl.bid_package_id is not null or fl.bid_id is not null) as via_proposal,
           -- (a task name lives in actions.action; a.title crashed the
           -- first deploy of this read, fixed the same day)
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
    -- 1. filed by hand
    select lf.id as folder_id, w.file_id, 'filed'::text as via, null::text as detail
      from fl_walk w join public.library_folders lf on lf.id = w.library_folder_id
    union
    -- 2. by trade
    select lf.id, w.file_id, 'trade', max(w.detail)
      from fl_walk w
      join public.library_folders lf
        on lf.project_id = p_project and lf.trade is not null and lower(lf.trade) = w.trade_l
     group by lf.id, w.file_id
    union
    -- 3. the scanning shelves
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

  -- 4. everything else: on no shelf at all - not filed, no trade a folder
  -- carries, not a contract or proposal document. Attached to nothing, or
  -- attached to things the shelves do not read.
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
    'trades', (select jsonb_agg(t.trade order by t.trade) from public.trades t
                where t.trade not in ('ALL', 'Meta')));
end $$;

comment on function public.portal_library(uuid) is
  'The project library (228): ordered folders, each filled by hand-filings, '
  'by trade walked through the file''s links, or by scanning contracts / '
  'proposals; plus the loose files on no shelf at all. Seeds the standard '
  'shelf set on first open. Guarded by bid_can_manage.';

-- The shelf verbs: make, rename, re-trade, reorder, remove.
create or replace function public.portal_library_folder_save(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid;
  v_project uuid;
  v_name text := nullif(btrim(coalesce(p->>'name', '')), '');
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
    -- Unfiles (the links cascade), never deletes a file.
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
    values (v_project, v_name, nullif(p->>'trade', ''),
            coalesce(nullif(p->>'sort_order', '')::int,
                     (select coalesce(max(sort_order), 0) + 10 from public.library_folders
                       where project_id = v_project)),
            'portal:library')
    returning id into v_id;
  else
    update public.library_folders f set
      name       = case when p ? 'name' then coalesce(v_name, f.name) else f.name end,
      trade      = case when p ? 'trade' then nullif(p->>'trade', '') else f.trade end,
      sort_order = case when p ? 'sort_order' then coalesce(nullif(p->>'sort_order', '')::int, f.sort_order) else f.sort_order end
    where f.id = v_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

comment on function public.portal_library_folder_save(jsonb) is
  'Create, rename, re-trade, reorder or delete (unfile, never destroy) one '
  'library folder (228).';

-- Filing: put a file on a shelf, or take it off one. The file itself is
-- untouched either way.
create or replace function public.portal_library_file(p_file uuid, p_folder uuid, p_unfile boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_project uuid; v_fproj uuid;
begin
  select project_id into v_project from public.library_folders where id = p_folder;
  if v_project is null then return jsonb_build_object('ok', false, 'reason', 'That folder does not exist.'); end if;
  if not public.bid_can_manage(v_project) then
    return jsonb_build_object('ok', false, 'reason', 'This project''s library is not yours to arrange.');
  end if;
  select project_id into v_fproj from public.files where id = p_file;
  if v_fproj is null or v_fproj <> v_project then
    return jsonb_build_object('ok', false, 'reason', 'That file is not on this project.');
  end if;
  if p_unfile then
    delete from public.file_links where file_id = p_file and library_folder_id = p_folder;
  else
    insert into public.file_links (file_id, project_id, library_folder_id, role, created_by_user_id)
    values (p_file, v_project, p_folder, 'library', public.current_app_user_id())
    on conflict (file_id, library_folder_id) where library_folder_id is not null do nothing;
  end if;
  return jsonb_build_object('ok', true);
end $$;

comment on function public.portal_library_file(uuid, uuid, boolean) is
  'Files a project file onto a library shelf, or takes it off (228). The '
  'file row and its other links are never touched.';
