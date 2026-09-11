-- 063 - a job wears its house's face until it is given its own.
--
-- Shahar (2026-09-11), after 062: "again, wrong image on the new build."
-- New build is the job under 55 Walnut Drive. It began life on 2026-08-09
-- as the property row itself; on 2026-09-06 the house was split out as its
-- own row above it and the cover Shahar had chosen moved up with it, so
-- the job was left with no cover and no place to choose one: the portal's
-- photo album sits on the Setup tab of a PROPERTY only. The fallback then
-- picked the newest photo of the work - a task's evidence - which is not
-- what anyone means by the New build.
--
-- Two changes.
--
-- 1. project_face_photo_id: the project's own chosen cover; else the
--    nearest ancestor's chosen cover (a job under a house shows the house,
--    a job under a development the development's picture); else the
--    newest photo on the project that is not money evidence (062).
--
-- 2. project_cover_set(p_project, p_file_id): the one write path for
--    choosing a face, for any project - a house or a job - so both the
--    portal's Setup tab and the Professionals app can offer it. Whoever
--    runs the site may choose it (authority rank 50 and up - the site
--    project manager, the site GC, the owner - or a superadmin, the same
--    line as a project's name and notes); the photo must be one of the
--    project's own photos, never money evidence. Null clears the choice.
--
-- And portal_my_work says whether the cover on a card is the project's own
-- choice ('cover_own') so the Professionals app can tell "this is the
-- house's photo, add one of this job" from "this is the job's photo".
create or replace function public.project_face_photo_id(p_project uuid)
returns uuid
language sql stable security definer set search_path to 'public'
as $$
  with recursive up as (
    select p.id, p.parent_project_id, p.cover_file_id, 0 as depth
      from public.projects p where p.id = p_project
    union all
    select p.id, p.parent_project_id, p.cover_file_id, up.depth + 1
      from public.projects p join up on p.id = up.parent_project_id
     where up.depth < 8
  )
  select coalesce(
    (select up.cover_file_id from up where up.cover_file_id is not null order by up.depth limit 1),
    (select f.id from public.files f
      where f.project_id = p_project and f.kind = 'photo' and f.is_latest
        and f.path not like '%/payments/%'
        and not exists (select 1 from public.file_links fl
                         where fl.file_id = f.id
                           and (fl.payment_stage_id is not null or fl.contract_id is not null))
      order by f.created_at desc limit 1))
$$;

create or replace function public.project_cover_set(p_project uuid, p_file_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  me uuid := public.current_app_user_id();
  f  public.files;
begin
  perform public.assert_own_hands();
  if me is null then return jsonb_build_object('ok', false, 'reason', 'Sign in first.'); end if;
  if not exists (select 1 from public.projects p where p.id = p_project and p.trashed_at is null) then
    return jsonb_build_object('ok', false, 'reason', 'That project is not here.');
  end if;
  if not (public.is_superadmin() or coalesce(public.my_authority_rank(p_project), 0) >= 50) then
    return jsonb_build_object('ok', false, 'reason', 'Only whoever runs this project, or its owner, may choose its photo.');
  end if;

  if p_file_id is not null then
    select * into f from public.files where id = p_file_id;
    if f.id is null or f.project_id <> p_project then
      return jsonb_build_object('ok', false, 'reason', 'That photo does not belong to this project.');
    end if;
    if f.kind <> 'photo' then
      return jsonb_build_object('ok', false, 'reason', 'The face of a project is a photo.');
    end if;
    if f.path like '%/payments/%'
       or exists (select 1 from public.file_links fl where fl.file_id = f.id
                     and (fl.payment_stage_id is not null or fl.contract_id is not null)) then
      return jsonb_build_object('ok', false, 'reason', 'A check or a receipt is proof of a payment, not the face of a project.');
    end if;
  end if;

  update public.projects
     set cover_file_id = p_file_id, last_modified_by = 'cover'
   where id = p_project;
  return jsonb_build_object('ok', true, 'project_id', p_project, 'file_id', p_file_id);
end $$;
revoke all on function public.project_cover_set(uuid, uuid) from public, anon;
grant execute on function public.project_cover_set(uuid, uuid) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.portal_my_work()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with me as (
    select u.id as app_user_id, u.contact_id
      from app_users u where u.id = public.current_app_user_id()
  ),
  seats as (
    select pm.project_id,
           max(coalesce(pr.authority_rank, 0)) as rank,
           (array_agg(coalesce(pm.project_role, pm.role) order by coalesce(pr.authority_rank, 0) desc))[1] as seat
      from me, project_members pm
      left join project_roles pr on pr.role = pm.project_role
     where pm.status = 'active'
       and (pm.app_user_id = me.app_user_id
            or (pm.app_user_id is null and pm.contact_id = me.contact_id))
     group by pm.project_id
  ),
  bidstate as (
    select b.project_id,
           bool_or(b.won or b.status = 'awarded') as awarded,
           bool_or(b.status = 'invited') as invited,
           bool_or(b.status in ('received','under negotiation')) as submitted,
           max(b.amount) as amount,
           (array_agg(b.id order by b.created_at desc))[1] as latest_bid_id
      from bids b, me where b.bidder_contact_id = me.contact_id group by b.project_id
  ),
  owed as (
    select t.project_id, sum(coalesce(t.amount, 0)) as amount, count(*) as n
      from transactions t, me
     where t.direction = 'out' and t.contractor_id = me.contact_id
       and coalesce(t.status,'') not in ('paid','paid - receipt filed','paid - pending confirmation','settled','cancelled','void')
     group by t.project_id
  ),
  ids as (
    select project_id from seats
    union select project_id from bidstate
    union select project_id from owed
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'project_id', p.id,
    'project_name', p.project_name,
    'address', p.address,
    'status', p.status,
    'stage', p.stage,
    'domain', p.domain,
    'parent_project_id', p.parent_project_id,
    'parent_name', (select pp.project_name from projects pp where pp.id = p.parent_project_id),
    -- A standing household project (insurance, mortgage, taxes...) - the
    -- owner's, not the site's. The Professionals board leaves these out.
    'household', p.home_blueprint_code is not null,
    'seat', s.seat,
    'rank', coalesce(s.rank, 0),
    -- The face: the chosen cover, else the house's, else the newest photo
    -- that is not money evidence (project_face_photo_id, 062/063).
    'cover', (select f.path from files f where f.id = public.project_face_photo_id(p.id)),
    -- ...and whether it is this project's own choice.
    'cover_own', p.cover_file_id is not null,
    'my_open_tasks', (select count(*) from actions a, me
                       where a.project_id = p.id and a.assigned_to_contact_id = me.contact_id
                         and a.status not in ('Completed','Cancelled','Force Cancelled','Superseded')),
    'bid_amount', b.amount,
    'latest_bid_id', b.latest_bid_id,
    'owed', coalesce(o.amount, 0),
    'owed_count', coalesce(o.n, 0),
    'buckets', (
      select coalesce(jsonb_agg(q.x), '[]'::jsonb) from (
        select 'done'::text as x where p.status like 'Closed%'
        union all
        select 'active' where p.status = 'In Progress'
          and (s.project_id is not null or coalesce(b.awarded, false))
        union all
        select 'lead' where p.status = 'In Progress' and coalesce(b.invited, false)
        union all
        select 'decision' where coalesce(b.submitted, false)
        union all
        select 'payment' where coalesce(o.n, 0) > 0
      ) q)
  ) order by p.project_name), '[]'::jsonb)
  from ids
  join projects p on p.id = ids.project_id and p.trashed_at is null and not p.is_template
                 and p.disabled_at is null
  left join seats s on s.project_id = p.id
  left join bidstate b on b.project_id = p.id
  left join owed o on o.project_id = p.id;
$function$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
