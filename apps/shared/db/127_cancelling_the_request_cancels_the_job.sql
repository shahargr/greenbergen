-- 127. CANCELLING THE REQUEST CANCELS THE JOB.
--
-- Shahar (2026-09-15), looking at four rows filed under "Lining up": "if
-- lined up means its in a bidding stage, or waiting on contractor to pick up
-- the job, check your error, as all these four been cancelled."
--
-- He is right about three of them and the bucket is not the bug. What the
-- database actually holds:
--
--   EV charger install  9d9e6dba   booking CLOSED    project In Progress
--   EV charger install  966b7f35   booking CLOSED    project In Progress
--   Standby generator   1fa16e3d   booking CLOSED    project In Progress
--
-- The homeowner door's "Cancel this request" runs homeowner_booking_action
-- with 'close'. That closes the bid package, expires the bids, marks the
-- booking closed - AND LEAVES THE PROJECT ALONE. It stays 'In Progress' at
-- stage 'bid' with its milestone tasks open, so project_progress reads it,
-- correctly, as a job with things to do and nobody on it: "On your list".
-- A cancelled job that goes on describing itself as a live one.
--
-- The fourth row, "Improvements" (41b4ce04), is a different animal and is NOT
-- cancelled: close_project_incomplete made it on 2026-08-26 to hold three
-- open tasks carried out of 52 Ryerson at close (Patio sitting area, Pergola,
-- Deck sitting area - Zoe's and Bobby's). Real work, not a cancelled order.
-- It is left exactly as it is.
--
-- WHAT THIS CHANGES. For a job that exists only because of a booking, the
-- request IS the job, so cancelling one cancels the other - by calling
-- portal_project_cancel, the rule that already exists, rather than inventing
-- a second cancellation. It only fires when there is nothing else on the job:
-- no other open package, nobody hired, no contract, nothing paid. If there
-- is, the request closes and the job stays, and the answer says so.
--
-- AND THE WAY BACK. The closed screen offers "Reopen at $X", which reposts
-- the package - into a cancelled project, if this migration stopped at the
-- close. So the reopen arm now reopens the job first, puts the stage back to
-- 'bid', and restores the tasks the cancel took with it. They are found by a
-- marker written onto them on the way out, because close_action overwrites
-- last_modified_by with the actor's name and leaves nothing else to match on.
do $patch$
declare src text; out_ text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'homeowner_booking_action';

  out_ := src;

  -- 1. The locals the two new arms need.
  out_ := replace(out_,
    'declare b public.project_bookings; pr public.projects; v_new integer; v_pkg uuid; pk public.bid_packages; v_reply timestamptz;',
    'declare b public.project_bookings; pr public.projects; v_new integer; v_pkg uuid; pk public.bid_packages; v_reply timestamptz;'
    || E'\n  v_left int; v_crew int; v_contracts int; v_paid numeric; v_res jsonb; v_mark text;');

  -- 2. Reopening a cancelled job reopens the JOB, not just the request.
  out_ := replace(out_,
    E'  if p_action in (\'bump\', \'reopen\') then\n    v_new :=',
    E'  if p_action in (\'bump\', \'reopen\') then\n'
    || E'    -- A closed request on a cancelled job: put the job back before\n'
    || E'    -- reposting into it, and give back the tasks the cancel took.\n'
    || E'    if p_action = \'reopen\' and pr.status like \'Closed%\' then\n'
    || E'      v_mark := \'[booking-cancel:\' || b.id || \']\';\n'
    || E'      v_res := public.portal_project_reopen(p_project, \'Reposted from the homeowner app.\');\n'
    || E'      if not coalesce((v_res->>\'ok\')::boolean, false) then\n'
    || E'        return jsonb_build_object(\'ok\', false, \'reason\', coalesce(v_res->>\'reason\', \'Could not reopen this job.\'));\n'
    || E'      end if;\n'
    || E'      update public.projects set stage = \'bid\', last_modified_at = now(), last_modified_by = \'homeowner-app:repost\'\n'
    || E'       where id = p_project;\n'
    || E'      update public.actions\n'
    || E'         set status = \'Not Started\', completed_on = null, last_modified_by = \'homeowner-app:repost\'\n'
    || E'       where project_id = p_project and status in (\'Cancelled\',\'Force Cancelled\')\n'
    || E'         and coalesce(notes, \'\') like \'%\' || v_mark || \'%\';\n'
    || E'      select * into pr from public.projects where id = p_project;\n'
    || E'    end if;\n'
    || E'    v_new :=');

  -- 3. Closing the request closes the job, when the request was the job.
  out_ := replace(out_,
    E'    update public.project_bookings set state = \'closed\', closed_at = now(), close_reason = \'Closed by the homeowner\' where id = b.id;\n    return jsonb_build_object(\'ok\', true);',
    E'    update public.project_bookings set state = \'closed\', closed_at = now(), close_reason = \'Closed by the homeowner\' where id = b.id;\n'
    || E'    -- Is the request the whole job? Another open package, a hired\n'
    || E'    -- crew, a contract or a dollar paid all mean no - then the\n'
    || E'    -- request closes and the job carries on without it.\n'
    || E'    select count(*) into v_left from public.bid_packages\n'
    || E'     where project_id = p_project and coalesce(status, \'\') <> \'closed\';\n'
    || E'    select count(*) into v_crew from public.project_members\n'
    || E'     where project_id = p_project and status = \'active\'\n'
    || E'       and coalesce(project_role, \'\') not in (\'asset owner\',\'viewer\');\n'
    || E'    select count(*) into v_contracts from public.contracts\n'
    || E'     where project_id = p_project and coalesce(status, \'\') <> \'placeholder\';\n'
    || E'    select coalesce(sum(amount), 0) into v_paid from public.transactions\n'
    || E'     where project_id = p_project\n'
    || E'       and coalesce(status, \'\') in (\'paid\',\'paid - receipt filed\',\'paid - pending confirmation\',\'settled\');\n'
    || E'    if v_left > 0 or v_crew > 0 or v_contracts > 0 or coalesce(v_paid, 0) > 0 then\n'
    || E'      return jsonb_build_object(\'ok\', true, \'job_cancelled\', false,\n'
    || E'        \'job_reason\', \'There is other work on this job, so the job itself stays open.\');\n'
    || E'    end if;\n'
    || E'    -- The marker that makes the undo possible: close_action stamps\n'
    || E'    -- the actor over last_modified_by, so the notes carry it.\n'
    || E'    v_mark := \'[booking-cancel:\' || b.id || \']\';\n'
    || E'    update public.actions set notes = coalesce(notes || E\'\\n\', \'\') || v_mark\n'
    || E'     where project_id = p_project\n'
    || E'       and status in (\'Not Started\',\'In Progress\',\'Parked\',\'Pending on Others\',\'Completed Pending Approval\',\'Completed Pending\')\n'
    || E'       and coalesce(notes, \'\') not like \'%\' || v_mark || \'%\';\n'
    || E'    v_res := public.portal_project_cancel(p_project,\n'
    || E'      \'The homeowner cancelled the request in the app.\');\n'
    || E'    return jsonb_build_object(\'ok\', true,\n'
    || E'      \'job_cancelled\', coalesce((v_res->>\'ok\')::boolean, false),\n'
    || E'      \'job_reason\', v_res->>\'reason\');');

  if out_ = src then
    raise exception 'homeowner_booking_action has drifted - none of the three patches applied.';
  end if;
  execute out_;
end $patch$;

-- THE THREE THAT ARE ALREADY STRANDED. Cancelled as requests on 2026-09-09
-- and 2026-09-11 and live as jobs ever since. Run through the same rule the
-- app now runs, as their owner, so the record reads the way it would have if
-- the door had been right at the time.
do $repair$
declare r record; v_res jsonb;
begin
  perform set_config('sgr.app_user_id', 'ca08b7e9-09bd-4e85-aec0-939239accdbd', true);
  for r in
    select p.id, p.project_name, b.id as booking_id
      from public.projects p
      join public.project_bookings b on b.project_id = p.id
     where p.id in ('9d9e6dba-2aa5-4e48-aeb0-618563909142',
                    '966b7f35-e5b7-434a-9e59-7138db3a1b10',
                    '1fa16e3d-6497-4f2a-86a0-6d553169da82')
       and b.state = 'closed'
       and p.status not like 'Closed%'
  loop
    update public.actions set notes = coalesce(notes || E'\n', '') || '[booking-cancel:' || r.booking_id || ']'
     where project_id = r.id
       and status in ('Not Started','In Progress','Parked','Pending on Others','Completed Pending Approval','Completed Pending')
       and coalesce(notes, '') not like '%[booking-cancel:' || r.booking_id || ']%';
    v_res := public.portal_project_cancel(r.id, 'The request was cancelled in the app; the job was left open by a defect in the homeowner door (migration 127).');
    raise notice 'REPAIR % -> %', r.project_name, v_res;
  end loop;
end $repair$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
