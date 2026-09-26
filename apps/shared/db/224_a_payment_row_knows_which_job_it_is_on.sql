-- A PAYMENT ROW KNOWS WHICH JOB IT IS ON.
--
-- The money block of portal_pro_overview returns the house and the job's
-- name but not its id, so every row on the new Professionals landing would
-- be a line of text you cannot tap - the one thing a landing must never be.
-- Two lines, and each row becomes a door onto that job's money.
do $$
declare
  src text; out_sql text; n int;
  a1 constant text := '         pr.project_name, pr.house, c.title as contract_title';
  b1 constant text := '         pr.id as project_id, pr.project_name, pr.house, c.title as contract_title';
  a2 constant text := '        ''id'', s.id, ''name'', s.name, ''due_on'', s.due_on, ''amount'', s.amount,';
  b2 constant text := '        ''id'', s.id, ''name'', s.name, ''due_on'', s.due_on, ''amount'', s.amount,
        ''project_id'', s.project_id,';
begin
  src := pg_get_functiondef('public.portal_pro_overview()'::regprocedure);
  n := (length(src) - length(replace(src, a1, ''))) / length(a1);
  if n <> 1 then
    raise exception 'The stage CTE matched % times, expected 1.', n;
  end if;
  n := (length(src) - length(replace(src, a2, ''))) / length(a2);
  if n <> 1 then
    raise exception 'The money row matched % times, expected 1.', n;
  end if;
  out_sql := replace(replace(src, a1, b1), a2, b2);
  execute out_sql;
end $$;

revoke all on function public.portal_pro_overview() from public, anon;
grant execute on function public.portal_pro_overview() to authenticated, service_role;
