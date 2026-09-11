-- 062 - the face of a project is the house, never a check.
--
-- Shahar (2026-09-11): "I uploaded a photo as evidence to payment, and
-- you changed it to the new build image. Why?" Since 032 the board's card
-- (and since 031 the homeowner's home card) fell back to the NEWEST photo
-- on the project when no cover was chosen - and the newest photo was the
-- check he had just photographed for the ledger.
--
-- The rule now: a chosen cover (projects.cover_file_id, the Setup tab)
-- always wins. Without one, the face is the newest photo that is not
-- money evidence - a photo that lives under payments/ (the ledger's
-- folder), or that hangs on a payment milestone or a contract, is proof
-- of a payment and never the face of anything. Photos of the work (task
-- evidence, site notes) still qualify, which is what New build showed
-- before the check arrived.
--
-- One helper, project_face_photo_id, used by portal_my_work and
-- homeowner_me so both doors show the same face. Nothing else changes.
create or replace function public.project_face_photo_id(p_project uuid)
returns uuid
language sql stable security definer set search_path to 'public'
as $$
  select coalesce(
    (select p.cover_file_id from public.projects p where p.id = p_project),
    (select f.id from public.files f
      where f.project_id = p_project and f.kind = 'photo' and f.is_latest
        and f.path not like '%/payments/%'
        and not exists (select 1 from public.file_links fl
                         where fl.file_id = f.id
                           and (fl.payment_stage_id is not null or fl.contract_id is not null))
      order by f.created_at desc limit 1))
$$;
revoke all on function public.project_face_photo_id(uuid) from public, anon;
grant execute on function public.project_face_photo_id(uuid) to authenticated, service_role;

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
    -- The chosen cover, else the newest photo that is not money evidence.
    'cover', (select f.path from files f where f.id = public.project_face_photo_id(p.id)),
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

CREATE OR REPLACE FUNCTION public.homeowner_me()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare me uuid := public.current_app_user_id(); u public.app_users; v_home public.projects;
begin
  if me is null then return jsonb_build_object('signed_in', false); end if;
  select * into u from public.app_users where id = me;
  select * into v_home from public.projects p
   where p.id in (select public.homeowner_home_ids(me))
   order by (select count(*) from public.project_bookings b where b.home_project_id = p.id and b.state in ('posted','accepted')) desc, p.created_at limit 1;

  return jsonb_build_object(
    'signed_in', true,
    'profile', jsonb_build_object('app_user_id', u.id, 'full_name', u.full_name, 'email', u.email,
                                  'home_zip', u.home_zip, 'home_town', u.home_town, 'contact_id', u.contact_id,
                                  'is_superadmin', u.is_superadmin),
    'home', case when v_home.id is null then null else jsonb_build_object(
              'project_id', v_home.id, 'address', v_home.address, 'name', v_home.project_name,
              'facts', (select b.facts from public.project_bookings b where b.home_project_id = v_home.id and b.facts is not null order by b.created_at desc limit 1)) end,
    'homes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'project_id', h.id, 'address', h.address, 'name', h.project_name, 'town', nullif(btrim(split_part(h.address, ',', 2)), ''), 'created_at', h.created_at,
        'facts', (select b.facts from public.project_bookings b where b.home_project_id = h.id and b.facts is not null order by b.created_at desc limit 1),
        'live', (select count(*) from public.project_bookings b join public.projects j on j.id = b.project_id where b.home_project_id = h.id and j.trashed_at is null and b.state in ('posted','accepted')),
        'planned', (select count(*) from public.project_bookings b join public.projects j on j.id = b.project_id where b.home_project_id = h.id and j.trashed_at is null and b.state = 'planned'),
        'done', (select count(*) from public.project_bookings b join public.projects j on j.id = b.project_id where b.home_project_id = h.id and j.trashed_at is null and b.state = 'done'),
        -- The chosen cover, else the newest photo that is not money evidence.
        'photo', (select jsonb_build_object('file_id', f.id, 'path', f.path)
                    from public.files f where f.id = public.project_face_photo_id(h.id)),
        'people', coalesce((
          select jsonb_agg(jsonb_build_object(
            'name', coalesce(pu.full_name, pc.person_name, pc.name, pu.email, 'Someone'),
            'role', coalesce(pm.project_role, pm.role), 'status', pm.status) order by coalesce(pr2.authority_rank, 0) desc)
            from public.project_members pm
            left join public.app_users pu on pu.id = pm.app_user_id
            left join public.contacts pc on pc.id = pm.contact_id
            left join public.project_roles pr2 on pr2.role = coalesce(pm.project_role, pm.role)
           where pm.project_id = h.id and pm.status = 'active'
             and pm.app_user_id is distinct from me), '[]'::jsonb),
        'invited', (select count(*) from public.app_invitations ai
                     where ai.project_id = h.id and ai.status = 'pending' and ai.expires_at > now())
      ) order by (select count(*) from public.project_bookings b where b.home_project_id = h.id and b.state in ('posted','accepted')) desc, h.created_at)
      from public.projects h
      where h.id in (select public.homeowner_home_ids(me))), '[]'::jsonb),
    'home_quota', (
      select jsonb_build_object('allowed', c.assets_allowed,
        'have', (select count(*) from public.projects p where p.owner_user_id = me and p.parent_project_id is null and coalesce(p.is_template,false) = false),
        'can_add', public.may_create_asset())
        from public.contracts c where c.id = public.live_customer_agreement(me)),
    'bookings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'project_id', b.project_id, 'package_code', b.package_code, 'name', bp.name, 'tile_title', bp.tile_title,
        'illustration', bp.illustration, 'requires_permit', bp.requires_permit, 'instant_book', bp.instant_book,
        'address', p.address, 'home_project_id', b.home_project_id, 'price_cents', b.price_cents, 'config_label', b.config_label,
        'state', b.state, 'created_at', b.created_at, 'posted_at', b.posted_at, 'target_window', b.target_window, 'reply_by', b.reply_by, 'accepted_at', b.accepted_at,
        'closed_at', b.closed_at, 'done_at', b.done_at, 'repost_count', b.repost_count, 'offered_count', b.offered_count,
        'no_taker', (b.state = 'posted' and b.reply_by is not null and b.reply_by < now()),
        'photos_needed', case when b.state in ('posted','accepted') then public.homeowner_photos_outstanding(b.project_id) else 0 end,
        'photos_action_id', (select a.id from public.actions a
                              where a.project_id = b.project_id and a.source = 'homeowner_app' and a.scope_milestone = 'photos'
                                and a.status not in ('Completed','Cancelled','Force Cancelled','Superseded') limit 1),
        'share_slug', case when b.shared_at is not null then b.share_slug end,
        'contractor', case when b.contractor_contact_id is null then null else (
           select jsonb_build_object('contact_id', c.id, 'name', coalesce(co.company_name, c.person_name, c.name),
                                     'person', coalesce(c.person_name, c.name), 'phone', coalesce(c.phone, co.main_phone))
             from public.contacts c left join public.companies co on co.id = c.company_id where c.id = b.contractor_contact_id) end,
        'progress', public.homeowner_progress(b.project_id),
        'unread', (select count(*) from public.messages m where m.project_id = b.project_id and m.to_contact_id = u.contact_id and m.read_at is null),
        'last_message', (select jsonb_build_object('body', left(m.body, 140), 'sent_at', m.sent_at, 'mine', m.from_contact_id = u.contact_id,
                                                   'who', coalesce((select coalesce(c.person_name, c.name) from public.contacts c where c.id = m.from_contact_id), m.sender, 'Green Bergen'))
                           from public.messages m where m.project_id = b.project_id and m.channel = 'in app' order by m.sent_at desc limit 1)
      ) order by (b.state = 'closed'), (b.state = 'done'), (b.state = 'planned'), b.created_at desc)
      from public.project_bookings b
      join public.blueprint_packages bp on bp.code = b.package_code
      join public.projects p on p.id = b.project_id
      where p.trashed_at is null and public.is_project_member(b.project_id)), '[]'::jsonb)
  );
end $function$;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
