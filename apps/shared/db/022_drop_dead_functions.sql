-- 022 - drop the 45 functions nothing calls, and the duplicate foreign key.
--
-- HOW THE LIST WAS MEASURED (re-measured 2026-09-09, not inherited): every
-- function in public that is referenced by NOTHING - no other function body,
-- no policy, no view, no trigger, no cron job, no column default, no check
-- constraint - AND appears in no rpc() call anywhere under src/ or apps/.
-- That produced 61 candidates. 16 were kept and 45 dropped, on one test:
--
--   DROP  if it belongs to a deleted surface, or is superseded by a function
--         the app actually calls today.
--   KEEP  if it is the only implementation of a capability we still need,
--         even though nothing calls it yet. "No button yet" is not "dead".
--
-- KEPT, and why - so nobody re-measures and drops them next time:
--   contractor_approve        the ONLY way to approve a contractor, and since
--                             migration 016 approval is what gates the offer
--                             feed. Dropping it means no contractor ever works.
--   admin_delete_user         superadmin account removal, with the
--                             block-referenced-delete fallback to disable
--                             instead. Nothing supersedes it.
--   apply_pricing_plan_to_project, record_stage_settlement,
--   close_project_incomplete, can_hire_on_project
--                             named BY NAME in rulebook 52, 60 and 70.
--                             Dropping one would make the rulebook wrong.
--   checkin_context, checkin_history, checkin_submit
--   submit_survey, survey_by_token, surveys_to_send
--                             the check-in and survey surfaces, not yet rebuilt.
--   homeowner_offers, homeowner_offer_accept, homeowner_offer_decline
--                             migration 016's offer feed - the contractor app's
--                             next step, written and waiting for its screen.
--   repair_orphan_auth_users  migration 021, four days old.
--
-- THE TWO WARNINGS from the original note both still stand and were honoured:
-- app_users and app_invitations are TABLES and are the identity model, not
-- legacy - they are not touched here; and "nothing calls them" was re-verified
-- against pg_proc bodies, not just the front end (app_add_comment writes to
-- action_comments, but nothing calls app_add_comment).
--
-- Eight of the 45 were uncalled without being superseded - real logic with
-- nowhere to live. Their definitions are kept verbatim in
-- attic/022_dropped_functions.sql so this drop is reversible.

do $$
declare
  v_names text[] := array[
    -- The deleted contractor site's token API. Its nine login/session
    -- functions went on 2026-08-31; these 22 are the rest of it.
    'app_about_get','app_about_projects','app_about_save','app_add_attachment',
    'app_add_comment','app_checkins','app_contractor_detail','app_contractors',
    'app_create_checkin_link','app_dashboard','app_inquiry_set_status','app_link_admin',
    'app_link_reset','app_link_set_active','app_log_payment','app_mark_reviewed',
    'app_projects','app_set_status','app_task_detail','app_task_from_checkin',
    'app_update_contact','app_week_contractors',
    -- Invitations: the live path is redeem_invitation, portal_invite_to_project,
    -- my_invitation_results, and a direct status='revoked' write from the app.
    'accept_invitation','invite_to_project','revoke_invitation','consumer_invites',
    -- Superseded landings and lists.
    'my_landing','my_entitlement','my_editable_projects','my_referrals',
    -- View-as: begin_view_as / end_view_as / admin_view_targets replaced these.
    'admin_view_people','admin_view_project','admin_view_workspace',
    -- Superseded readers and writers.
    'workspace_tasks','project_files','record_project_photo','file_unfile',
    'message_to_action','reply_to_message',
    -- Uncalled and not superseded - archived in attic/022_dropped_functions.sql.
    'fn_propose_space_scope','start_participation','set_portal_domains',
    'split_phones','can_see_contract_money','log_persona_action_event'
  ];
  r record;
  v_n integer := 0;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any(v_names)
  loop
    execute 'drop function if exists ' || r.sig::text;  -- grants go with it
    v_n := v_n + 1;
  end loop;
  raise notice 'dropped % functions', v_n;
end $$;

-- Two foreign keys on the same column to the same target, one of them without
-- the ON UPDATE CASCADE. Postgres checks both on every write for no gain.
alter table public.project_spaces drop constraint if exists project_spaces_space_type_fkey;

update public.config set schema_version = schema_version + 1, schema_updated_at = now();
