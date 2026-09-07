# Retiring the old homeowner mode

Where every capability of the owner side of the root portal (`/my/*`) lands
once the homeowner app replaces it. Written 2026-09-07 against the routes that
exist in the root app today. Three columns: it has a home in the new app, it
belongs to another app, or it has no home yet and needs a decision.

The root portal keeps `/admin/*`, the deals pages, `/help`, `/vision` and the
vendor/contractor screens until the contractor app exists under `apps/`.

## Has a home in the new app

| Old portal | New app |
| --- | --- |
| `/my` "Claim your address" | The **which home** step of the booking wizard, `/homes/new` ("Add another home"), and the home list on `/project`. Governed by the same agreement quota (`create_home_asset`). |
| `/my/new-home` (claim or plan a home) | `/homes/new`. Rooms and a home photo are not asked - see gaps. |
| `/my/new-project` "Start a project" with a target date | Pick a package, then **Not yet - plan it for later**: a `planned` booking with a target window (asap / 1-3 months / 3-6 months / this year / someday) and a note. One tap posts it later at that day's community price. |
| `/my` "Hire by the hour" tiles | The package grid. Water heater, EV charger and driveway are packages; HVAC, pest control, landscaping, snow removal, roof and locksmith are not in the catalogue yet and fall through to the **More packages / something else** quote request (one `actions` row). Catalogue gap, not a design gap. |
| `/my` "Your projects - as owner" | `/project`: every home with what is live, planned and done on it. |
| `/my/house/[id]` projects and services on a home | The per-home section on `/project`. |
| `/my/project/[id]` details, schedule, milestones, money | `/project/[id]`: the progress line (derived), the contractor card, **Next up**, the milestone screens with payment capture. |
| `/my/project/[id]` log | `/project/[id]/timeline` (messages, photos, voice notes). |
| `/my/project/[id]` tasks in trade buckets | Open tasks appear on the job when they block closing ("Still open"), and are closed from there. No standalone task list - see gaps. |
| `/my/project/[id]` purchase & sale | Dropped on purpose - out of scope for an app about getting something fixed. |
| `/my/project/[id]/bids`, `/bids/[pkg]` (bid planner) | Replaced by the community price: contractors accept or pass, nobody counter-offers. Dropped on purpose. |
| `/my/contractor/[id]` | Shown inline on the job (name, license, insured, rating, jobs). No standalone page. |
| `/my/payments`, `/my/financials` | Money lives on each job's milestone screens; the done card shows what was paid. No cross-home money view - see gaps. |
| `/my/invite` | Every share card carries the owner's invite (`?ref=`), and the landing page shows who invited you. No "invite a neighbor" button of its own - see gaps. |
| `/my` welcome video | `/welcome` orientation. |
| `/my/profile` | Name, email and ZIP are captured at join. No edit screen - see gaps. |
| `/login` Google sign-in | Kept: **Continue with Google** on `/login` and `/join` (same Supabase provider; the join path registers ZIP and referral through `/join/finish`). |
| `/my/settings` assets & warranties | The warranty line of a done job is shown on the job. No home-level asset registry - see gaps. |
| `/p/[slug]` public showcase | `/s/[slug]` share card (address hidden by default, no photos in public). |

## Belongs to another app

| Old portal | Goes to |
| --- | --- |
| `/my/bid/[bidId]` (contractor reply), `/my/business`, `/vendor/complete`, `/contractor` | The contractor app (`apps/contractor`, not started). `homeowner_offers()` and `homeowner_offer_accept()` already exist for it. |
| `/admin/*` | Stays in the root portal. |
| `/deals` (public), `/help`, `/vision` | Marketing / root portal. |

## No home yet - needs a decision

1. ~~People with access~~ **Built 2026-09-07**: `/project/[id]/people` lists
   who is on a job and invites an existing account as co-owner, viewer or
   contractor (`portal_invite_to_project`), or makes a join link for a
   contractor who is not on Green Bergen yet (`invite_peer`). Invitations are
   answered from `/inbox` (`portal_my_invites`, `portal_invite_respond`).
   Still per job, not per home.
2. **Home details**: rooms, a home photo, assets & warranties, "your
   contractors" (`/my/new-home`, `/my/settings`). Suggest: a **home folder**
   per home (photos, warranties, the contractors who worked there) as a next
   step - the job folder already has the pattern.
3. **Deals and cluster deals** (`/my`, `/deals`). Nothing in the new app.
   Suggest: a "neighbors are doing this too" line on the package page once
   cluster pricing is real; until then, drop.
4. **Town services, weather, trash schedule** (`/my`). Not in the spec.
   Suggest: drop unless it is a retention hook we want.
5. **Profile edit** (`/my/profile`): change name, email, ZIP. Small; suggest
   a `/me` sheet under the app bar.
6. ~~Unified inbox and task list~~ **Built 2026-09-07**: `/inbox` - invitations,
   conversations with unread first, every open task across the member's
   projects (`portal_tasks`), closable in place. Third tab in the shell.
7. **Invite a neighbor** without a finished job. Suggest: a share button on
   `/welcome` and on `/project` that carries the same `?ref=`.
8. **Direct-sale listing** (`/my/settings`). Drop; different product.

## What the plan mode needs from the database

Amended in `apps/shared/db/` (not yet applied):

- `project_bookings.state` gains `planned`; `posted_at` becomes nullable and
  is null exactly when planned; `created_at` and `target_window` are added.
- `homeowner_me()` returns `homes[]` (live / planned / done counts per home)
  and `home_quota` from the live agreement.
- `homeowner_book()` takes `p_home_project_id`, `p_mode` (`book` / `plan`) and
  `p_target_window`; the order half moved to `homeowner_post_internal()`,
  which re-prices from the live catalogue.
- `homeowner_booking_action()` gains `post` and `remove`.
- New: `homeowner_price()`, `homeowner_plan_update()`, `homeowner_home_add()`.
