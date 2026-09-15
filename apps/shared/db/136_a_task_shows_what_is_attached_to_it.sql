-- 136. A TASK SHOWS WHAT IS ATTACHED TO IT.
--
-- Shahar (2026-09-15), opening the task he had just made: "task got created
-- and i entered it. when it was created a photo was uploaded. why don't you
-- show it here on the task?"
--
-- Because nothing ever has. portal_task_detail has returned `evidence` - the
-- files linked straight to the action rather than to a note - since it was
-- written, and the task screen COUNTS them and stops. The count feeds one
-- thing: whether the photo gate is satisfied. The pictures themselves were
-- never drawn. Notes render theirs; the task's own have been invisible since
-- the day the new-task screen learned to take attachments.
--
-- Nothing is lost - they are linked, they are in the folder, and the gate
-- sees them - but a photograph nobody can look at is a photograph nobody took.
--
-- The payload gains the one field it was missing to draw them properly: the
-- caption, which is the line typed under each file when it was attached
-- (migration 113). A picture with "the panel, showing the amperage" under it
-- is worth reading; the same picture called IMG_4417.jpeg is not.
do $patch$
declare src text; out_ text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'portal_task_detail';

  out_ := replace(src,
    E'        select jsonb_agg(jsonb_build_object(\'id\', f.id, \'file_name\', f.file_name, \'kind\', f.kind,\n'
    || E'                                            \'bucket\', f.bucket, \'path\', f.path, \'role\', fl.role)\n',
    E'        select jsonb_agg(jsonb_build_object(\'id\', f.id, \'file_name\', f.file_name, \'kind\', f.kind,\n'
    || E'                                            \'bucket\', f.bucket, \'path\', f.path, \'role\', fl.role,\n'
    || E'                                            \'caption\', f.caption, \'mime\', f.mime_type,\n'
    || E'                                            \'created_at\', f.created_at)\n');

  if out_ = src then
    raise exception 'portal_task_detail has drifted - the evidence block is not where it was.';
  end if;
  execute out_;
end $patch$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
