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

## The database migration (not yet applied)

**Nothing moves and nothing is deleted.** The migration is additive: it
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

They were dry-run against the live project inside a rolled-back transaction
(schema + seed + functions + a full booking → accept → pay → close → share
walk-through, then a plan → post → remove pass and the home picker) and
passed. Until they are applied the app runs in preview: the landing, join,
catalogue and package pages work from the JSON; the booking wizard stops at
Book and says why; `/project` shows the empty state.

## Where things live

- `src/app/page.tsx` landing (direct and invited, `?ref=`), `join/`
  three-field registration + email code, `welcome/` the three steps,
  `login/`, `auth/confirm/`.
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
