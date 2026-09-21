-- THE GENERATOR JOBS THAT ALREADY EXIST GET THEIR STEPS.
--
-- 226 made it impossible to CREATE a package job without its process. The
-- rule Shahar set is not "from now on" - "we cannot have DIY generator
-- project without all the steps required" is about the board as it stands,
-- and on this database that is one live generator job with the process never
-- started: Ran's, at 8 Jason Woods Road. The other three are Closed -
-- Cancelled and stay as they are.
--
-- Separated from 226 deliberately: 226 is machinery and changes no data,
-- this one writes to a live job. They roll back independently and this one
-- says out loud what it touched.
--
-- AND THE BID TREE COMES OFF. Ran's job carries fifteen tasks from the
-- generic "Hire contractor" blueprint - build a scope, bid it to three,
-- visit an active job site, negotiate, sign - under a parent that calls
-- itself "(for Shahar's review)". Shahar, on the flow: "I would like to do
-- it alone... I am meeting with plumber and electrician to sign the papers."
-- There is nothing to bid. Two processes on one job that disagree about how
-- the work gets done is worse than either alone, so the bidding one is
-- CANCELLED, not deleted: the record of it survives and so does anything
-- that pointed at it.
--
-- THE THREE THAT ALREADY HAPPENED ARE LEFT ALONE. "Bid to 3 contractors",
-- "Meet in person" and "Negotiate" are Completed. They happened; cancelling
-- them would be rewriting what somebody did. Only the twelve that never
-- started, and the parent over them, are closed out.
do $mig$
declare
  ran constant uuid := 'b5a6bc27-4b88-43f7-a4fe-cbd7664a246a';
  bid_parent constant uuid := '0882e816-8279-4b4d-a341-8c7a577f9028';
  r record; res jsonb; n int := 0; total int := 0; killed int := 0;
begin
  -- ---- the bidding tree, on the one job that carries it -------------------
  if exists (select 1 from public.actions where id = bid_parent and project_id = ran) then
    update public.actions
       set status = 'Cancelled',
           status_note = 'Cancelled 2026-09-21: this job is run by the owner with his own plumber and electrician, so there is nothing to bid. The generator process is the process here.'
     where (id = bid_parent or parent_action_id = bid_parent)
       and project_id = ran
       and status not in ('Completed', 'Cancelled', 'Force Cancelled', 'Superseded');
    get diagnostics killed = row_count;
    raise notice 'Bid tree: % task(s) cancelled, the completed ones left standing.', killed;
  else
    raise notice 'Bid tree: not there, nothing cancelled.';
  end if;

  -- ---- running it himself, and the record should say so -------------------
  update public.projects set delivery = 'diy'
   where id = ran and coalesce(delivery, '') is distinct from 'diy';

  -- ---- the process, on every live job that names a package with one -------
  for r in
    select p.id, p.project_name
      from public.projects p
      join public.blueprint_packages bp on bp.code = p.package_code
     where bp.activity_blueprint_id is not null and bp.is_active
       and p.trashed_at is null and not coalesce(p.is_template, false)
       and coalesce(p.status, '') not like 'Closed%'
       and not exists (select 1 from public.actions a
                        where a.project_id = p.id
                          and a.activity_blueprint_id = bp.activity_blueprint_id)
     order by p.created_at
  loop
    res := public.project_process_start(r.id);
    raise notice '% -> %', r.project_name, res;
    if coalesce((res->>'steps')::int, 0) > 0 then
      n := n + 1;
      total := total + (res->>'steps')::int;
    end if;
  end loop;
  raise notice 'Process started on % job(s), % step(s) in all.', n, total;
end $mig$;
