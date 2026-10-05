# Green Bergen handoff (read this first in a fresh session)

Updated 2026-10-05, end of the session that ran the 2026-09-30 system review
and built platform texting. Process copied from MicFit (`CLAUDE.md`,
"Handoff"): one living file, refreshed at the end of every session.

## Where things are

| what | where |
|---|---|
| Code | `github.com/shahargr/greenbergen`, session branch `claude/wonderful-hopper-80y83b`, commit `36a66cb` on top of `main` `6280df0` |
| Apps | root portal (`/`), `apps/homeowner` (`/home`), `apps/contractor` (`/pro`, "Professionals"), `apps/shared`; three Vercel projects, only `main` deploys |
| Database | Supabase `oznqiwldgjrykadqsriv`, shared with other products; the rulebook and `help` are the memory. Schema version 484 |
| Migrations | `apps/shared/db/NNN_*.sql`; every one through 248 is applied live (`apply_migration`) |
| Review record | `docs/SECURITY-REVIEW-2026-09-30.md` |
| MicFit reference clone | `/home/user/micfit` in the 2026-09-30 container only; the repo is `github.com/shahargr/micfit` |

## Rules Shahar set (keep)

- Review decisions go to him as a list by priority; he picks, then tasks go to `public.actions`. Nothing was filed there yet.
- Awarding a bid already exists in the room (a replied bid, "Award this package"); he has not said what more he wants.
- Twilio: Green Bergen gets its own instance, separate from MicFit (migration 248: a Messaging Service of its own, or a bare number; ideally a Twilio subaccount).
- Messages to him end with `DECIDE:` / `EXECUTE ON x:` lines (CLAUDE.md).

## What is live (database, applied)

| migration | what |
|---|---|
| 245 | Every non-trigger function lost its PUBLIC grant and holds EXECUTE by name; RLS on `task_kinds`, `money_accounts`, `money_account_aliases`; the two SECURITY DEFINER views run as invoker; 19 helpers pinned `search_path`; 89 FK indexes on the working tables. Rulebook 71 carries the new state and the rule: a new function must revoke PUBLIC in its own migration |
| 246 | `homeowner_offer_accept` refuses without `contractor_readiness().can_accept` (code `PAPERS`); anon is a named list of 42 SECURITY DEFINER functions |
| 247 | MicFit's SMS service copied: `sms_settings` (test mode ON), `sms_send_log`, `sms_phone_flags`, `sms_countries` (US ticked), `sms_send`, `sms_twilio_send` (Postgres posts to Twilio with `http`, account from Vault), `portal_bid_text(bid)`, `sms_status()`, `sms_admin_*`, `config.site_origin`. Help topic `sms` |
| 248 | Sender is `twilio_messaging_service_sid` (preferred) or `twilio_from`; `sms_provider_state()` says which secrets exist |

Advisor: no ERROR-level findings. Leaked-password protection is a dashboard setting (and the app has no passwords).

## What is in the branch and NOT on main

Commit `36a66cb` (155 files), unpushed when this file was written. It holds the review's app fixes
(open redirects, the login-free `/bid/[token]` page, href schemes, admin action guards, inquiry honeypot,
one `me()` per request, fanned-out reads, batched signed URLs, dead ends and raw errors), the bid room's
"Text it from Green Bergen" and "Text them their link as soon as they are in", `/admin/sms` ("Texts"),
the migration files and this review record. Checks: tsc clean in all three apps; eslint clean in
homeowner and contractor; root and shared carry only pre-existing lint findings.

A `stash@{0}` from a sub-agent's `git stash` is still on the branch; everything in it was restored and
merged into the tree. It can be dropped.

## Open, in order (start here)

1. **Push the branch, then merge to main** (one push builds three Vercel projects). The push was refused
   by the session's permission classifier three times; Shahar switches the session off auto or allows
   `Bash(git push *)`.
2. **Twilio for Green Bergen** (EXECUTE ON twilio / supabase, steps in the 2026-10-05 message): a
   subaccount "Green Bergen Development", a number with 10DLC or toll-free verification, a Messaging
   Service, geo permissions US; then Vault secrets `twilio_account_sid`, `twilio_auth_token`,
   `twilio_messaging_service_sid`; then untick test mode on `/admin/sms`. Until then every text is
   logged as a test with its body.
3. **Review decisions still with Shahar**, by priority: bid-room "Show bidders" publishes papers that
   carry the address; offer town derived from the address's second comma part; library GET purges the
   bin; no throttle on the homeowner inquiry form and geocode route; invitation email relays free text;
   no offer feed in the Professionals app; the error screen's 555 number; the share page's hide-address
   toggle does nothing; the task screen's four-write save; admin create-project bypasses the agreement;
   house public page copies a form-supplied path; copy that promises unbuilt things; 50 MB server-action
   uploads; shell facts folded into `homeowner_me`/`contractor_me`; images and contrast.
4. **Awarding**: ask what is missing beyond awarding a replied bid.

## How this session tested things

- Database: become someone inside a transaction, then roll back:
  `begin; set local role authenticated; select set_config('request.jwt.claims','{"sub":"<auth_user_id>","role":"authenticated"}',true); select ...; rollback;`
  Shahar's auth id is on `app_users` (superadmin, so `is_superadmin()` bypasses gates; pick a non-admin
  for a gate test). Internal functions have no grant to `authenticated`: test them as the owner.
- Grants: count live, never trust a success message (rulebook 71):
  `select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE');`
- Apps: `npx tsc --noEmit` in root (`-p tsconfig.json`), `apps/homeowner`, `apps/contractor`; `npx eslint .`
  per app. `npm install` at the root first (workspaces). No dev server was run.

## What the session's tools could and could not do (2026-09-30 / 10-05)

- `execute_sql`, `apply_migration`, help/rulebook updates: all worked.
- `git commit` was refused twice (identity flags; then no reason) and then worked plainly; `git push`
  refused ("Out-of-Place Publication"); `git config` reads refused; `cat` of a migration file refused once.
  Try once; if refused, hand Shahar the step as `EXECUTE ON git:`.
- Sub-agents in parallel are fine on disjoint directories; one ran `git stash` and caught the others'
  files. Tell every agent: no git commands.
- Permission mode is set where the session is created; nothing in the repo changes it.
