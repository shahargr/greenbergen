-- 245 THE FUNCTION SURFACE IS REVOKED BY DEFAULT
--
-- Security review, 2026-09-30. Rulebook 71 says a SECURITY DEFINER function
-- is a hole punched through RLS and the GRANT on it is the only thing that
-- decides who may use that hole; it also records that on 2026-09-08 the anon
-- surface measured 145 of 307 such functions. Counted live today: 218 of 529,
-- and 189 of those held EXECUTE through PUBLIC - the default Postgres gives a
-- new function, which every "create or replace function" since has kept.
-- Nobody chose them; they accumulated.
--
-- Most of them guard themselves (bid_can_manage, is_superadmin, ...), so a
-- stranger holding the anon key got a polite refusal rather than data. Not
-- all of them: contract_merge merged any two contracts for anyone with a
-- uuid, project_progress told anyone how much had been paid on a project,
-- loan_schedule_build wrote a loan's payment rows, and daily_visit_roll,
-- deal_cluster_recompute and the blueprint propagators rewrote live data on
-- request. None of those is called by any app - they are called by other
-- functions, by triggers, or by pg_cron, all of which run as the owner and
-- need no grant at all.
--
-- WHAT THIS DOES.
--   1. Strips PUBLIC from every non-trigger function in public and grants
--      EXECUTE back explicitly to authenticated and service_role - exactly
--      what signed-in users and the edge functions had, now written down.
--      Trigger functions are left alone: PostgREST cannot call one ("trigger
--      functions can only be called as triggers") and a trigger fires with
--      the owner's rights.
--   2. Grants anon the four functions that rode on PUBLIC and are read by
--      public pages: public_banner and public_deals (/deals), deal_track (the
--      view counter on /deals) and homeowner_package_products (the package
--      page, fetched with the bare publishable key so the framework can cache
--      it - apps/shared/src/catalogue.ts). Every other anon function already
--      carried an explicit grant and is untouched.
--   3. Takes the internal-only functions off the RPC surface entirely: no
--      anon, no authenticated. Their callers are SECURITY DEFINER functions,
--      SECURITY DEFINER triggers or cron jobs, verified one by one.
--   4. Enables RLS on the three tables that had none and were open to anon
--      for every verb (the linter's rls_disabled_in_public): task_kinds is a
--      vocabulary (read by everyone signed in, written by superadmin), and
--      money_accounts / money_account_aliases are OUR bank accounts (last4,
--      owner) - superadmin only; every app path reads them through a
--      SECURITY DEFINER function.
--   5. Makes the two remaining SECURITY DEFINER views run as the invoker
--      (v_flooring_takeoff, v_item_primary_trade) and takes anon off them.
--   6. Pins search_path on the nineteen helpers the linter flagged as
--      role-mutable.
--   7. Indexes the foreign keys on the working tables (actions, files,
--      file_links, transactions, contracts, messages, members...) that had
--      none. Lookup-table keys (status, trade, domain...) are left alone:
--      an index on a ten-value column buys nothing.
--
-- HOW TO CHECK IT (rulebook 71: a statement returning success is not
-- evidence; read proacl afterwards):
--   select count(*) from pg_proc p where p.pronamespace='public'::regnamespace
--     and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE');
--   -- expected: the explicit public set (about 33), not 218.
--   begin; set local role anon; select public.contract_merge(gen_random_uuid(), gen_random_uuid()); rollback;
--   -- expected: permission denied for function contract_merge.

-- ---------------------------------------------------------------------------
-- 1. PUBLIC off, authenticated and service_role on, function by function.
-- ---------------------------------------------------------------------------
do $function$
declare
  f record;
  sig text;
begin
  for f in
    select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.prokind = 'f'
      and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
      and exists (select 1 from unnest(p.proacl) a where a::text like '=%')
  loop
    sig := format('public.%I(%s)', f.proname, f.args);
    execute format('revoke all on function %s from public', sig);
    execute format('grant execute on function %s to authenticated, service_role', sig);
  end loop;
end
$function$;

-- ---------------------------------------------------------------------------
-- 2. The public pages that read through PUBLIC and now need anon by name.
-- ---------------------------------------------------------------------------
grant execute on function public.public_banner() to anon;
grant execute on function public.public_deals() to anon;
grant execute on function public.deal_track(text, uuid[]) to anon;
grant execute on function public.homeowner_package_products(text) to anon;

-- ---------------------------------------------------------------------------
-- 3. Internal only: called by functions, triggers and cron, never by an app.
-- ---------------------------------------------------------------------------
revoke execute on function public.contract_merge(uuid, uuid) from anon, authenticated;
revoke execute on function public.loan_autopay_tick() from anon, authenticated;
revoke execute on function public.loan_schedule_build(uuid, date) from anon, authenticated;
revoke execute on function public.fn_propagate_blueprint_trade_item(uuid) from anon, authenticated;
revoke execute on function public.fn_refresh_blueprint_trade_copies(uuid) from anon, authenticated;
revoke execute on function public.fn_budget_agreed_refresh(uuid) from anon, authenticated;
revoke execute on function public.daily_visit_roll(uuid) from anon, authenticated;
revoke execute on function public.deal_cluster_recompute(uuid) from anon, authenticated;
revoke execute on function public.project_progress(uuid) from anon, authenticated;
revoke execute on function public.contact_resolve(text, text, text, text, text) from anon, authenticated;
revoke execute on function public.project_trade_join(uuid, text, text) from anon, authenticated;
revoke execute on function public.portal_task_detail_holder(uuid) from anon, authenticated;
revoke execute on function public.user_storage_bytes(uuid) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Three tables with no RLS at all.
-- ---------------------------------------------------------------------------
alter table public.task_kinds enable row level security;
drop policy if exists reference_read on public.task_kinds;
drop policy if exists reference_write on public.task_kinds;
create policy reference_read on public.task_kinds for select to authenticated using (true);
create policy reference_write on public.task_kinds for all to authenticated
  using (public.is_superadmin()) with check (public.is_superadmin());

alter table public.money_accounts enable row level security;
drop policy if exists superadmin_only on public.money_accounts;
create policy superadmin_only on public.money_accounts for all to authenticated
  using (public.is_superadmin()) with check (public.is_superadmin());

alter table public.money_account_aliases enable row level security;
drop policy if exists superadmin_only on public.money_account_aliases;
create policy superadmin_only on public.money_account_aliases for all to authenticated
  using (public.is_superadmin()) with check (public.is_superadmin());

revoke all on table public.task_kinds, public.money_accounts, public.money_account_aliases from anon;

-- ---------------------------------------------------------------------------
-- 5. Views answer as the person asking.
-- ---------------------------------------------------------------------------
alter view public.v_flooring_takeoff set (security_invoker = true);
alter view public.v_item_primary_trade set (security_invoker = true);
revoke all on table public.v_flooring_takeoff, public.v_item_primary_trade from anon;

-- ---------------------------------------------------------------------------
-- 6. A pinned search_path on the helpers that had none.
-- ---------------------------------------------------------------------------
alter function public.contractor_paper_label(text) set search_path = public;
alter function public.contractor_paper_note(text) set search_path = public;
alter function public.deal_distance_miles(double precision, double precision, double precision, double precision) set search_path = public;
alter function public.deal_street_key(text) set search_path = public;
alter function public.deal_tier_for(uuid, integer) set search_path = public;
alter function public.file_kind_for_mime(text) set search_path = public;
alter function public.fin_marked(numeric, numeric) set search_path = public;
alter function public.fn_block_complete_with_unpaid_children() set search_path = public;
alter function public.fn_canonical_trade() set search_path = public;
alter function public.homeowner_customer_price(integer, numeric) set search_path = public;
alter function public.house_slug(text) set search_path = public;
alter function public.phone_key(text) set search_path = public;
alter function public.sched_add_days(date, integer, integer) set search_path = public;
alter function public.sched_days_between(date, date, integer) set search_path = public;
alter function public.sched_sub_days(date, integer, integer) set search_path = public;
alter function public.sched_workday(date, integer) set search_path = public;
alter function public.seat_for(integer, text[]) set search_path = public;
alter function public.seat_needs_contract(text) set search_path = public;
alter function public.trade_matches(text, text) set search_path = public;

-- ---------------------------------------------------------------------------
-- 7. Foreign keys on the working tables get an index.
-- ---------------------------------------------------------------------------
do $function$
declare
  pair text[];
begin
  foreach pair slice 1 in array array[
    ['action_comments','author_contact_id'],
    ['actions','asset_id'], ['actions','assigned_by_contact_id'], ['actions','activity_blueprint_id'],
    ['actions','diy_step_id'], ['actions','engagement_id'], ['actions','project_id'],
    ['actions','recurrence_source_action_id'], ['actions','scope_item_id'],
    ['app_invitations','accepted_by_user_id'], ['app_invitations','contract_id'],
    ['app_invitations','invited_by_user_id'], ['app_invitations','project_id'],
    ['assets','installed_by_contact_id'], ['assets','parent_asset_id'], ['assets','product_id'], ['assets','space_id'],
    ['bid_packages','budget_category_id'], ['bid_packages','contract_id'], ['bid_packages','supersedes_id'],
    ['bids','bidder_company_id'], ['bids','contract_id'],
    ['contacts','company_id'],
    ['contracts','action_id'], ['contracts','bid_package_id'], ['contracts','contractor_id'],
    ['contracts','counterparty_company_id'], ['contracts','counterparty_contact_id'],
    ['contracts','project_id'], ['contracts','signer_contact_id'],
    ['file_links','bid_id'], ['file_links','bid_package_id'], ['file_links','contract_id'],
    ['file_links','created_by_user_id'], ['file_links','library_folder_id'], ['file_links','project_id'],
    ['file_links','project_scope_item_id'], ['file_links','project_space_id'], ['file_links','site_checkin_id'],
    ['file_trash','deleted_by_user_id'],
    ['files','supersedes_id'], ['files','uploaded_by_contact_id'], ['files','uploaded_by_user_id'],
    ['house_page_photos','file_id'],
    ['messages','action_id'], ['messages','contractor_id'], ['messages','file_id'],
    ['messages','from_contact_id'], ['messages','handled_by_user_id'],
    ['notes','action_id'], ['notes','became_action_id'],
    ['payment_stages','action_id'], ['payment_stages','approved_by_user_id'], ['payment_stages','created_by_user_id'],
    ['project_bookings','bid_package_id'], ['project_bookings','contract_id'],
    ['project_bookings','contractor_contact_id'], ['project_bookings','package_code'], ['project_bookings','share_after_file_id'],
    ['project_members','company_id'], ['project_members','contact_id'], ['project_members','contract_id'],
    ['project_members','invited_by_user_id'], ['project_members','reports_to'],
    ['project_scope_items','adoption_action_id'], ['project_scope_items','change_order_id'],
    ['project_scope_items','contract_id'], ['project_scope_items','copied_from_blueprint_id'],
    ['projects','asset_id'], ['projects','entity_company_id'], ['projects','owner_user_id'], ['projects','package_code'],
    ['projects','purchase_broker_contact_id'], ['projects','sold_broker_contact_id'], ['projects','sold_buyer_broker_contact_id'],
    ['stage_settlements','initiated_by_user_id'], ['stage_settlements','payee_account_id'],
    ['stage_settlements','recorded_by_user_id'], ['stage_settlements','transaction_id'],
    ['transactions','action_id'], ['transactions','asset_id'], ['transactions','budget_category_id'],
    ['transactions','contract_id'], ['transactions','contractor_id'], ['transactions','payment_stage_id'],
    ['transactions','project_id']
  ]
  loop
    execute format('create index if not exists %I on public.%I (%I)',
                   'idx_' || pair[1] || '_' || pair[2], pair[1], pair[2]);
  end loop;
end
$function$;

update public.config set schema_version = schema_version + 1, schema_updated_at = current_date;
