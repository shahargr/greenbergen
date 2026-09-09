-- 032 - a property on the board carries its picture.
--
-- Shahar, on the Home expert landing: "55 Walnut should show as a panel with
-- image, and drill down capabilities."
--
-- projects.cover_file_id has existed since v211 and nothing consumer-facing
-- ever read it. portal_my_work() is the ONE read behind every board screen -
-- the landing, /projects, /project/[id] all come out of it - so the picture
-- belongs there and nowhere else. Adding a second query per property to
-- fetch photos would be the thing not to do: portal_my_work already touches
-- the projects row.
--
-- The fallback matters more than the column. Almost nothing has a cover set,
-- but plenty of properties have photos on them - so a property with a photo
-- and no chosen cover shows its newest photo rather than a grey square. A
-- deliberate cover always wins.
--
-- Only the path travels. Signing it is the app's job (createSignedUrls, one
-- round trip for the whole page); a URL minted here would be stale by the
-- time anyone clicked it.
create or replace function public.portal_my_work()
returns jsonb
language sql
security definer
set search_path to 'public'
as $function$
  with me as (
    select u.id as app_user_id, u.contact_id
      from app_users u where u.id = public.current_app_user_id()
  ),
  seats as (
    -- me leads the FROM list: a LEFT JOIN written after a comma-join binds to
    -- the last item, which would hide pm from its own ON clause.
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
    'seat', s.seat,
    'rank', coalesce(s.rank, 0),
    -- The chosen cover, else the newest photo on the property. A storage
    -- path, not a URL - the app signs it.
    'cover', coalesce(
      (select f.path from files f where f.id = p.cover_file_id),
      (select f.path from files f
        where f.project_id = p.id and f.kind = 'photo' and f.is_latest
        order by f.created_at desc limit 1)),
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

comment on function public.portal_my_work() is
  'Every project you hold a seat on, are bidding, or are owed money by - with seat, authority rank, buckets, money, parent_project_id for the hierarchy, and cover: the storage path of the project''s chosen cover photo, or its newest photo. The one read behind every board screen; never rebuild this list by querying project_members and projects by hand.';

revoke all on function public.portal_my_work() from public, anon;
grant execute on function public.portal_my_work() to authenticated, service_role;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
