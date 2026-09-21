-- ONE task_payment_log, NOT TWO.
--
-- Migration 203 added p_contract and p_budget_category to task_payment_log.
-- Adding parameters CHANGES THE SIGNATURE, so `create or replace` did not
-- replace anything - it created a second function beside the first. Postgres
-- then had two candidates for every call that named only the original
-- arguments, and answered 42725: "function public.task_payment_log(...) is
-- not unique".
--
-- That broke the quick task-and-payment box on the trade screen, whose
-- portal_task_quick_paid calls task_payment_log with twelve named arguments
-- and no contract. It is the box Shahar logs from standing on site.
--
-- The 16-argument version is a superset: the two new parameters default to
-- null and the body no-ops when both are. So the old one goes, and the ACL
-- improves on the way out - the 14-argument version still carried a PUBLIC
-- execute grant (`=X/postgres`), which the newer one does not.
drop function if exists public.task_payment_log(
  uuid, numeric, uuid, uuid, text, text, date, text, text, text, boolean, uuid[], uuid, text);

do $$
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'task_payment_log') <> 1 then
    raise exception 'task_payment_log must be exactly one function after this migration';
  end if;
end $$;
