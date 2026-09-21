-- A PHOTO GATE THAT CAN ACTUALLY BE SATISFIED.
--
-- Shahar, 2026-09-21, trying to close a task after uploading a photo:
--
--   MISSING_PHOTO_EVIDENCE: task 8cb3ff64-... needs BEFORE image and
--   AFTER image. Please upload an image, or close with force to override.
--
-- He had uploaded an image. The banner above the refusal said "Posted, with
-- 1 attached". Both were true, and they were about different things.
--
-- THE NUMBERS SAY IT PLAINLY. role = 'before' has ZERO rows in this database
-- and always has. Thirteen tasks carry requires_photo_evidence; not one of
-- them has ever been closeable without force, and nine are still open. The
-- only code that writes 'before' is a radio on the project SCOPE screen,
-- which attaches to a scope item rather than to an action, so it could never
-- satisfy this. The task screen's own upload is hardcoded:
--
--   p_role: isImage ? "after" : "evidence"
--
-- Always 'after'. Never 'before'. The gate demanded something the app had no
-- way to produce, so its only effect was to teach people to press force -
-- which is worse than having no gate at all, because a force-closed task
-- looks deliberate in the record.
--
-- AND THE PHOTOS PEOPLE DO TAKE WERE NOT BEING COUNTED. "Log progress"
-- attaches to the COMMENT (file_links.action_comment_id), not to the action.
-- Shahar's photo is on comment 9ebc93b7 with role 'evidence'. A progress
-- photo of this task is a photo of this task, and the gate could not see it.
--
-- SO THE RULE CHANGES, deliberately and not silently: the task needs A
-- PHOTOGRAPH - on the task or on any of its progress notes. Before-and-after
-- stays the ideal and is reported when both are there, but it is no longer
-- demanded, because you cannot ask somebody standing in front of finished
-- work to go back and take a photograph of it unfinished. A rule that can
-- only be obeyed by overriding it is not a rule.
do $$
declare
  src text; out_sql text; n int;
  a constant text :=
'  if a.requires_photo_evidence and p_final_status <> ''Cancelled'' then
    if not exists (select 1 from public.file_links fl
                    where fl.action_id = p_action_id and fl.role = ''before'') then
      missing := missing || ''BEFORE image''::text;
    end if;
    if not exists (select 1 from public.file_links fl
                    where fl.action_id = p_action_id and fl.role = ''after'') then
      missing := missing || ''AFTER image''::text;
    end if;

    if array_length(missing, 1) is not null then
      if not p_force then
        raise exception ''MISSING_PHOTO_EVIDENCE: task % needs %. Please upload an image, or close with force to override.'',
          p_action_id, array_to_string(missing, '' and '')
          using errcode = ''P0001'';
      end if;
      photo_forced := true;
    end if;
  end if;';
  b constant text :=
'  if a.requires_photo_evidence and p_final_status <> ''Cancelled'' then
    -- EVERY PHOTOGRAPH OF THIS TASK, wherever it was attached: straight onto
    -- the task, or onto one of its progress notes, which is where the "Log
    -- progress" box puts them.
    if not exists (
         select 1 from public.file_links fl
           join public.files f on f.id = fl.file_id
          where coalesce(f.kind, '''') = ''photo''
            and (fl.action_id = p_action_id
                 or fl.action_comment_id in (
                      select ac.id from public.action_comments ac
                       where ac.action_id = p_action_id))) then
      missing := missing || ''a photograph''::text;
    end if;

    if array_length(missing, 1) is not null then
      if not p_force then
        raise exception ''This task needs a photograph before it can be closed. Take one, or attach an image to a progress note - or close it with force if there is nothing to photograph.''
          using errcode = ''P0001'';
      end if;
      photo_forced := true;
    end if;
  end if;';
begin
  src := pg_get_functiondef('public.close_action(uuid,boolean,text,text,boolean)'::regprocedure);
  n := (length(src) - length(replace(src, a, ''))) / length(a);
  if n <> 1 then
    raise exception 'The photo gate matched % times, expected 1. close_action has drifted.', n;
  end if;
  out_sql := replace(src, a, b);
  execute out_sql;
end $$;
