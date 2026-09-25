-- A FILE IS UPLOADED ONCE.
--
-- Shahar, 2026-09-25, looking at the Asbestos shelf: the UCC certificate
-- and the IAQ Guru invoice each showed twice - once hand-filed today, once
-- by trade from 2026-09-16 - "your algo for checking files are identical
-- don't work. if this is a duplicate file, present a link instead of adding
-- the file again." There was no algorithm: files.sha256 has existed since
-- the file store was built and not one of its 120 rows carried a value.
-- The action "Block duplicate file uploads in the project library"
-- (2026-09-24) had the design; this builds it.
--
-- THE BROWSER FINGERPRINTS, THE DATABASE REMEMBERS. The library hashes each
-- file (SHA-256, crypto.subtle) before a byte moves and asks
-- portal_file_twins. A twin on the same project is offered as a link - the
-- existing row is filed into the shelf (file_links, rule 30), nothing is
-- uploaded. Files recorded before today have no fingerprint, so the same
-- call returns the unhashed files of the exact same size; the browser hashes
-- those few itself and writes the answer back through portal_file_fingerprint,
-- so the store fills in as it is used.
--
-- record_project_file learns p_sha256 and, as a safety net for a race, hands
-- back the existing row instead of inserting a second one. Adding a
-- parameter changes the signature, so it is dropped and made again; the SQL
-- callers pass seven positional arguments and still resolve.

drop function if exists public.record_project_file(uuid, text, text, text, bigint, text, text);

create function public.record_project_file(
  p_project_id uuid, p_path text, p_file_name text default null, p_mime text default null,
  p_size bigint default null, p_caption text default null, p_kind text default null,
  p_sha256 text default null)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  me     uuid := public.current_app_user_id();
  v_kind text := coalesce(nullif(btrim(p_kind), ''), public.file_kind_for_mime(p_mime));
  v_sha  text := lower(nullif(btrim(p_sha256), ''));
  v_id   uuid;
  e      record;
  used   bigint;
begin
  perform public.assert_own_hands();
  if me is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.can_edit_project(p_project_id) then
    raise exception 'You have read-only access on this project.' using errcode = '42501';
  end if;
  if p_path is null or btrim(p_path) = '' then
    raise exception 'A stored path is required' using errcode = '22023';
  end if;
  if v_sha is not null and v_sha !~ '^[0-9a-f]{64}$' then
    raise exception 'A SHA-256 fingerprint is 64 hex characters' using errcode = '22023';
  end if;

  -- One file, one row: the same bytes already on this project come back as
  -- the row that holds them.
  if v_sha is not null then
    select f.id into v_id from public.files f
     where f.project_id = p_project_id and f.sha256 = v_sha
     order by f.created_at limit 1;
    if v_id is not null then return v_id; end if;
  end if;

  -- Entitlement gate: capability by kind, then quota. Superadmin bypasses.
  select * into e from public.user_entitlement(me);
  if not coalesce(e.is_super, false) then
    if    v_kind = 'video'                               and not e.cap_video    then
      raise exception 'Your plan does not allow video uploads.' using errcode = '42501';
    elsif v_kind = 'audio'                               and not e.cap_voice    then
      raise exception 'Your plan does not allow voice uploads.' using errcode = '42501';
    elsif v_kind = 'photo'                               and not e.cap_image    then
      raise exception 'Your plan does not allow photo uploads.' using errcode = '42501';
    elsif v_kind in ('document','drawing','other')       and not e.cap_document then
      raise exception 'Your plan does not allow document uploads.' using errcode = '42501';
    end if;
    if e.quota_bytes is not null then
      select public.user_storage_bytes(me) into used;
      if used + coalesce(p_size, 0) > e.quota_bytes then
        raise exception 'Storage quota reached — % of % used. Free up space or ask an admin to raise your quota.',
          pg_size_pretty(used), pg_size_pretty(e.quota_bytes) using errcode = '53100';
      end if;
    end if;
  end if;

  insert into public.files
    (project_id, bucket, path, file_name, mime_type, size_bytes, kind, caption,
     taken_at, uploaded_by_user_id, sha256)
  values (p_project_id, 'project-media', p_path, p_file_name, p_mime, p_size, v_kind,
          nullif(btrim(p_caption), ''), now(), me, v_sha)
  returning id into v_id;

  insert into public.file_links (file_id, project_id, role, created_by_user_id)
  values (v_id, p_project_id,
          case when v_kind = 'photo' then 'progress' else 'reference' end, me);

  return v_id;
end $function$;

grant execute on function public.record_project_file(uuid, text, text, text, bigint, text, text, text)
  to anon, authenticated, service_role;

create index if not exists files_project_sha256_idx
  on public.files (project_id, sha256) where sha256 is not null;

-- Is this file already here? A fingerprint match, or - for rows recorded
-- before fingerprints - the unhashed files of the very same size, for the
-- browser to hash and settle.
create or replace function public.portal_file_twins(p_project uuid, p_sha256 text, p_size bigint)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
declare v_sha text := lower(nullif(btrim(p_sha256), '')); v_match jsonb; v_unhashed jsonb;
begin
  if not (public.can_edit_project(p_project) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'reason', 'This project''s files are not yours to add to.');
  end if;

  select jsonb_build_object('id', f.id, 'file_name', f.file_name, 'caption', f.caption,
           'created_at', f.created_at, 'bucket', f.bucket, 'path', f.path)
    into v_match
    from public.files f
   where f.project_id = p_project and v_sha is not null and f.sha256 = v_sha
   order by f.created_at limit 1;

  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'file_name', f.file_name, 'caption', f.caption,
           'created_at', f.created_at, 'bucket', f.bucket, 'path', f.path) order by f.created_at), '[]'::jsonb)
    into v_unhashed
    from public.files f
   where v_match is null and p_size is not null
     and f.project_id = p_project and f.sha256 is null and f.size_bytes = p_size;

  return jsonb_build_object('ok', true, 'match', v_match, 'unhashed', v_unhashed);
end $function$;

-- Write back a fingerprint the browser computed from the stored bytes. Only
-- ever fills a blank: a fingerprint, once set, is not rewritten.
create or replace function public.portal_file_fingerprint(p_file uuid, p_sha256 text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_project uuid; v_sha text := lower(nullif(btrim(p_sha256), ''));
begin
  if v_sha is null or v_sha !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'reason', 'A SHA-256 fingerprint is 64 hex characters.');
  end if;
  select project_id into v_project from public.files where id = p_file;
  if v_project is null then return jsonb_build_object('ok', false, 'reason', 'No such file.'); end if;
  if not (public.can_edit_project(v_project) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'reason', 'That file is not yours to fingerprint.');
  end if;
  update public.files set sha256 = v_sha where id = p_file and sha256 is null;
  return jsonb_build_object('ok', true);
end $function$;

revoke all on function public.portal_file_twins(uuid, text, bigint) from public, anon;
revoke all on function public.portal_file_fingerprint(uuid, text) from public, anon;
grant execute on function public.portal_file_twins(uuid, text, bigint) to authenticated, service_role;
grant execute on function public.portal_file_fingerprint(uuid, text) to authenticated, service_role;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
