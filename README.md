# Green Bergen

The Green Bergen web app - a TypeScript Next.js client over the Green Bergen
Supabase database, restarted from a clean scaffold on 2026-09-01.

## Run it

```bash
cp .env.example .env.local   # fill in the anon key
npm install
npm run dev
```

## Where things live

- `src/app` - routes: `/` landing, `/login` (email OTP + Google), `/my` (the
  owner portal home), `/auth/confirm` (OTP/PKCE callback).
- `src/lib/supabase` - the auth/session glue (browser, server, middleware).
- All business logic lives in the database: the portal calls RPCs
  (`consumer_home`, `create_home_asset`, ...) and renders what they return.

- `apps/homeowner` - the homeowner app (packages, booking, one project):
  a second Next.js app on the same database, deployed as its own Vercel
  project with Root Directory `apps/homeowner`. See `apps/homeowner/README.md`.
- `apps/shared` - code every app shares (design system, Supabase glue, the
  package catalogue, UI primitives) and `db/`, the database contract for the
  consumer apps. See `apps/shared/README.md`.

The repo is one npm workspace: run `npm install` at the root.

Deployed on Vercel (project `greenbergen`) from this repo's `main`.
