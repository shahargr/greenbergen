-- THE ADMIN LANDING, AS ONE READ.
--
-- Shahar, 2026-09-20: "admin page should focus only on administration and not
-- visibility into projects". The screen that replaces it is a console, and a
-- console is numbers - so this is the numbers, in one round trip instead of a
-- dozen counts fired from the page.
--
-- SECURITY DEFINER because half of these tables are behind RLS that an
-- administrator has no seat-based path to (bids on projects they are not on,
-- trades, the service area). The guard is the same one every admin_* function
-- uses: not a superadmin, empty object, no rows leaked. Rulebook 71 - the
-- surface is revoked from PUBLIC and granted back to authenticated only.
--
-- Every number here is COUNTED, never estimated. Where the honest answer is
-- zero it says zero: nothing has been bought through the app yet, three towns
-- of sixty-six have their documents, one package of twenty-one has a DIY
-- checklist. A console that rounded those up would be worse than no console.
create or replace function public.admin_console()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when not public.is_superadmin() then '{}'::jsonb else jsonb_build_object(
    -- people
    'users_active',      (select count(*) from public.app_users where is_active),
    'users_all',         (select count(*) from public.app_users),
    'invites_pending',   (select count(*) from public.app_invitations where status = 'pending'),
    'contacts',          (select count(*) from public.contacts),
    'companies',         (select count(*) from public.companies),

    -- what is being built
    'projects_live',     (select count(*) from public.projects
                           where trashed_at is null and is_template = false),

    -- what has been BOUGHT. accepted_at rather than a state string: the
    -- states have been renamed before and a timestamp cannot drift.
    'bookings_all',      (select count(*) from public.project_bookings),
    'purchases',         (select count(*) from public.project_bookings where accepted_at is not null),
    'purchases_cents',   (select coalesce(sum(price_cents), 0) from public.project_bookings
                           where accepted_at is not null),
    -- money that actually MOVED, which is not the same question
    'settlements',       (select count(*) from public.stage_settlements),
    'payment_stages',    (select count(*) from public.payment_stages),
    'contracts',         (select count(*) from public.contracts),

    -- proposals
    'proposals',         (select count(*) from public.bids),
    'proposals_won',     (select count(*) from public.bids where won),
    'bid_packages',      (select count(*) from public.bid_packages),

    -- the catalogue
    'packages_active',   (select count(*) from public.blueprint_packages where is_active),
    'packages_all',      (select count(*) from public.blueprint_packages),
    -- a package has a DIY checklist when its activity blueprint has steps
    'packages_with_checklist',
                         (select count(distinct p.code) from public.blueprint_packages p
                           join public.blueprint_activity_steps s
                             on s.activity_blueprint_id = p.activity_blueprint_id),
    'trades',            (select count(*) from public.trades),
    'trades_worker',     (select count(*) from public.trades where is_worker_trade),
    'catalogue_items',   (select count(*) from public.item_catalogue),

    -- the place
    'towns',             (select count(distinct town) from public.service_area),
    'towns_documented',  (select count(*) from public.town_services),
    'promotions',        (select count(*) from public.promotions),

    -- the machine
    'files',             (select count(*) from public.files),
    'trigger_errors',    (select count(*) from public.system_trigger_errors)
  ) end;
$$;

comment on function public.admin_console() is
  'Every number on the admin landing, in one read. Superadmin only; returns {} to anyone else.';

revoke all on function public.admin_console() from public;
grant execute on function public.admin_console() to authenticated;
