-- 143. OWNING A HOME IS NOT A TRADE.
--
-- Shahar (2026-09-15), with a photo of his friend Alex's phone: "This is my
-- friend Alex when he's looking as a homeowner into the website, and he's
-- trying to figure out where are the projects on the main page. Can it be
-- that he logs in through a different link or help me fix it?"
--
-- It is not his link. Alex signs in, lands on greenbergen.vercel.app, and the
-- page says PROFESSIONAL under the wordmark and offers him "My jobs" and
-- "Packages in your trades". He has never offered a trade in his life. He
-- owns one house.
--
-- THE RULE THAT DID IT. my_doors() opens the expert door to anybody holding a
-- seat of rank 50 or more, meaning a site project manager (50) or a site GC
-- (60) - somebody who RUNS work. But asset owner is rank 70, because an owner
-- outranks the people working for them, so every homeowner cleared the bar by
-- being above it. Then the house rule (src/lib/doors.ts: LANDS = expert,
-- homeowner, admin - "you come to work, so the working door wins") sent them
-- straight to Professionals.
--
-- Four of the five accounts holding a rank-50-or-better seat today are plain
-- homeowners who own exactly one property and nothing else: Alex, Asaf, Ran
-- and sg.other+1. All four have been landing in the contractor app. The fifth
-- is Shahar, who really does run work and keeps the door three other ways
-- (a contractor approval, trade roles, and actual site GC and site PM seats).
--
-- THE FIX is to say what was always meant: authority over your own house is
-- ownership, not employment. The test is a seat that RUNS work for somebody -
-- site PM and site GC, ranks 50 to 69 - and a band rather than a name so that
-- a future owner-class role above 70 cannot quietly re-open the same hole.
--
-- The homeowner door is untouched: it has always keyed off holding a seat on
-- a project with an asset, which is exactly what Alex has.
create or replace function public.my_doors()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
  with me as (
    select u.id as app_user_id, u.contact_id, u.full_name, u.email,
           coalesce(u.is_superadmin, false) as is_superadmin,
           u.default_door
      from app_users u where u.id = public.current_app_user_id()
  ),
  seats as (
    select pm.project_id, coalesce(pr.authority_rank, 0) as rank
      from me, project_members pm
      left join project_roles pr on pr.role = coalesce(pm.project_role, pm.role)
     where pm.status = 'active'
       and (pm.app_user_id = me.app_user_id
            or (pm.app_user_id is null and pm.contact_id = me.contact_id))
  ),
  -- A seat that RUNS WORK: site project manager (50) and site GC (60). Not
  -- the asset owner (70), whose authority is over their own house and is the
  -- whole reason they are in the homeowner door instead.
  runs as (
    select 1 from seats s where s.rank >= 50 and s.rank < 70
  )
  select case when me.app_user_id is null then jsonb_build_object('signed_in', false)
  else jsonb_build_object(
    'signed_in', true,
    'name', me.full_name,
    'email', me.email,
    'homeowner', exists (
      select 1 from seats s join projects p on p.id = s.project_id
       where p.asset_id is not null and p.trashed_at is null),
    'expert', exists (select 1 from contractor_approvals ca where ca.contact_id = me.contact_id)
           or exists (select 1 from bids b where b.bidder_contact_id = me.contact_id)
           or exists (select 1 from contact_trade_roles r where r.contact_id = me.contact_id)
           or exists (select 1 from runs),
    'manages', exists (select 1 from runs),
    'admin', me.is_superadmin,
    'default_door', me.default_door,
    'contractor_status', (select ca.status from contractor_approvals ca where ca.contact_id = me.contact_id)
  ) end
  from me;
$function$;

comment on function public.my_doors() is
'Which doors are open to the signed-in person, in one read. The expert door needs a contractor approval, a bid, a trade role, or a seat that RUNS work - site PM or site GC, ranks 50 to 69. Migration 143 excluded the asset owner (rank 70) from that last test: an owner outranks the people working for them, so every homeowner was clearing a bar meant for the people they hire and landing in the contractor app. manages - which decides whether the Professionals app shows the board, the tasks and the money - is the same test.';

update public.config set schema_version = schema_version + 1, schema_updated_at = now()
 where id = (select c.id from public.config c limit 1);
