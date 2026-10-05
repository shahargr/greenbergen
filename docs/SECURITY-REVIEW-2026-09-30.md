# System review, 2026-09-30 - security, UX, performance

What was reviewed: the Supabase project (function grants, RLS, views, indexes,
the advisor reports), the three Next.js apps (root portal, `apps/homeowner`,
`apps/contractor`) and `apps/shared`. This file records what was found and
what changed. Open decisions were handed to Shahar in the session; anything
he picks up becomes a row in `public.actions`, never a list here.

## Database (migrations 245 and 246, applied)

- **The function surface was open by default.** 218 of 529 SECURITY DEFINER
  functions were executable by anon; 189 of them through the PUBLIC grant
  Postgres gives every new function. Migration 245 strips PUBLIC from every
  non-trigger function and grants EXECUTE by name to `authenticated` and
  `service_role`; 246 revokes the remaining explicit anon grants so anon is a
  named list of 42 (public pages, token-gated pages, vendor self-service,
  `/deals`, and the RLS helpers a policy evaluates as anon).
- **Internal-only functions carry no grant at all.** `contract_merge` (no
  guard, merged any two contracts for any caller), `loan_schedule_build`,
  `loan_autopay_tick`, `daily_visit_roll`, `deal_cluster_recompute`,
  `project_progress` (leaked paid amounts by project id), `contact_resolve`,
  `project_trade_join`, the blueprint propagators, `portal_task_detail_holder`,
  `user_storage_bytes`. Their callers are SECURITY DEFINER functions, triggers
  or pg_cron, which run as the owner. Verified caller by caller.
- **Three tables had no RLS and were open to anon for every verb:**
  `task_kinds` (now read by anyone signed in, written by superadmin) and
  `money_accounts` / `money_account_aliases` (our bank accounts; superadmin
  only, every app path reads them through a function).
- **Two SECURITY DEFINER views** (`v_flooring_takeoff`, `v_item_primary_trade`)
  now run as the invoker; anon lost SELECT on them.
- **Documents gate the first accept - in the database.** `homeowner_offer_accept`
  now refuses with code `PAPERS` unless `contractor_readiness(...).can_accept`
  is true (superadmin keeps its existing bypass). Before, only the disabled
  button enforced the rule settled in `apps/contractor/BUILD.md`. Tested by
  becoming a contractor without papers inside a rolled-back transaction.
- 19 helpers got a pinned `search_path`; 89 foreign keys on the working
  tables (actions, files, file_links, transactions, contracts, members,
  messages...) got an index. Lookup-table keys were left alone.
- Rulebook section 71 carries the new state and the rule that a new function
  must revoke PUBLIC and grant by name in the same migration.

Advisor state after: no ERROR-level findings. Remaining WARN/INFO are by
design (RLS-enabled tables read only through functions; the authenticated
function surface) plus one dashboard setting (below).

## Apps - fixed in this branch

See the commit for the file list. In short:

- Portal: `/bid/[token]` (the login-free price page) was gated by the
  middleware; `/auth/confirm` accepted an absolute `?next=` (open redirect);
  vendor website and banner links rendered any scheme (`javascript:`) as an
  anchor; admin actions that write tables directly now check superadmin in
  the action; invitation email accepts one address only; inquiry form has a
  honeypot and length caps; several per-request `me()` calls go through the
  cached `getMe()`; TopNav, `/my`, the project and task pages fan out their
  reads instead of awaiting them one by one; signed URLs are batched.
- Homeowner: `/ask`, `/api/geocode` were behind the login wall (the address
  check in the booking wizard silently never ran); `?next=` / `back` values
  in the home and task actions accepted absolute URLs; the People invite
  emitted the wrong query key so the newcomer link never showed; manifest
  ignored the `/home` basePath; share URL fell back to the wrong host; trailing
  awaits folded into each page's `Promise.all`; cookie-free catalogue pages
  are ISR; the 58 kB catalogue JSON no longer ships in client chunks.
- Professionals: accept is refused app-side too when `can_accept` is false;
  the bid-room photo/document publish copied a client-supplied bucket/path
  (now resolved from the file row); budget lines were read across all
  projects; the "Not interested" one-way action asks first; first-refusal
  times are shown in New Jersey time; a dozen dead ends and raw Postgres
  messages cleaned up.
- Shared: the notebook fired four RPCs on every page load for everyone,
  signed out included - it now loads on first open; `isMissingFunction` no
  longer mistakes a missing column for a missing migration.

## Needs a decision (handed to Shahar in the session)

Listed there by priority; not duplicated here.
