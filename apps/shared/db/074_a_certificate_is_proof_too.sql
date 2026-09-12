-- 074 - a certificate is proof too.
--
-- Shahar (2026-09-12), closing "J&W Carpentry - obtain RENEWED workers comp
-- certificate": "Bug. error saving asking for photo where PDF files were
-- attached."
--
-- He had attached the certificate. portal_close_task counted
-- `f.kind = 'photo'` and nothing else, so the one document that IS the proof
-- for that task did not count, and the screen asked him to photograph
-- something. There is nothing to photograph: the evidence for a certificate
-- is the certificate.
--
-- The gate was always meant to ask "show me it happened", and a PDF, a
-- recording of the inspector, or a video of the wall answer that as well as a
-- photograph does. So it counts ANY file attached to the task or to a note on
-- it. The unlock is untouched - close with nothing attached and you still say
-- why, in writing, against the task.
--
-- The code changes with the meaning: NEEDS_EVIDENCE. The apps accept the old
-- NEEDS_PHOTO too, because a deployed page may still be asking for it while
-- this lands.
create or replace function public.portal_close_task(p_action_id uuid, p_unlock_reason text default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  a public.actions; me uuid := public.current_app_user_id(); actor text;
  n_proof int; reason text := nullif(btrim(p_unlock_reason), ''); prefix text; res jsonb;
begin
  perform public.assert_own_hands();
  if me is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if not public.can_see_action(p_action_id) then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND', 'reason', 'That task is not yours to close.');
  end if;

  select * into a from public.actions where id = p_action_id;
  if not public.can_edit_project(a.project_id) then
    return jsonb_build_object('ok', false, 'code', 'READ_ONLY', 'reason', 'You have read-only access on this project.');
  end if;

  select coalesce(u.full_name, u.email, u.username) into actor
    from public.app_users u where u.id = me;

  -- ANY file, on the task itself or on a note posted against it. A photo, a
  -- certificate, a permit, a recording - all of them are somebody showing
  -- what happened, which is the only thing this gate was ever asking for.
  select count(*) into n_proof
    from public.file_links fl
    join public.files f on f.id = fl.file_id
   where (fl.action_id = p_action_id
          or fl.action_comment_id in (select c.id from public.action_comments c where c.action_id = p_action_id));

  if n_proof = 0 and reason is null then
    return jsonb_build_object('ok', false, 'code', 'NEEDS_EVIDENCE',
             'reason', 'Attach the proof - a photo, the certificate, a recording - or unlock and say why there is none.');
  end if;

  if n_proof = 0 then
    if length(reason) < 8 then
      return jsonb_build_object('ok', false, 'code', 'REASON_TOO_SHORT',
               'reason', 'Say why in a few words - this is recorded against the task.');
    end if;
    prefix := case
                when a.source like 'system:transaction:%' then 'CONFIRMATION RECORDED: '
                else 'CLOSED WITHOUT PROOF. Reason given: '
              end;
    insert into public.action_comments (action_id, body, author)
    values (p_action_id, prefix || reason, coalesce(actor, 'portal'));
  end if;

  begin
    res := public.close_action(p_action_id, n_proof = 0, coalesce(actor, 'portal'));
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'BLOCKED', 'reason', sqlerrm);
  end;

  -- 'photos' kept in the answer under its old name for anything still reading
  -- it; it counts every kind of proof now.
  return jsonb_build_object('ok', true, 'photos', n_proof, 'proof', n_proof,
                            'unlocked', n_proof = 0, 'result', res);
end $function$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
