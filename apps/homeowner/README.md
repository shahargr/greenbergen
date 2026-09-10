# Green Bergen · Homeowner app

The consumer app for Bergen County homeowners and residents who want
something fixed: pick a pre-priced package, add the address and a couple of
photos, book. A contractor accepts at the community price or passes.

Same database and auth as the owner portal at the repo root; a separate
Next.js app and a separate Vercel project. Mobile first: one phone-wide
column, centred on desktop.

## Run it

```bash
npm install                     # once, at the repo root (one npm workspace)
cd apps/homeowner
cp .env.example .env.local      # anon key; NEXT_PUBLIC_APP_URL for share links (optional on Vercel)
npm run dev                     # http://localhost:3001
```

Shared code (design system, Supabase glue, catalogue, UI primitives) lives
in `apps/shared` and is imported as `@shared/*`. See `apps/shared/README.md`.

`npm run build`, `npm run lint` and `npm run typecheck` are the checks.

## Deploy (Vercel)

Create a **second** Vercel project from the same GitHub repo:

| Setting          | Value                                   |
| ---------------- | --------------------------------------- |
| Root Directory   | `apps/homeowner`                        |
| Framework        | Next.js (detected)                      |
| Production branch| `main`                                  |
| Env              | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_URL` (the app's own https URL) |

Live as project `greenbergen-homeowner` at https://greenbergen-homeowner.vercel.app.
Vercel installs at the repo root (it detects the npm workspace) and builds
this folder; `next.config.ts` points Turbopack at the repo root so
`apps/shared` is in bounds. The root project (`greenbergen`) is untouched:
it keeps Root Directory `/` and ignores `apps/`. No service-role key anywhere
in this app. Supabase Auth needs the new domain in its redirect allow-list
(`/auth/confirm`).

**When a push does not deploy** (it happened 2026-09-10: a push landed on
GitHub and no project created a deployment for it). Check the project's
Deployments list for the commit SHA before touching anything. **Redeploy in a
row's menu rebuilds THAT row's commit**, not the latest push, so it cannot
bring a missed commit live. Either use **Create Deployment** (top right of
the Deployments page, branch `main`) or push another commit; the webhook
carries the next push normally. A deployment marked CANCELED on this project
is usually Vercel skipping a commit that changed nothing under
`apps/homeowner` or `apps/shared`, not a failure.

## The database migration (applied 2026-09-07)

**Applied to the live project on 2026-09-07** (`001`-`003`, then `004` the same day). **Nothing moved and nothing was deleted.** The migration is additive: it
creates new tables and functions beside the existing ones and adds two
nullable columns. No row of `projects`, `contracts`, `payment_stages`,
`actions`, `files` or `messages` is updated or removed, so every open
project (55 Walnut Drive included) reads exactly as before in the root
portal, which keeps its own URL. In full, it writes:

- New tables: `blueprint_packages` and five children (items, levers, lever
  options, photos, milestones), `project_bookings`. Empty until someone
  books.
- New nullable columns: `messages.file_id`, `app_users.home_zip`. Existing
  rows keep NULL.
- New functions: `homeowner_*` (and `homeowner_post_internal`, internal).
  No existing function is changed.
- Two existing rows touched: the single `config` row (`schema_version` 216
  to 217 plus release notes) and one new `help` row for topic
  `homeowner_app`.
- The seed inserts the launch catalogue into the new tables only.

Rolling back is dropping the new objects; there is no data to restore.

Everything the app writes goes through `homeowner_*` functions that do not
exist until the three files in `apps/shared/db/` are applied, in order:

1. `001_homeowner_schema.sql` - the catalogue tables (`blueprint_packages`
   and children), `project_bookings`, `messages.file_id`,
   `app_users.home_zip`, RLS, loggers, the help row, schema_version 217.
2. `002_homeowner_seed.sql` - the launch catalogue. **Generated** from
   `apps/shared/src/catalogue.data.json` by `npm run seed` in `apps/shared`.
   Edit the JSON, regenerate; never both.
3. `003_homeowner_functions.sql` - the function surface and its grants.
4. `004_homeowner_homes.sql` - the delta applied after 001-003 went live:
   a home is the top-most project of a property asset the member owns
   (`homeowner_home_ids`), not "a top-level project with an address" - three
   real homes sat under a business container and had vanished. 003 carries
   the same definitions, so a fresh apply of 001-003 is complete.
5. `005_homeowner_perf.sql` - the payload delta: `homeowner_package(code)`
   returns one package (the job page was building all seventeen and keeping
   one, 37 kB for 4.5 kB of use) and `homeowner_tasks()` returns the five
   fields the inbox draws (7 kB for 25 tasks, where the portal's own
   `portal_tasks` returned whole rows: 23 kB for the same 25). Folded into
   003 as well.
6. `006_homeowner_photos.sql` - the photo gate comes down. Booking no longer
   waits for a photo: the job posts at the locked price and what is missing
   becomes a REQUEST - one row in `public.actions`, the single task list, so
   the inbox draws it and the banner reads it. `homeowner_photos_outstanding`
   counts what is still wanted (a photo keyed to a slot via
   `files.vantage_point` fills it; any other photo on the job counts down the
   ask too), `homeowner_photos` is the checklist the screen draws,
   `homeowner_photo_add` uploads one against a slot, and a trigger on `files`
   closes the request the moment the last one lands - whichever path it came
   in by. Also `homeowner_catalogue_tiles()`: the grid's seven fields per
   package, 2.9 kB against the full catalogue's 37 kB.
7. `007_homeowner_task_update.sql` - an update is not a completion. The
   inbox's only verb was "Done", so saying "I called the town" or "here are
   the photos the inspector wanted" meant closing the task; the log lost the
   middle of every job. `homeowner_task_update(project, action, note,
   file_ids[], complete)` posts one entry - a comment and any number of
   attachments - and only closes the task when `complete` is true (through
   `close_action`, never a direct status UPDATE). `homeowner_task_close`
   stays for the one-tap close on the job screen. Blinds & shades also moves
   from the front grid to More, leaving the eight the home screen prices on
   the spot. Folded into 003.
8. `008_address_after_award.sql` - **the address rule**, and the one rule in
   here that is about the community rather than a screen: a contractor who is
   invited to bid, or who bid and lost, is told the TOWN and nothing else. The
   street line arrives when the job is theirs. `bid_may_see_address(project)`
   is the single test (you manage it, you are seated on it, you won its bid,
   or you hold its contract); `project_town` and `project_label_no_address`
   are what everyone else gets. It lives in the database, not in a screen,
   because the portal, this app and the contractor app that does not exist yet
   all have to pass through it. NOT folded into 003 - it narrows portal
   functions that predate the homeowner app.

They were dry-run against the live project inside a rolled-back transaction
(schema + seed + functions + a full booking → accept → pay → close → share
walk-through, then a plan → post → remove pass and the home picker) and
passed, then applied. If a function is ever missing the app still runs in
preview: the catalogue works from the JSON and each screen says what it
cannot do.

## Where things live

- `src/app/page.tsx` the front door: the promoted packages as photographs
  of the work (`blueprint_packages.photo_url` + `promote`, Admin > Packages),
  the houses live and built (`public_company().showcase`, linking to the
  portal's `/p/<slug>`), one way in. Invited (`?ref=`) still leads to `join/`
  - three fields + email code - which is otherwise EMBEDDED at checkout
  (`JoinForm` `embed` prop): a visitor books first and registers last.
  `welcome/` the three steps, `login/`, `auth/confirm/`.
- `src/app/packages/` the grid, `more/`, `[code]/` the package page with the
  Adjust panel (levers + chat), `[code]/book/` the wizard: **which home** (when
  the member has one or more) → address → home facts → photos → budget →
  booked; `?mode=plan` saves a plan instead (home → when → planned, nothing
  sent); `?from=<project>` posts a saved plan (facts → photos → budget → post).
- `src/app/homes/new/` claim another home without ordering anything.
- `src/app/services/[code]/` the community-service pattern (salt bags).
- `src/app/project/` the member's home(s): live, planned and done on each,
  add another home. `[id]/` one job: planned (price today, change when, book
  it now, remove), waiting / no-taker / closed, the progress line, `folder/`,
  `forms/`, `timeline/` (photo + voice composer), `milestone/[key]/` (confirm
  + pay + photograph the check), `share/`.
- `docs/retiring-the-old-portal.md` where every capability of the old `/my`
  owner mode lands, and what has no home yet.
- `src/app/s/[slug]/` the public shared card.
- `src/lib/me.ts` and `booking.ts` the two shell reads; `plan.ts` the
  client-safe plan vocabulary (target windows); `forms.ts` the NJ UCC permit
  PDFs. `src/components/` the route-aware pieces (tiles, tabs).
- Everything else comes from `apps/shared`: the catalogue and its pricing,
  the design system (`warm-ink.css`), fonts, UI primitives, Supabase glue.

## Deliberately not in v1

- Card payments in-app (the processor rail exists in `payment_methods`;
  nothing collects). The milestone screen says so and records check / cash.
- The contractor app. Offers are readable through `homeowner_offers()` for a
  signed-in contractor and can be accepted with `homeowner_offer_accept`
  (a superadmin may pass the contractor's contact id for a demo).
- Property-record lookup (source TBD). The address is checked against the
  US Census geocoder; the owner types the facts.
- Pre-filled permit forms; photos on the public share card (the media
  bucket is private by design).
