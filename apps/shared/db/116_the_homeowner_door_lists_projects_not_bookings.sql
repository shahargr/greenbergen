-- 116. THE HOMEOWNER DOOR LISTS PROJECTS, NOT BOOKINGS.
--
-- Shahar (2026-09-14), with two screenshots: "as professional (image 1), i
-- see both Ran and My own generator project. as home owner (image 2), i see
-- none."
--
-- He is right, and it is worse than it looks. Under his two homes there are
-- ten real jobs. The homeowner door shows ZERO of them. Two separate faults,
-- and they compound:
--
-- ONE: THE DOOR ONLY KNOWS ABOUT BOOKINGS. homeowner_me builds its list
-- `from project_bookings`, inner-joined to blueprint_packages. That was right
-- when this app was a package shop and every job arrived through the booking
-- wizard. It is not right now: six of his ten jobs - New build, Improvements,
-- Emergency generator, Fix the motorized shade, and both completed builds -
-- were created some other way, have no project_bookings row, and are
-- therefore invisible in the door that is supposed to be his.
--
-- TWO: A CLOSED BOOKING IS NOT A CANCELLED JOB. All four of his bookings are
-- in state 'closed', and the screen reads 'closed' as cancelled and hides it
-- (deliberately - "the cancelled section at the bottom of the page is a
-- pointing finger to negative experience", 2026-09-12). But the BOOKING being
-- closed only means the request stopped going out to the community. Two of
-- those four projects are In Progress right now with open tasks and a
-- contractor on them. The booking ended; the work did not. The screen was
-- reading the wrong row's state and hiding a live job on the strength of it.
--
-- So: the door gets the projects themselves, and every booking now carries
-- its project's status so the screen can stop guessing from the booking.
--
-- WHAT IS DELIBERATELY LEFT OUT: the standing household workstreams -
-- mortgage, insurance, property taxes, internet, landscaping (they carry
-- home_blueprint_code). Those are the running of a household, not jobs
-- getting done, and the contractor board has excluded them on the same
-- grounds since migration 061. They belong on a screen about the house, and
-- putting them in a list headed "your projects" would bury the generator
-- under the broadband bill.

-- Every booking says what its PROJECT's status is, not only its own state.
do $patch$
declare src text; out_ text;
begin
  src := pg_get_functiondef('public.homeowner_me()'::regprocedure);
  out_ := replace(src,
    $anchor$'address', p.address, 'home_project_id', b.home_project_id, 'price_cents', b.price_cents,$anchor$,
    $new$'address', p.address, 'home_project_id', b.home_project_id, 'project_status', p.status, 'price_cents', b.price_cents,$new$);
  if out_ = src then
    raise exception 'homeowner_me has drifted - the bookings address line was not found';
  end if;

  -- And the jobs themselves, booking or no booking.
  out_ := replace(out_,
    $anchor2$      where p.trashed_at is null and public.is_project_member(b.project_id)), '[]'::jsonb)$anchor2$,
    $new2$      where p.trashed_at is null and public.is_project_member(b.project_id)), '[]'::jsonb),
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'project_id', j.id,
        'name', j.project_name,
        'address', j.address,
        'status', j.status,
        'stage', j.stage,
        'package_code', j.package_code,
        'home_project_id', j.parent_project_id,
        'home_name', (select h2.project_name from public.projects h2 where h2.id = j.parent_project_id),
        'has_booking', exists (select 1 from public.project_bookings b2 where b2.project_id = j.id),
        'open_tasks', (select count(*) from public.actions a2
                        where a2.project_id = j.id
                          and a2.status not in ('Completed','Cancelled','Force Cancelled','Superseded')),
        'people', (select count(*) from public.project_members pm2
                    where pm2.project_id = j.id and pm2.status = 'active'
                      and pm2.app_user_id is distinct from me),
        'unread', (select count(*) from public.messages m2
                    where m2.project_id = j.id and m2.to_contact_id = u.contact_id and m2.read_at is null),
        'cover', (select f2.path from public.files f2 where f2.id = public.project_face_photo_id(j.id)),
        'cover_url', public.project_face_url(j.id),
        'created_at', j.created_at
      ) order by (j.status like 'Closed%'), j.project_name)
      from public.projects j
      where j.parent_project_id in (select public.homeowner_home_ids(me))
        and j.trashed_at is null
        and j.archived_at is null
        and coalesce(j.is_template, false) = false
        -- The standing household workstreams are the running of a house, not
        -- jobs getting done on it (migration 061 draws the same line).
        and j.home_blueprint_code is null), '[]'::jsonb)$new2$);
  if out_ not like '%''projects'', coalesce((%' then
    raise exception 'homeowner_me has drifted - the bookings tail was not found';
  end if;

  execute out_;
end $patch$;

comment on function public.homeowner_me() is
  'Who the member is, their homes, every job under those homes, and the bookings among them. The projects list is the truth about what is going on at the house; a booking is one way a job can start, not the only one.';

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
