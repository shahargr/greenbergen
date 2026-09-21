-- 194b: two opens in one transaction were a tie, and a tie had no answer.
--
-- FOUND BY BECOMING SOMEBODY (rulebook 70). Opening two projects as a real
-- bounded member returned the FIRST one, not the last. now() is
-- transaction_timestamp(): it does not move inside a transaction, so both
-- rows were stamped identically and "order by last_opened_at desc limit 1"
-- picked whichever the planner reached first.
--
-- In production each RPC is its own transaction, so the tie needed a test to
-- show itself - but the shape of the bug is real and two things were wrong:
--
-- clock_timestamp() is what this column always meant. It is the moment the
-- CALL happened, not the moment its transaction opened, which is the honest
-- reading of "when did I last open this".
--
-- AND THE ORDER IS NOW TOTAL. A tie is unlikely once the clock advances, but
-- "unlikely" is not "impossible" - two opens can still land inside one
-- transaction, and a query whose answer depends on which row the planner
-- happened to reach is a query that will eventually disagree with itself.
-- project_id breaks the tie, so the same data always gives the same landing.

create or replace function public.mark_project_opened(p_project uuid)
returns void
language sql
set search_path to 'public'
as $fn$
  insert into public.user_project_prefs (app_user_id, project_id, last_opened_at, updated_at)
  select public.current_app_user_id(), p_project, clock_timestamp(), now()
   where public.current_app_user_id() is not null
     and p_project is not null
     and public.is_project_member(p_project)
  on conflict (app_user_id, project_id) do update set last_opened_at = clock_timestamp();
$fn$;

create or replace function public.my_last_project()
returns uuid
language sql
stable
set search_path to 'public'
as $fn$
  select p.id
    from public.user_project_prefs up
    join public.projects p on p.id = up.project_id
   where up.app_user_id = public.current_app_user_id()
     and up.last_opened_at is not null
     and p.trashed_at is null
     and p.archived_at is null
     and p.disabled_at is null
   order by up.last_opened_at desc, up.project_id desc
   limit 1;
$fn$;

update public.config
   set schema_version = 463,
       schema_updated_at = current_date;
