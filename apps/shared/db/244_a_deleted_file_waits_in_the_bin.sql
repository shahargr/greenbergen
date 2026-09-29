-- 244 A DELETED FILE WAITS IN THE BIN
--
-- Shahar (2026-09-29), on the library: "i need to be able to see the file,
-- delete, and undelete. meaning, a file deleted will still show as deleted
-- file until the recycle bin clears it out. build a little open panel that
-- shows me this info and the file get purged, with a force purge option as
-- well."
--
-- Until now the library's trash icon ran portal_project_file_delete: the row
-- and its links went at once and the browser removed the bytes. Nothing to
-- undo.
--
-- WHY A SIDE TABLE AND NOT files.deleted_at. Dozens of functions read files
-- (the reel, the face of a project, evidence, bids, the house page...). A
-- deleted_at column would have to be filtered in every one of them, and the
-- one that forgets shows a deleted photo. Instead a deleted file LEAVES files
-- exactly as before - every reader stays right with no edit - and its row,
-- its links and every reference that the delete nulls are kept as a snapshot
-- in file_trash. The BYTES stay in storage, so the file can still be opened
-- from the bin. Restore puts the row, the links and the references back.
--
-- HOW LONG. config.trash_retention_days - the same recycle bin setting the
-- trashed projects already use (14 today). A file past it is purged when an
-- editor next opens that project's library (portal_file_bin_purge): the
-- database cannot remove storage bytes itself (storage.protect_delete), so
-- the purge hands the paths back and the caller removes them, the same
-- two-step as portal_project_file_delete. A bin nobody opens keeps its
-- snapshots; the cost is bytes, never a wrong answer.
--
-- portal_project_file_delete is left as it was: the portal's scope tab still
-- deletes for good.

create table if not exists public.file_trash (
  file_id uuid primary key,
  project_id uuid references public.projects(id) on delete cascade,
  bucket text not null,
  path text not null,
  file_name text,
  kind text,
  mime_type text,
  size_bytes bigint,
  caption text,
  file_row jsonb not null,
  links jsonb not null default '[]'::jsonb,
  refs jsonb not null default '{}'::jsonb,
  deleted_at timestamptz not null default now(),
  deleted_by_user_id uuid references public.app_users(id) on delete set null
);
create index if not exists idx_file_trash_project on public.file_trash (project_id, deleted_at);

comment on table public.file_trash is
  'The recycle bin for files: a deleted files row with its file_links and the references its delete nulled, kept as a snapshot so it can be restored until config.trash_retention_days passes. Separate from files so no reader of files has to filter deleted rows. The bytes stay in storage until the purge.';

alter table public.file_trash enable row level security;
-- No policies: read and written only through the portal_file_* functions.

drop trigger if exists trg_log_file_trash on public.file_trash;
create trigger trg_log_file_trash after insert or delete or update on public.file_trash
  for each row execute function public.fn_log_change('file_id');

-- ---- delete: into the bin --------------------------------------------------
create or replace function public.portal_file_trash(p_file_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare f public.files; v_links jsonb; v_refs jsonb; v_days int;
begin
  select * into f from public.files where id = p_file_id;
  if f.id is null then return jsonb_build_object('ok', false, 'reason', 'That file is already gone.'); end if;
  if not (public.can_edit_project(f.project_id) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'reason', 'That file is not yours to delete.');
  end if;

  select coalesce(jsonb_agg(to_jsonb(fl)), '[]'::jsonb) into v_links
    from public.file_links fl where fl.file_id = f.id;
  v_refs := jsonb_build_object(
    'projects_cover',     (select coalesce(jsonb_agg(id), '[]'::jsonb) from public.projects where cover_file_id = f.id),
    'messages',           (select coalesce(jsonb_agg(id), '[]'::jsonb) from public.messages where file_id = f.id),
    'bid_package_photos', (select coalesce(jsonb_agg(id), '[]'::jsonb) from public.bid_package_photos where file_id = f.id),
    'house_page_photos',  (select coalesce(jsonb_agg(id), '[]'::jsonb) from public.house_page_photos where file_id = f.id),
    'project_bookings',   (select coalesce(jsonb_agg(id), '[]'::jsonb) from public.project_bookings where share_after_file_id = f.id),
    'project_reels',      (select coalesce(jsonb_agg(id), '[]'::jsonb) from public.project_reels where rendered_file_id = f.id),
    'files_superseding',  (select coalesce(jsonb_agg(id), '[]'::jsonb) from public.files where supersedes_id = f.id),
    'project_reel_items', (select coalesce(jsonb_agg(to_jsonb(ri)), '[]'::jsonb) from public.project_reel_items ri where ri.file_id = f.id));

  insert into public.file_trash (file_id, project_id, bucket, path, file_name, kind, mime_type, size_bytes,
                                 caption, file_row, links, refs, deleted_by_user_id)
  values (f.id, f.project_id, f.bucket, f.path, f.file_name, f.kind, f.mime_type, f.size_bytes,
          f.caption, to_jsonb(f), v_links, v_refs, public.current_app_user_id());

  delete from public.files where id = f.id;   -- links and reel items cascade, the rest go null

  select trash_retention_days into v_days from public.config limit 1;
  return jsonb_build_object('ok', true, 'file_id', f.id, 'file_name', f.file_name,
    'purge_on', (now() + make_interval(days => coalesce(v_days, 14)))::date);
end $function$;

-- ---- undelete ---------------------------------------------------------------
create or replace function public.portal_file_restore(p_file_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare t public.file_trash; v_row public.files; r jsonb; v_skipped int := 0;
begin
  select * into t from public.file_trash where file_id = p_file_id;
  if t.file_id is null then return jsonb_build_object('ok', false, 'reason', 'That file is no longer in the bin.'); end if;
  if not (public.can_edit_project(t.project_id) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'reason', 'That file is not yours to restore.');
  end if;
  if exists (select 1 from public.files where id = t.file_id or (bucket = t.bucket and path = t.path)) then
    return jsonb_build_object('ok', false, 'reason', 'That file is already back in the project.');
  end if;

  v_row := jsonb_populate_record(null::public.files, t.file_row);
  if v_row.supersedes_id is not null and not exists (select 1 from public.files where id = v_row.supersedes_id) then
    v_row.supersedes_id := null;
  end if;
  insert into public.files select v_row.*;

  -- A link whose target was deleted meanwhile (a task, a folder) cannot come
  -- back; the rest do. Counted, not fatal.
  for r in select value from jsonb_array_elements(t.links) loop
    begin
      insert into public.file_links select (jsonb_populate_record(null::public.file_links, r)).*;
    exception when others then v_skipped := v_skipped + 1;
    end;
  end loop;
  for r in select value from jsonb_array_elements(coalesce(t.refs->'project_reel_items', '[]'::jsonb)) loop
    begin
      insert into public.project_reel_items select (jsonb_populate_record(null::public.project_reel_items, r)).*;
    exception when others then v_skipped := v_skipped + 1;
    end;
  end loop;

  -- References come back only where nobody chose something else meanwhile.
  update public.projects set cover_file_id = t.file_id
   where cover_file_id is null and id in (select (x #>> '{}')::uuid from jsonb_array_elements(coalesce(t.refs->'projects_cover', '[]'::jsonb)) x);
  update public.messages set file_id = t.file_id
   where file_id is null and id in (select (x #>> '{}')::uuid from jsonb_array_elements(coalesce(t.refs->'messages', '[]'::jsonb)) x);
  update public.bid_package_photos set file_id = t.file_id
   where file_id is null and id in (select (x #>> '{}')::uuid from jsonb_array_elements(coalesce(t.refs->'bid_package_photos', '[]'::jsonb)) x);
  update public.house_page_photos set file_id = t.file_id
   where file_id is null and id in (select (x #>> '{}')::uuid from jsonb_array_elements(coalesce(t.refs->'house_page_photos', '[]'::jsonb)) x);
  update public.project_bookings set share_after_file_id = t.file_id
   where share_after_file_id is null and id in (select (x #>> '{}')::uuid from jsonb_array_elements(coalesce(t.refs->'project_bookings', '[]'::jsonb)) x);
  update public.project_reels set rendered_file_id = t.file_id
   where rendered_file_id is null and id in (select (x #>> '{}')::uuid from jsonb_array_elements(coalesce(t.refs->'project_reels', '[]'::jsonb)) x);
  update public.files set supersedes_id = t.file_id
   where supersedes_id is null and id in (select (x #>> '{}')::uuid from jsonb_array_elements(coalesce(t.refs->'files_superseding', '[]'::jsonb)) x);

  delete from public.file_trash where file_id = t.file_id;
  return jsonb_build_object('ok', true, 'file_id', t.file_id, 'file_name', t.file_name, 'links_lost', v_skipped);
end $function$;

-- ---- purge one now (force) -----------------------------------------------
-- Returns the bytes to remove; null path when a live row still uses them.
create or replace function public.portal_file_purge(p_file_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare t public.file_trash;
begin
  select * into t from public.file_trash where file_id = p_file_id;
  if t.file_id is null then return jsonb_build_object('ok', false, 'reason', 'That file is no longer in the bin.'); end if;
  if not (public.can_edit_project(t.project_id) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'reason', 'That file is not yours to purge.');
  end if;
  delete from public.file_trash where file_id = t.file_id;
  if exists (select 1 from public.files where bucket = t.bucket and path = t.path) then
    return jsonb_build_object('ok', true, 'bucket', null, 'path', null);
  end if;
  return jsonb_build_object('ok', true, 'bucket', t.bucket, 'path', t.path);
end $function$;

-- ---- purge what is due (or everything: empty the bin) ------------------------
create or replace function public.portal_file_bin_purge(p_project uuid, p_all boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_days int; v_gone jsonb;
begin
  if not (public.can_edit_project(p_project) or public.is_superadmin()) then
    return jsonb_build_object('ok', true, 'removed', '[]'::jsonb);   -- a viewer sweeps nothing
  end if;
  select trash_retention_days into v_days from public.config limit 1;
  with gone as (
    delete from public.file_trash t
     where t.project_id = p_project
       and (p_all or t.deleted_at < now() - make_interval(days => coalesce(v_days, 14)))
    returning t.bucket, t.path
  )
  select coalesce(jsonb_agg(jsonb_build_object('bucket', g.bucket, 'path', g.path)), '[]'::jsonb) into v_gone
    from gone g
   where not exists (select 1 from public.files f where f.bucket = g.bucket and f.path = g.path);
  return jsonb_build_object('ok', true, 'removed', v_gone);
end $function$;

-- ---- what is in the bin -------------------------------------------------------
create or replace function public.portal_file_bin(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v_days int;
begin
  if not (public.can_edit_project(p_project) or public.is_superadmin()) then
    return jsonb_build_object('ok', true, 'days', null, 'items', '[]'::jsonb);
  end if;
  select coalesce(trash_retention_days, 14) into v_days from public.config limit 1;
  return jsonb_build_object('ok', true, 'days', v_days, 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', t.file_id, 'file_name', t.file_name, 'kind', t.kind, 'mime_type', t.mime_type,
             'size_bytes', t.size_bytes, 'caption', t.caption, 'bucket', t.bucket, 'path', t.path,
             'created_at', t.file_row->>'created_at',
             'deleted_at', t.deleted_at,
             'deleted_by', coalesce(u.full_name, u.username, u.email),
             'purge_on', (t.deleted_at + make_interval(days => v_days))::date,
             'was_on', (select string_agg(lf.name, ', ' order by lf.sort_order)
                          from jsonb_array_elements(t.links) l
                          join public.library_folders lf on lf.id = (l->>'library_folder_id')::uuid),
             'links', jsonb_array_length(t.links)
           ) order by t.deleted_at desc)
      from public.file_trash t
      left join public.app_users u on u.id = t.deleted_by_user_id
     where t.project_id = p_project), '[]'::jsonb));
end $function$;

revoke execute on function public.portal_file_trash(uuid) from public, anon;
revoke execute on function public.portal_file_restore(uuid) from public, anon;
revoke execute on function public.portal_file_purge(uuid) from public, anon;
revoke execute on function public.portal_file_bin_purge(uuid, boolean) from public, anon;
revoke execute on function public.portal_file_bin(uuid) from public, anon;
grant execute on function public.portal_file_trash(uuid) to authenticated;
grant execute on function public.portal_file_restore(uuid) to authenticated;
grant execute on function public.portal_file_purge(uuid) to authenticated;
grant execute on function public.portal_file_bin_purge(uuid, boolean) to authenticated;
grant execute on function public.portal_file_bin(uuid) to authenticated;

update public.config set schema_version = schema_version + 1, schema_updated_at = current_date;
