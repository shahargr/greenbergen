-- 030 - contractor and project manager are one door: Home experts.
--
-- Shahar: "contractor and project manager should be merged, as contractor can
-- offer project management services as a trade."
--
-- He is right, and the data already agreed with him. Project management was
-- never a KIND OF PERSON here - it is a row in contact_trade_roles, exactly
-- like Plumbing, and migration 029 made it pickable. A person who runs jobs
-- and a person who does the work are the same person wearing one hat with
-- more on it. Two doors made you choose which half of yourself you were
-- today, and the choice carried no information: the same login, the same
-- record, the same inbox behind both.
--
-- SO: 'contractor' and 'builder' collapse into 'expert'. What you SEE inside
-- is decided by what you hold, not by which door you picked:
--
--   trades          -> the offer feed and your jobs
--   a seat >= 50    -> the board, the tasks, the money
--
-- 'manages' is that second test, hoisted out so the app does not have to
-- re-derive it. 50 is the same line bid_can_manage draws and the same one
-- the board calls MANAGES, so the three still never disagree.
--
-- The old keys are GONE rather than kept as aliases. Every reader is ours
-- (apps/shared/src/doors.ts, src/lib/doors.ts) and both change in this
-- commit; leaving 'contractor' and 'builder' behind would be two names for
-- one thing, which is the confusion this migration exists to remove.
create or replace function public.my_doors()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with me as (
    select u.id as app_user_id, u.contact_id, u.full_name, u.email,
           coalesce(u.is_superadmin, false) as is_superadmin
      from app_users u where u.id = public.current_app_user_id()
  ),
  seats as (
    select pm.project_id, coalesce(pr.authority_rank, 0) as rank
      from me, project_members pm
      left join project_roles pr on pr.role = coalesce(pm.project_role, pm.role)
     where pm.status = 'active'
       and (pm.app_user_id = me.app_user_id
            or (pm.app_user_id is null and pm.contact_id = me.contact_id))
  )
  select case when me.app_user_id is null then jsonb_build_object('signed_in', false)
  else jsonb_build_object(
    'signed_in', true,
    'name', me.full_name,
    'email', me.email,
    -- A home of their own: a seat on a project that IS an asset, or a
    -- package they have booked.
    'homeowner', exists (
      select 1 from seats s join projects p on p.id = s.project_id
       where p.asset_id is not null and p.trashed_at is null),
    -- ONE door for everyone who works on homes: registered as a trade
    -- (browsing is a door), OR holding a trade, OR running work on a site.
    'expert', exists (select 1 from contractor_approvals ca where ca.contact_id = me.contact_id)
           or exists (select 1 from bids b where b.bidder_contact_id = me.contact_id)
           or exists (select 1 from contact_trade_roles r where r.contact_id = me.contact_id)
           or exists (select 1 from seats s where s.rank >= 50),
    -- ...and inside that door, whether they run anything. The board, the
    -- task list and the money hang off this, not off a separate identity.
    'manages', exists (select 1 from seats s where s.rank >= 50),
    'admin', me.is_superadmin,
    'contractor_status', (select ca.status from contractor_approvals ca where ca.contact_id = me.contact_id)
  ) end
  from me;
$$;

comment on function public.my_doors() is
  'Which doors a signed-in person holds: homeowner, expert (one door for trades AND the people who run the work - project management is a trade, not an identity), admin. "manages" says whether the expert door should show the board, the tasks and the money: a project seat at authority_rank >= 50, the same line bid_can_manage draws.';

revoke all on function public.my_doors() from public, anon;
grant execute on function public.my_doors() to authenticated, service_role;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
