-- 126. A TASK LIST CAN SHOW THE LATEST WORD ON IT.
--
-- Shahar (2026-09-15): "when you show the tasks open, show in table format.
-- assigned to, name, stage, comment, target end date."
--
-- Four of the five were already on portal_tasks. The comment was not:
-- actions.status_note - "where this stands", the line the task screen asks
-- for and thirteen open tasks already carry - never left the database. notes
-- is what the task IS; status_note is what is happening to it, and on a list
-- the second one is the one worth a column.
--
-- Both come through now; the screen prefers the status note and falls back to
-- the description when nobody has said anything yet.
do $patch$
declare src text; out_ text;
begin
  src := pg_get_functiondef('public.portal_tasks(uuid,integer,integer,text)'::regprocedure);
  -- The column has to be carried through the base CTE before it can be output.
  out_ := replace(src,
    $a$         a.notes, a.domain, a.project_id, p.project_name,$a$,
    $b$         a.notes, a.status_note, a.domain, a.project_id, p.project_name,$b$);
  out_ := replace(out_,
    $a$  'notes', left(t.notes, 400),$a$,
    $b$  'notes', left(t.notes, 400),
  'status_note', left(t.status_note, 400),$b$);
  if out_ = src then
    raise exception 'portal_tasks has drifted - neither anchor matched';
  end if;
  if out_ not like '%a.status_note, a.domain%' or out_ not like '%''status_note'', left(t.status_note%' then
    raise exception 'portal_tasks has drifted - expected both anchors';
  end if;
  execute out_;
end $patch$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
