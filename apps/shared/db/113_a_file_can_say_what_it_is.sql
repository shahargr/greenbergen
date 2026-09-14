-- 113. A FILE CAN SAY WHAT IT IS.
--
-- Shahar (2026-09-14): "when uploading files, need to have a line of
-- description added optionally."
--
-- files.caption has been there since the beginning and nothing has ever
-- written anything but a constant into it - "Note evidence", "Scope photo".
-- So a job folder fills up with 2026-09-14 Closter Generator Permit.pdf and
-- IMG_4471.HEIC and nobody, six weeks later, can say which one is the one
-- the inspector wanted. The filename is what the camera called it. The
-- caption is what YOU call it, and it is the only one of the two worth
-- reading back.
--
-- It is written after the fact rather than before because the upload starts
-- the moment the file is picked - waiting for a description before sending
-- the bytes would make every attachment a two-step form, which is the
-- opposite of standing on site with one hand free.
create or replace function public.portal_file_caption(
  p_file_id uuid,
  p_caption text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare v_project uuid; v_text text := nullif(btrim(coalesce(p_caption, '')), '');
begin
  perform public.assert_own_hands();
  if public.current_app_user_id() is null then
    return jsonb_build_object('ok', false, 'reason', 'You need to be signed in.');
  end if;

  select f.project_id into v_project from public.files f where f.id = p_file_id;
  if v_project is null then
    return jsonb_build_object('ok', false, 'reason', 'No such file.');
  end if;
  -- The same test that let the file be recorded in the first place.
  if not (public.can_edit_project(v_project) or public.is_superadmin()) then
    return jsonb_build_object('ok', false, 'reason', 'That file is not yours to describe.');
  end if;

  -- Emptying it is a real intention: a description typed by mistake should
  -- be removable, and null is how "no caption" is spelled here.
  update public.files set caption = left(v_text, 500) where id = p_file_id;

  return jsonb_build_object('ok', true, 'file_id', p_file_id, 'caption', left(v_text, 500));
end $fn$;

comment on function public.portal_file_caption(uuid, text) is
  'Sets the description on a file already recorded against a project. Written after the upload, because the bytes should not wait on the typing. Blank clears it.';

grant execute on function public.portal_file_caption(uuid, text) to authenticated;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
