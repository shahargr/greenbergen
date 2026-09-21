# Running Green Bergen on your own machine

Written 2026-09-21, when the Vercel Hobby plan ran out of deployments
(100/day) and every code change was stuck behind a build queue. Locally there
is no queue and no quota: you see the change the moment you save it, and you
push only when a batch is worth deploying.

## What to install

| | why | how |
|---|---|---|
| **Node 24.x** | Next 16.3.3 needs `>=20.9`. Vercel builds on 24.x, so 24 is what production runs. | `nvm install 24 && nvm use 24` |
| **nvm** | So the Node version is per-project and you can match Vercel exactly. | `brew install nvm` (then follow its shell instructions) |
| **git** | Already on macOS via Xcode command line tools. | `xcode-select --install` |
| **An editor** | VS Code, Cursor, whatever you already use. | — |
| **Claude Code** *(optional)* | To keep working the way you have been, but against local files. | `npm install -g @anthropic-ai/claude-code`, then `claude` inside the repo. See code.claude.com/docs |

npm comes with Node. Nothing else is required.

**You do NOT need the Supabase CLI, Docker, or a local Postgres.** The
database is the app (see CLAUDE.md) and it lives at
`oznqiwldgjrykadqsriv.supabase.co`. Local development points at that same
live database, exactly as Vercel does. A local copy of Postgres would
diverge from it within a day and every RPC the apps call would have to be
kept in step by hand.

That does mean **local changes write to real data.** There is no sandbox.

## Getting it running

```bash
git clone https://github.com/shahargr/greenbergen.git
cd greenbergen
nvm use 24
npm install            # at the ROOT - one npm workspace covers all three apps
```

### The three env files

Each Next.js app reads its own `.env.local` from its own directory, so the
same two lines go in three places:

```bash
cp .env.example .env.local
cp apps/homeowner/.env.example  apps/homeowner/.env.local
cp apps/contractor/.env.example apps/contractor/.env.local
```

Each needs exactly two values to run:

```
NEXT_PUBLIC_SUPABASE_URL=https://oznqiwldgjrykadqsriv.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<from the Supabase dashboard>
```

The anon key is in **Supabase dashboard → Project Settings → API Keys →
`anon` / publishable**. It is publishable by design — it is shipped to every
browser that loads the site — but it still does not belong in a committed
file, which is why `.env.example` leaves it blank.

The **service-role key must never be here.** It lives only in Vercel's env
settings, entered by hand. Nothing in the app code reads it; every write goes
through a `SECURITY DEFINER` function that checks who you are.

Everything else in `.env.example` is optional. Mail is off until SMTP or
Mailtrap is configured, and nothing breaks without it.

### The one line that makes the whole thing work locally

Add this to the **root** `.env.local`:

```
ZONE_HOMEOWNER=http://localhost:3001
ZONE_EXPERT=http://localhost:3002
```

Without it the portal at `localhost:3000` proxies `/home` and `/pro` to the
**production** deployments, and you would be editing local code while looking
at the live site and wondering why nothing changed.

Why it matters at all: `vercel.app` is on the public-suffix list, so a
session cookie set on one host can never be read by another. The portal is
the front door and rewrites `/home` and `/pro` to the other two apps so there
is ONE origin and therefore ONE cookie. `ZONE_*` exists so those destinations
can be pointed somewhere else without a code change — and "somewhere else"
is your laptop. See the long comment at the top of `next.config.ts`.

### Supabase has to be told about localhost

Sign-in will fail until it is. Both Google and the email code send you back
to `window.location.origin + /auth/confirm`, and Supabase refuses a redirect
it does not recognise.

**Supabase dashboard → Authentication → URL Configuration → Redirect URLs**,
add:

```
http://localhost:3000/**
```

One entry covers all three apps, because all three are reached through the
portal's origin.

### Start all three

Three terminals, from the repo root:

```bash
npm run dev                             # the portal      -> localhost:3000
npm run dev -w greenbergen-homeowner    # /home           -> localhost:3001
npm run dev -w greenbergen-pro          # /pro            -> localhost:3002
```

Then open **http://localhost:3000** and use only that. Going to `:3001` or
`:3002` directly works, but it is a different origin and you will be signed
out there.

| you want | open |
|---|---|
| owner portal, admin, deals | `localhost:3000/my`, `/admin` |
| homeowner app | `localhost:3000/home` |
| Professionals app | `localhost:3000/pro` |

If you are only touching one app you only need two of the three running —
the portal, plus the app itself.

## Before you push

Vercel builds are the slowest way to find a type error. Run what it runs:

```bash
npx tsc --noEmit                         # the portal
npm run typecheck -w greenbergen-pro
npm run typecheck -w greenbergen-homeowner
npm run lint
npm run build                            # the portal; each app builds itself
```

The root `tsconfig.json` and `eslint.config.mjs` exclude `apps/` and
`supabase/` — each app checks itself and the shared sources it imports, and
the Deno edge functions are not TypeScript the portal can parse.

## Push cadence

Nothing needs to be pushed to be seen any more, so pushes become a
deliberate act rather than a way of looking at your own work.

Worth knowing: every push produces up to **six** Vercel deployments — three
projects × the branch and `main` — so roughly sixteen pushes exhausts a
Hobby day. Batching a few hours of work into one push is the difference
between having deployments when you need them and not.

`[skip ci]` in a commit message tells Vercel not to build that commit. Use it
for anything that cannot change a build — a migration filed under
`apps/shared/db/`, a doc, a comment.

## Things that will bite you

- **`next dev` rewrites the CLAUDE.md block.** The "This is NOT the Next.js
  you know" section is regenerated by the dev server. Committing it with your
  work keeps the tree clean; deleting it just brings it back.
- **You are on live data.** A test payment logged locally is a real row in
  the real ledger.
- **`.env.local` is gitignored** (`.env`, `.env.local`, `.env*.local`). Keep
  it that way.
- **Migrations are applied to Supabase directly**, not by a CLI from this
  repo. `apps/shared/db/*.sql` is the written record of what was applied —
  see migrations 194–209 for what happens when that record is skipped.
