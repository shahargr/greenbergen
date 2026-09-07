# Green Bergen · Homeowner app

The consumer app for Bergen County homeowners and residents who want
something fixed: pick a pre-priced package, add the address and a couple of
photos, book. A contractor accepts at the community price or passes.

Same database and auth as the owner portal at the repo root; a separate
Next.js app and a separate Vercel project. Mobile first: one phone-wide
column, centred on desktop.

## Run it

```bash
cd apps/homeowner
cp .env.example .env.local      # anon key; NEXT_PUBLIC_APP_URL for share links
npm install
npm run dev                     # http://localhost:3001
```

`npm run build`, `npm run lint` and `npm run typecheck` are the checks.

## Deploy (Vercel)

Create a **second** Vercel project from the same GitHub repo:

| Setting          | Value                                   |
| ---------------- | --------------------------------------- |
| Root Directory   | `apps/homeowner`                        |
| Framework        | Next.js (detected)                      |
| Production branch| `main`                                  |
| Env              | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_URL` (the app's own https URL) |

The root project (`greenbergen`) is untouched: it keeps Root Directory `/`
and ignores `apps/`. No service-role key anywhere in this app. Supabase Auth
needs the new domain in its redirect allow-list (`/auth/confirm`).

## The database migration (not yet applied)

Everything the app writes goes through `homeowner_*` functions that do not
exist until the three files in `db/` are applied, in order:

1. `001_homeowner_schema.sql` - the catalogue tables (`blueprint_packages`
   and children), `project_bookings`, `messages.file_id`,
   `app_users.home_zip`, RLS, loggers, the help row, schema_version 217.
2. `002_homeowner_seed.sql` - the launch catalogue. **Generated** from
   `src/lib/catalogue.data.json` by `node db/gen-seed.mjs > db/002_homeowner_seed.sql`.
   Edit the JSON, regenerate; never both.
3. `003_homeowner_functions.sql` - the function surface and its grants.

They were dry-run against the live project inside a rolled-back transaction
(schema + seed + functions + a full booking → accept → pay → close → share
walk-through) and passed. Until they are applied the app runs in preview:
the landing, join, catalogue and package pages work from the JSON; the
booking wizard stops at Book and says why; `/project` shows the empty state.

## Where things live

- `src/app/page.tsx` landing (direct and invited, `?ref=`), `join/`
  three-field registration + email code, `welcome/` the three steps,
  `login/`, `auth/confirm/`.
- `src/app/packages/` the grid, `more/`, `[code]/` the package page with the
  Adjust panel (levers + chat), `[code]/book/` the wizard (address → home →
  photos → budget → booked).
- `src/app/services/[code]/` the community-service pattern (salt bags).
- `src/app/project/` one project: waiting / no-taker / closed, the progress
  line, `folder/`, `forms/`, `timeline/` (photo + voice composer),
  `milestone/[key]/` (confirm + pay + photograph the check), `share/`.
- `src/app/s/[slug]/` the public shared card.
- `src/lib/catalogue.ts` catalogue types, pricing (base + option deltas),
  static fallback; `me.ts` and `booking.ts` the two shell reads;
  `bergen.ts` ZIP → town; `forms.ts` the NJ UCC permit PDFs.
- `src/app/globals.css` the Industry design system (tokens, components,
  the phone column). Fonts are vendored (Barlow / Barlow Condensed, OFL).

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
