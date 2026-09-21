-- A SCOPE LINE SAYS WHERE IT CAME FROM.
--
-- Shahar, 2026-09-21: "the scope panel should be a scope page with step by
-- step guidance to complete it. from standard (include yes / no), to
-- optional (include yes / no), and special - added by user (include yes /
-- no)."
--
-- Three groups, and the database could only supply two of them.
-- bid_package_items.kind already tells base from option, so "optional" was
-- answerable. Nothing on the wire said whether a base line arrived with the
-- trade's blueprint or was typed by somebody on this job, so "standard" and
-- "special" were the same thing to any screen.
--
-- project_scope_items.origin has held the answer all along - 'blueprint
-- copy' against the lines a package seeded, 'project' against the ones a
-- person wrote, 'promoted' against a line lifted off another job. It simply
-- was not selected. One key, no new column (rulebook 30/34: the fact exists,
-- it was just not being read).
--
--   standard - kind = base, origin = blueprint copy
--   optional - kind = option, wherever it came from
--   special  - kind = base, origin anything else
do $$
declare
  src text; out_sql text; n int;
  a constant text := '''category'', s.category, ''is_required'', i.is_required, ''sort'', i.sort, ''qty'', i.qty, ''unit'', i.unit,';
  b constant text := '''category'', s.category, ''is_required'', i.is_required, ''sort'', i.sort, ''qty'', i.qty, ''unit'', i.unit,
                ''origin'', s.origin, ''source'', s.source,';
begin
  src := pg_get_functiondef('public.portal_bid_package(uuid)'::regprocedure);
  n := (length(src) - length(replace(src, a, ''))) / length(a);
  if n <> 1 then
    raise exception 'The item block matched % times, expected 1. portal_bid_package has drifted.', n;
  end if;
  out_sql := replace(src, a, b);
  execute out_sql;
end $$;
