-- SAY IT IN ONE LINE.
--
-- Shahar, 2026-09-21, on the refusal 220 had just rewritten: "top part
-- should say simply: add evidence or write why none is added."
--
-- 220 traded an error code for a paragraph:
--
--   "This task needs a photograph before it can be closed. Take one, or
--   attach an image to a progress note - or close it with force if there is
--   nothing to photograph."
--
-- Three sentences to say one thing, and the last of them names FORCE, which
-- is not a word on the screen. There is no force button: choosing Completed
-- with nothing attached is what makes the app ask why, and the answer IS the
-- override. Telling somebody to "close it with force" sends them looking for
-- a control that does not exist.
--
-- The refusal is the label on the box that appears under it, so the two now
-- say the same words.
do $$
declare
  src text; out_sql text; n int;
  a constant text := 'This task needs a photograph before it can be closed. Take one, or attach an image to a progress note - or close it with force if there is nothing to photograph.';
  b constant text := 'Add evidence, or write why none is added.';
begin
  src := pg_get_functiondef('public.close_action(uuid,boolean,text,text,boolean)'::regprocedure);
  n := (length(src) - length(replace(src, a, ''))) / length(a);
  if n <> 1 then
    raise exception 'The refusal text matched % times, expected 1.', n;
  end if;
  out_sql := replace(src, a, b);
  execute out_sql;
end $$;
