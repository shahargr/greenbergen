-- 117. A JOB OPENS WHETHER OR NOT IT WAS BOOKED.
--
-- 116 put the member's ten real jobs on the homeowner door. Six of them had
-- nowhere to go when tapped: homeowner_booking's second line is
--
--   select * into b from public.project_bookings where project_id = p_project;
--   if b.id is null then return null; end if;
--
-- and every screen in that app is built on it - the job page, the folder, the
-- timeline, the money, the people, the share card all call getBooking() and
-- redirect to /project when it comes back empty. Which is why, earlier today,
-- "I'm looking for a way to invite a contractor into this job" had no answer
-- in the homeowner door: the People screen existed and the job could not
-- reach it.
--
-- The fix is one line rather than six screens. A project with no booking row
-- gets a booking-shaped answer built from the project itself: no price, no
-- package, no wizard answers, and a state read off the project's own status.
-- Everything downstream - which is all of it - then works unchanged.
--
-- WHAT IS HONEST ABOUT THIS: it does not invent a price (zero, and the
-- screens already hide money they do not have), it does not invent a package,
-- and it says so - from_booking is false, so a screen can tell the difference
-- between "booked at $6,500" and "a job somebody started". What it does
-- invent is the STATE, and only by reading the project: In Progress means the
-- work is happening, Closed - Completed means it is done, anything else
-- closed means it stopped. That is the same reading a person does.
do $patch$
declare src text; out_ text; n int := 0;
begin
  src := pg_get_functiondef('public.homeowner_booking(uuid)'::regprocedure);
  out_ := src;

  -- A flag for which kind of answer this is.
  out_ := replace(out_,
    $a$declare b public.project_bookings; pr public.projects; my_contact uuid := public.my_contact_id(); v_is_owner boolean;$a$,
    $b$declare b public.project_bookings; pr public.projects; my_contact uuid := public.my_contact_id(); v_is_owner boolean; v_real boolean;$b$);

  -- The project is read FIRST, because without a booking it is the only
  -- thing there is to read.
  out_ := replace(out_,
    $a$  select * into b from public.project_bookings where project_id = p_project;
  if b.id is null then return null; end if;
  select * into pr from public.projects where id = p_project;$a$,
    $b$  select * into pr from public.projects where id = p_project;
  if pr.id is null or pr.trashed_at is not null then return null; end if;
  select * into b from public.project_bookings where project_id = p_project;
  v_real := b.id is not null;
  if not v_real then
    -- A JOB THAT NEVER CAME THROUGH THE WIZARD (migration 117). Built from
    -- the project so every screen below keeps working. Nothing here is
    -- guessed except the state, and the state is read off the project.
    b.project_id       := p_project;
    b.home_project_id  := pr.parent_project_id;
    b.package_code     := pr.package_code;
    b.created_at       := pr.created_at;
    b.price_cents      := 0;
    b.base_price_cents := 0;
    b.repost_count     := 0;
    b.offered_count    := 0;
    b.state := case when pr.status = 'Closed - Completed' then 'done'
                    when pr.status like 'Closed%'         then 'closed'
                    else 'accepted' end;
    b.accepted_at := case when pr.status not like 'Closed%' then pr.created_at end;
    b.done_at     := case when pr.status = 'Closed - Completed' then pr.last_modified_at end;
    b.closed_at   := case when pr.status like 'Closed%' and pr.status <> 'Closed - Completed'
                          then pr.last_modified_at end;
  end if;$b$);

  -- The job's own name, and whether any of this came from a booking.
  out_ := replace(out_,
    $a$    'address', pr.address, 'unit', b.unit, 'project_status', pr.status,$a$,
    $b$    'address', pr.address, 'unit', b.unit, 'project_status', pr.status,
    'project_name', pr.project_name, 'from_booking', v_real,$b$);

  -- homeowner_progress reads the package's milestones, so it answers null
  -- for a job with no package. A null progress line is a crash on the way in;
  -- an empty one is a screen that simply has no milestones to draw.
  out_ := replace(out_,
    $a$    'progress', public.homeowner_progress(p_project),$a$,
    $b$    'progress', coalesce(public.homeowner_progress(p_project),
                          jsonb_build_object('nodes', '[]'::jsonb, 'done_count', 0, 'total', 0, 'current', null)),$b$);

  -- All four have to have landed, or the function is not what this migration
  -- was written against.
  if out_ = src then raise exception 'homeowner_booking has drifted - nothing matched'; end if;
  if out_ not like '%v_real boolean;%'      then raise exception 'homeowner_booking has drifted - the declare line'; end if;
  if out_ not like '%migration 117%'        then raise exception 'homeowner_booking has drifted - the head'; end if;
  if out_ not like '%''from_booking'', v_real%' then raise exception 'homeowner_booking has drifted - the address line'; end if;
  if out_ not like '%coalesce(public.homeowner_progress%' then raise exception 'homeowner_booking has drifted - the progress line'; end if;

  execute out_;
end $patch$;

comment on function public.homeowner_booking(uuid) is
  'One job as the homeowner app reads it. A job booked through a package answers from its booking; a job created any other way answers from the project itself, with from_booking false - so every screen in that app works for every job, not only the bought ones.';

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
