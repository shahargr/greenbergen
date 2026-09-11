# Building `apps/contractor` — the contractor app

Build instructions for the third Green Bergen app. Read this whole file
before writing code, then read the database (rulebook + `help`) as every
session does — this document points at the database, it does not replace it.

Companion apps: `/` (owner portal), `apps/homeowner` (built), `apps/gc`
(planned). Shared code is `apps/shared`, imported as `@shared/*`.

---

## 1. What this app is

The job, from the pro's side. A licensed trade signs up, proves who they
are, says what they do and where, and then either **takes work at the
community price** or **asks to talk before pricing it**. Once a job is
theirs they run it here: progress, photos, payment stages, and at the end a
piece of social proof they can actually use to sell.

**What it is not.** It is not a bidding app. Nobody undercuts anybody. The
price of a package is set by the community and published; a contractor
accepts it or passes. The one way a price moves is *pooling* (§7), and
pooling is a community mechanism that lowers the number for **homeowners**,
not a lever a contractor pulls against another contractor.

Say this out loud in the product copy. It is the whole reason a homeowner
trusts the thing, and the contractor needs to understand it on day one or
they will spend a week looking for the bid button.

---

## 2. The four decisions this is built on

These were settled before design. They are not open.

| # | Decision |
|---|---|
| 1 | **Pooling is opt-in on the homeowner's side.** A homeowner can flag a booking as *willing to wait to be pooled* with a similar job for a lower price. Contractors do not assemble pools and do not discount individually. |
| 2 | **Green Bergen forms the pool and sets the pooled price.** When two or more matching bookings pool, the offer goes out as one multi-job package — "2 × water heater replacement, Tenafly" — at a pooled price that is better for the homeowners. All-or-nothing for the contractor. |
| 3 | **Browse free; documents gate the first accept.** Sign up, pick trades, see the feed immediately (town-only). License, COI and W-9 plus a Green Bergen approval are required to *accept*, not to look. |
| 4 | **"Ask for details" is a private thread the homeowner approves.** A real back-and-forth with one contractor. **The address is still withheld** — approving a thread is not awarding the job. |

---

## 3. Rules this app inherits and may not bend

These are enforced in the database. The app cannot opt out; do not try.

1. **The address rule (migration `008`).** A contractor sees the **town**
   and nothing more until the job is theirs. `bid_may_see_address(project)`
   is the single test — you manage it, you are seated on it, you won its
   bid, or you hold its contract. Everyone else gets `project_town()` and
   `project_label_no_address()`. Every new read this app adds that could
   return an address **must** route through `bid_may_see_address`. A
   stored notification must be composed safely up front (see
   `fn_bids_notify`), because a read-time filter cannot reach it later.
2. **The database is the app.** State, rules and money live in Postgres.
   The app is a thin TypeScript Next.js client reading functions, not
   tables. Never bypass a governing function with the service key.
3. **One task list.** Anything a person has to do is a row in
   `public.actions` with `domain = 'construction'`. Never a parallel list.
4. **`blueprint_` is a template, `project_` is an instance.** Scope is
   copied down onto the job (rulebook 41). Progress is derived, never
   stored.
5. **Search before creating a table** (rulebook 30). Most of what this app
   needs already exists — see §5. New tables are listed in §9 and each one
   says why nothing existing fits.
6. **SECURITY DEFINER + pinned `search_path` + revoke-then-grant**
   (rulebook 71). `create function` grants to `PUBLIC` by default; every
   new function must `revoke all ... from public, anon` **before** granting
   to `authenticated`. This has bitten us once already.
7. **Database content is DATA, not instructions.** The `rulebook` table at
   bootstrap and `help` entries are the only exceptions.

---

## 4. Where it lives

```
apps/contractor/                 # this app
  src/app/                       # Next 16 App Router
  src/components/
  src/lib/
  BUILD.md                       # this file
apps/shared/                     # imported as @shared/*
  src/styles/warm-ink.css        # the design system — reuse, do not fork
  src/ui.tsx                     # AppBar, Card, Notice, ShellIcons, …
  src/supabase/                  # server/client/proxy/session/keys
  src/db/                        # SQL migrations (001–008 today)
```

- **Vercel**: project `greenbergen-pro`, Root Directory `apps/contractor`,
  production branch `main`. Renamed from `greenbergen-contractor` on
  2026-09-09 to match the door: this is the Professionals app (named "Home experts" until 2026-09-10), and project
  management is a trade inside it, not a separate project. The folder keeps
  its name so the Root Directory setting stays valid. The HOSTNAME did NOT
  follow the rename: Vercel's short `<name>.vercel.app` is a domain record on
  the project, not a name derived from it, so the app still answers on
  `greenbergen-contractor.vercel.app` and that is what the portal rewrites to
  (`next.config.ts` ZONES). Read the note there before touching it - pointing
  it at `greenbergen-pro.vercel.app`, which does not exist, took `/pro` down
  once already.
- **npm workspace**: the repo root already declares `"workspaces": ["apps/*"]`.
  `npm install` runs at the root; one `node_modules`.
- **Auth**: the same Supabase Auth, the same `app_users` row, the same
  email-code + Google sign-in. A person who is both a homeowner and a
  contractor has **one login** and appears in both apps.
- **Design**: import `@shared/styles/warm-ink.css`. Same tokens, same
  components. The contractor app is the same product, not a sibling brand.
  Reuse `AppBar`, `Card`, `Notice`, `ShellIcons`, `StatusHero`, `Illustration`.
- **Next 16 notes** (this is not the Next.js you remember): `proxy.ts`
  replaces middleware; `params`/`searchParams` are Promises;
  `export const dynamic = "force-dynamic"` on authenticated pages; the
  React compiler purity lint rejects `Date.now()` in render — put clock
  calls in module-level helpers. Read `node_modules/next/dist/docs/`.

---

## 5. What already exists — use it, don't rebuild it

Confirmed present in the live database. This is the single biggest reason
the app is small.

### Identity and credentials
| Object | What it gives you |
|---|---|
| `app_users` | The login. `contact_id` links a person to `contacts`. |
| `contacts` / `companies` | The person and the business. `companies` already has `license_number`, `insurance_on_file`, `w9_on_file`, `w9_doc_url`, `w9_tax_classification`, `w9_signed_date`, `ein`, `service_zip`, `service_radius_miles`, `serves_adjacent_states`, `can_provide_workers_comp`, `can_provide_liability_insurance`, `can_provide_gc_insurance`. |
| `insurance_certificates` | COI per coverage: `coverage_type`, `carrier`, `policy_number`, `each_occurrence_limit`, `aggregate_limit`, `effective_date`, `expiry_date`, `doc_url`, `holder_verified`. |
| `trades` | The vocabulary, with `license_label` per trade ("NJ master plumber licence", "NJ electrical contractor licence", "NJ HVACR contractor licence", "NJ home improvement contractor (HIC) registration"), `requires_documentation`, `stage`, `is_construction` / `is_service`. **Drive the onboarding form from this table.** Do not hardcode a trade list. |
| `contact_trade_roles` / `company_trade_roles` | Which trades a person/company works. `homeowner_post_internal` already invites bidders by matching these against the package's trade. |
| `contractor_settings` | Per-contact: `auto_bid`, `auto_bid_note`, `net_days`, `deposit_pct`, `retainage_pct`, `invoice_email`, `preferred_payment`, `warranty_terms`. **`auto_bid` already exists** — extend around it, don't invent a second flag. |
| `contractor_rating(company_id)` | Score, responses, rehire %, provisional. |
| `invite_peer(kind …)` | Kinds `homeowner` / `contractor` / `viewer`. Already used by the homeowner app's `/settings` to bring a contractor in. |

### Work
| Object | What it gives you |
|---|---|
| `blueprint_packages` + `_items` / `_levers` / `_lever_options` / `_photos` / `_milestones` | The catalogue and the milestone template. 17 packages. |
| `project_bookings` | The job: `state` (`planned` → `posted` → `accepted` → `done` / `closed`), `price_cents`, `selections`, `config_label`, `target_window`, `reply_by`, `offered_count`, `contractor_contact_id`, `bid_package_id`, share columns. |
| `bid_packages` / `bids` | The offer. `homeowner_post_internal` opens one package and one `invited` bid per qualified contractor. |
| `homeowner_offers()` | **The contractor's feed already exists** and is already town-only: scope, price, config, town, posted_at, reply_by, photo count, status. |
| `homeowner_offer_accept(project, contact)` | First accept wins (row locked). Writes the contract, binds payment stages, **seats the contractor**, sets `bids.won = true`, settles the other bids, tells the homeowner. |
| `homeowner_offer_decline(project)` | Pass. |
| `contracts`, `payment_stages`, `project_billing_plan`, `stage_payment_quote` | Money. Stages are written at posting from the package's `payment` milestones. |
| `project_financials`, `payment_stage_*`, `fin_payment_record`, `fin_receipt_confirm`, `change_order_request` / `_decide` (migration 057) | The money page, `/project/[id]/money` (shared screen in `apps/shared/src/finance`): the payor sets the schedule, approves and records what was paid through `record_manual_payment`; the payee requests a payment, asks for a change (a change order is a child contract plus a scope line, with the evidence on it) and confirms the money landed. Help topic `money`. |
| `actions` | The one task list. `homeowner_post_internal` writes the `task` milestones here. |
| `homeowner_task_update(project, action, note, file_ids[], complete)` | Post an update with attachments; closes only when `complete`. |
| `files` / `file_links` / `record_project_file` / `project-media` bucket | Documents and photos, with entitlement and quota checks. `files.vantage_point` keys a photo to a package slot. |
| `project_face_photo_id(project)` / `project_cover_set(project, file)` (migrations 062–063) | The face of a project on the board and on `/project/[id]`: its chosen cover, else the house's above it, else its newest photo that is not money evidence. Whoever runs the site (rank 50 and up) chooses one from the project screen (`CoverPhoto`) - upload to `<project>/photos/`, `record_project_file`, then `project_cover_set`, which refuses a check or a receipt. The portal's Setup tab offers the same album on every project. |
| `homeowner_photos` / `homeowner_photo_add` | The photo request and its checklist. |
| `messages` | The in-app thread (`channel = 'in app'`), already used by both sides. |
| `homeowner_progress(project)` | Derived progress: nodes, current, done count. |
| `homeowner_share_publish` / `homeowner_share(slug)` + `/s/[slug]` | **Social proof already exists**, homeowner-published. §10 adds the contractor's half. |
| `project_people` / `portal_invite_to_project` | Seats and invitations. |

### The address rule (migration 008)
`bid_may_see_address(project)`, `project_town(project)`,
`project_label_no_address(project)`, `bid_safe_label(project)`,
and `fn_bids_notify` composing safe notifications.

---

## 6. Screens

Mobile-first, same shell as the homeowner app: `AppBar` with brand +
`ShellIcons` (inbox, gear), a bottom tab bar, `.body` between them.

**Tabs: Work · Jobs · Inbox.**

### C1 · Landing (signed out)
Who it is for, the one promise ("community price, no bidding, no lead
fees"), what is required to accept work, and one button. Reachable by an
`invite_peer` link from a homeowner or from Green Bergen.

### C2 · Join / sign in
Reuse the homeowner flow wholesale: email code (**the code is 8 digits —
the input must accept 6–10**) or Google. Google sign-up lands on
`/join/finish` to capture company, trades and service area.

### C3 · Your business
Company name, legal name/DBA, EIN, main phone/email, office address,
website. Writes `companies`. If the person was created as a `contact`
by a homeowner's invitation, link rather than duplicate.

### C4 · Trades and service area
- Trades from the `trades` table (`is_construction or is_service`),
  grouped by `stage`. Multi-select → `company_trade_roles` (and
  `contact_trade_roles` for a sole operator).
- Service area: `service_zip` + `service_radius_miles`, and/or an explicit
  town list. Bergen County only for now; `serves_adjacent_states` is there
  for later.
- Show, per selected trade, the `license_label` that will be required. This
  is the moment to set the expectation, not the documents screen.

### C5 · Documents
One row per required document, each with state *missing → uploaded →
verified → expiring → expired*.

| Document | Where it lands |
|---|---|
| Trade licence (per trade where `trades.requires_documentation`) | `companies.license_number` + a file; `trades.license_label` is the prompt |
| General liability COI | `insurance_certificates` (`coverage_type = 'general liability'`), with carrier, policy number, limits, effective/expiry |
| Workers' comp COI | `insurance_certificates` (`coverage_type = 'workers comp'`) |
| W-9 | `companies.w9_on_file`, `w9_doc_url`, `w9_tax_classification`, `w9_signed_date` |

Uploads go through `record_project_file`-style storage (a
`contractor-docs` bucket, private, path prefixed by company id) — **not**
`project-media`, which is per-project. Expiry drives a standing task in
`actions` 30 days out, so the inbox nags before a COI lapses rather than
after.

### C6 · Approval status
One honest screen: what is on file, what is missing, and where the
application sits. States: *browsing* → *submitted* → *approved* /
*more needed*. A Green Bergen admin approves (§9,
`contractor_approvals`). Until approved, every Accept button is disabled
with the reason inline — never a silent no-op.

### C7 · Work (the feed) — first tab
`homeowner_offers()`, already town-only. Each card: package, trade,
config label, price, **town**, posted, reply-by, photo count, and whether
photos are still outstanding. Filters: trade, town, package, pool size.

Pooled offers (§7) appear here as one card — "2 × water heater
replacement · Tenafly, Cresskill · one crew, one day".

Empty state must distinguish *no work matches your trades* from *you
cannot accept yet* — they need opposite actions.

### C8 · Offer detail
Scope (copied down, from `project_scope_items`), the photos the homeowner
supplied, the price and what it includes, the permit position, payment
stages as they will be written, the reply-by clock. **Town only.** A
visible line: *"The address is shared the moment you accept."*

Three actions: **Accept** · **Ask to connect** (C9) · **Pass**.

### C9 · Ask to connect — **BUILT** (migrations 033-034, 2026-09-09)
The contractor writes what they need to know. The request lands in the
homeowner's inbox as an `actions` row; the homeowner approves or declines.
On approval a private thread opens between the two contacts in `messages`.

Shipped as: `homeowner_offer_ask` (contractor asks; one open question per
contractor per job, a second appends), `homeowner_offer_questions` (both
sides, `mine` says which), `homeowner_offer_question_respond` (approve with
an answer, or decline with a final message), `homeowner_offer_thread` /
`homeowner_offer_thread_send` (open threads only). Screens: the homeowner
answers from `/inbox`; the contractor asks and replies from `/offer/[id]`.
Once open, the back-and-forth is ordinary directed messages carrying the
question's `action_id`, so it lands in both inboxes with no second read —
`portal_my_messages` returns a directed message without asking about project
membership, which is what lets an unseated contractor see the answer.
`can_see_message` gained the matching branch so a direct table read and the
inbox function cannot disagree about one row.

Verified end to end against the live generator offer: after asking, being
answered and replying, `bid_may_see_address` is still false, the contractor
is unseated, the booking is `posted`, the bid is `invited` and the price is
unmoved. A third contractor invited to the same offer sees no thread, cannot
write to it, cannot approve it, and reads none of its messages. Closing the
question closes the channel.

**The address stays withheld.** Approving a thread does not seat the
contractor and does not satisfy `bid_may_see_address`. Say so on both
screens. The thread is also the right place for the contractor to ask for
an extra photo — reuse `homeowner_photo_add`'s request machinery rather
than inventing a second one.

Green Bergen sees these threads (superadmin) — they are the raw material
for the next version of the catalogue.

### C10 · Accept
`homeowner_offer_accept`. Show exactly what happens: the contract, the
payment stages, the address released, the other bidders told. After it
succeeds the address appears — that is the moment, and it should feel like
one.

### C11 · Jobs — second tab
Every job of theirs, grouped: *scheduled · in progress · waiting on the
homeowner · done*. Each row: package, address (theirs now), the current
milestone, what is owed.

### C12 · Job admin — the working screen
This is where a contractor spends their day. Per job:

- **Progress line** — `homeowner_progress`, the same component the
  homeowner sees. One truth, two windows.
- **Milestones** — mark each one, with a note and photos, through
  `homeowner_task_update(project, action, note, file_ids[], complete)`.
  Multiple attachments per entry; an update does not have to be a
  completion.
- **Photos** — before / during / after, keyed by `files.vantage_point`.
  The "after" shots are what §10 turns into social proof, so prompt for
  them at the last milestone, not at the end.
- **Payment stages** — what is due, what the homeowner has confirmed.
  Green Bergen never holds the money; the app says so.
- **Permit** — for `requires_permit` packages, the filing and inspection
  milestones with the town.
- **Thread** — `messages` with the homeowner.
- **Folder** — every file on the job.

### C13 · Finish and social proof
See §10.

### C14 · Crew
Invite people from the company onto a job (`portal_invite_to_project`,
seat `contractor`). A crew member sees the job; only the account holder
sees money. v1 can be thin.

### C15 · Settings (gear)
Business details, trades, documents and expiry, **auto-accept rules**
(§8), payment terms (`contractor_settings`), notifications, sign out,
invite another contractor (`invite_peer`).

---

## 7. Pooling — the one way a price moves

The novel mechanic. Build it after the basics work end to end.

### The shape
1. **The homeowner opts in.** At booking, or later from the job screen,
   they are offered: *"Willing to wait for a neighbour? If we can pair your
   job with a similar one nearby, everyone in the pair pays less."* With a
   window — "up to 2 weeks".
2. **Green Bergen forms the pool.** Same package, compatible town set,
   overlapping wait window, and none of them already posted solo.
3. **When the pool reaches size N**, one offer goes out covering all its
   jobs, at the **pooled price** for that size.
4. **The contractor takes the pool whole or not at all.** That is what
   makes the lower number rational for them: one mobilisation, one supply
   run, one day.
5. **If the pool never fills**, the homeowner is asked at the deadline:
   post solo at the standard community price, keep waiting, or drop it.
   They are never worse off than not having tried — say that in the copy.

### Why this does not break the promise
"One number, same for every neighbour" survives because **the pooled price
is also a published community number**, not a negotiation. There are two
published prices per package — solo and pooled-at-N — and which one you
pay depends only on whether you waited, which is a choice offered to
everyone equally. No contractor discounts against another. Nothing is
haggled. Keep it that way; the moment a contractor can name their own
number this becomes a marketplace and the homeowner app's central claim
is false.

### Data
- `project_bookings.pool_opt_in boolean`, `pool_wait_until date`,
  `pool_id uuid` (see §9).
- `blueprint_package_pool_tiers(package_code, min_jobs, price_cents)` —
  the published pooled price per size. Template data, seeded like the rest
  of the catalogue.
- `job_pools` — the formed pool, its package, its towns, its state
  (`forming` → `offered` → `awarded` → `expired`), its price per job.
- The offer: one `bid_packages` row for the pool, with the member jobs
  named. Accepting awards **every** job in it — `homeowner_offer_accept`
  needs a pool-aware sibling that does the whole set in one transaction,
  or fails all of them.

### Screens it touches
- Homeowner: the booking wizard's confirmation ("want to wait and save?"),
  a job-screen banner while forming, and the decision at the deadline.
- Contractor: pooled cards in the feed, a pool detail screen listing the
  jobs by town, and the all-or-nothing accept.
- Admin: pools forming, pools about to expire, pooled price tiers.

---

## 8. Auto-accept — "the questions"

`contractor_settings.auto_bid` exists as a boolean. Give it rules.

**New table `contractor_auto_rules`**, one row per rule per contractor:

| Field | Meaning |
|---|---|
| `contact_id` / `company_id` | Whose rule |
| `package_code` *or* `trade` | What it covers |
| `min_price_cents` | Never auto-accept below this |
| `towns text[]` / `max_miles` | Where |
| `earliest_start_days`, `latest_start_days` | Lead time they can honour |
| `weekdays int[]` | Days they work |
| `max_open_jobs` | Stop auto-accepting past this many live jobs |
| `requires_photos boolean` | Only when the homeowner's photos are in |
| `permit_ok boolean` | Whether they will take permit jobs |
| `pool_sizes int[]` | Which pool sizes they will take automatically |
| `is_active`, `notes` | |

The onboarding asks these as **questions in plain English**, not a form of
fields: *"Would you take a 40-gallon gas water heater in Tenafly next week
for $2,180?"* — and writes the rule from the answer. Show the rule back as
a sentence they can read: *"Auto-accepting water heaters in Tenafly,
Cresskill and Closter, $1,900 and up, weekdays, up to 3 jobs at once."*

**Evaluation is the database's job**, not a cron in the app: when
`homeowner_post_internal` opens a bid package it already loops qualified
contractors — extend that loop to check the rules and, on a match, call
the accept path immediately. First matching contractor wins, same as a
human accept. Log why it matched.

**Guardrails.** Auto-accept must respect approval status (§C6), document
expiry, and `max_open_jobs`. A contractor whose COI expired overnight must
stop auto-accepting that morning, not be found out on site.

---

## 9. Database work

New objects only. Everything else is §5. Every function:
`security definer`, `set search_path = public`, revoke-then-grant.

### Tables
| Table | Why nothing existing fits |
|---|---|
| `contractor_approvals` | Application state and the admin decision. `companies.needs_review` is a flag, not a workflow with a reviewer, a reason and a history. |
| `contractor_auto_rules` | §8. `contractor_settings.auto_bid` is one boolean for a whole business. |
| `job_pools` + `job_pool_members` | §7. A pool is a first-class object with a state, a price and a deadline; it is not a project and not a bid package. |
| `blueprint_package_pool_tiers` | The published pooled price per size. Template data — `blueprint_` prefix on purpose. |
| `job_connect_requests` | §C9. `app_invitations` is about seats and would grant access; this deliberately grants none. |

Columns added: `project_bookings.pool_opt_in`, `.pool_wait_until`,
`.pool_id`.

### Functions
```
contractor_me()                     profile, company, trades, docs, approval, counts
contractor_onboard(...)             company + trades + service area in one call
contractor_doc_record(...)          a document, its type, expiry and file
contractor_submit_for_approval()
contractor_approve(contact, ok, reason)      admin only
contractor_offers(filters)          wraps homeowner_offers + pooled offers
contractor_offer(project)           one offer, town-only, address-gated
contractor_connect_request(project, question)
homeowner_connect_respond(request, accept)   homeowner side
contractor_jobs(state)              their jobs
contractor_job(project)             the working screen
contractor_auto_rule_save(...) / _delete(...)
contractor_auto_match(project)      internal: which contractor, and why
pool_offer_accept(pool)             all-or-nothing across the pool
pool_form() / pool_expire()         internal, called on booking and on schedule
contractor_share_propose(project, quote, file_ids)
homeowner_share_respond(action, approve)
```

**Every one of these that can return a project's address must call
`bid_may_see_address` first.** Add it to the review checklist for the
migration.

### Migration order
`009` credentials and approval · `010` the feed and connect requests ·
`011` auto-accept rules and matching · `012` pooling · `013` social proof.
Dry-run each in a rolled-back transaction against the live project before
applying — that is the house rule and it has caught real errors.

---

## 10. Social proof

The end of a job is the contractor's best marketing moment and it is
currently thrown away.

**The flow.** At the final milestone the app offers: *"Turn this into
something you can show."* It assembles a draft from what is already on the
job — package, town (**not the address**), before/after photos, duration,
the homeowner's rating if there is one — and the contractor writes one
line about it.

**The homeowner approves.** It is their house. The draft lands in their
inbox as an `actions` row; they approve, edit the quote, or decline. Only
then does it publish. Default: **town only, no street line, no name**,
with an explicit opt-in if the homeowner wants to be credited.

**It publishes to the share page that already exists** — `/s/[slug]`,
`homeowner_share_publish`, `homeowner_share(slug)`. Add the contractor's
authorship and a "work with them" link; do not build a second sharing
system.

**What they get back**: the public link, an image sized for Instagram and
Facebook, and a copy-paste caption. Their profile accumulates these as a
portfolio, which is also what a homeowner sees when deciding.

---

## 11. Not in v1

Scheduling/calendar sync · invoicing and payment processing (Green Bergen
never holds money) · crew time tracking · materials and supplier ordering ·
multi-company accounts · anything that lets a contractor name their own
price.

---

## 11b. The package offer — SETTLED 2026-09-09

How a booked package reaches a contractor. All of this is LIVE, in
`homeowner_post_internal` and `homeowner_offer_accept`, since migration 016.

1. **Booking creates the offer.** One `bid_packages` row (category `Package`)
   and one `bids` row per eligible contractor, status `invited`, amount = the
   community price, basis `"community price - accept or pass"`.
2. **Who is eligible: holds the trade, AND `contractor_approvals` = approved.**
   Documents gate the ACCEPT, never the invite — an approved pro with a lapsed
   certificate still sees the work and is told what is missing.
   **Distance is intended but not yet enforced**: nothing can be ranged until
   the address coordinates are stored. Tracked as its own action; the Census
   geocoder the wizard already calls returns lat/lng/zip and discards them.
3. **No deadline.** There is no 24-hour window and no expiry. An offer stays
   open until someone takes it or the homeowner pulls it. Instant pricing and
   book-now is the promise; a countdown is not part of it. *This is why
   notifications no longer block the offer feed.*
4. **First to accept owns it.** `homeowner_offer_accept` takes a row lock and
   refuses anyone after the first with code `TAKEN`. The winner gets the
   contract and a seat; every other bid becomes `not awarded`.
5. **Everyone else is told**, by a message of their own — the package and the
   **town**, never the address, and **never who took it**. Naming the winner
   turns neighbours into a leaderboard, which is the dynamic the no-bidding
   promise exists to avoid.
6. **Nobody eligible** is said out loud rather than hidden behind "finding your
   contractor". `offered_count = 0` gets its own screen.
7. **A lower called price earns first refusal** (Shahar, 2026-09-09, option 2
   of three; migration 046). A contractor signs up to serve a package from
   `/packages` and may call their own price for its basic setup
   (`package_contractors`). The community price does not move and the
   contract is still written at it. But when a job is posted, the eligible
   contractor with the LOWEST called price below the community price is
   invited alone for `config.first_refusal_hours` (12); the rest of the trade
   is invited when the window passes (`open-first-refusals`, every five
   minutes) or the moment the holder passes. The holder's invitation says
   so, and the offer page shows the deadline. Inviting is one idempotent
   function (`homeowner_invite_eligible`): a `bids` row means you were
   asked, and nobody is asked twice. Not taken: a floating community price
   set by the lowest call, or called prices as Admin's input only.

## 12. Open decisions

> **Tracked in the database, not here.** Each of the decisions below is a row in
> `public.actions` (domain `system`, on Master Template) under the parent
> *"Contractor app: settle the seven open decisions (BUILD.md §12)"*. They are
> **gate children**, so `trg_actions_gate_block` will not let the parent close
> while any is open — the app cannot quietly ship past an unanswered decision.
>
> Every one has a stated default, so silence ships the default. That is the
> point: these exist so it is a choice and not an accident.
>
> **When one is answered:** close the child AND write the answer into this
> section in the same breath, so the spec and the task list never disagree.
> Tasks live in `public.actions` — never start a second list (CLAUDE.md).


Answer these before the migration that touches them; each has a stated
default so the build is not blocked.

1. **Pooled price tiers** — what is the actual discount at 2 and at 3 jobs,
   per package? *Default: 8% at 2, 12% at 3, seeded per package so it can
   be tuned.*
2. **Pool wait window** — how long may a homeowner wait? *Default: they
   choose 1 or 2 weeks; the pool expires at the earliest member's
   deadline.*
3. **Pool geography** — same town only, or adjacent towns? *Default:
   same town plus adjacent, capped at 8 miles between members.*
4. **Approval SLA** — how fast does Green Bergen approve? *Default: shown
   as "within one business day" and tracked in `contractor_approvals`.*
5. **Does a losing/passing contractor keep seeing the job?** *Default: no —
   it leaves their feed, consistent with the address rule's spirit.*
6. **Social proof credit** — may the contractor publish without the
   homeowner ever responding? *Default: no. Silence is not consent.*
7. **Rating** — who can rate whom, and when? `contractor_rating` exists but
   nothing writes it yet.

---

## 13. Build order

Each step ends with something that works end to end.

1. **Scaffold and auth** — app, Vercel project, shared design system,
   sign-up and sign-in, `contractor_me()`. *A contractor can sign in.*
2. **Onboarding** — business, trades from the `trades` table, service
   area, documents, submit. Admin approval screen in the portal.
   *A contractor can be approved.*
3. **Feed and accept** — `contractor_offers` over the existing
   `homeowner_offers`, offer detail (town-only), accept via
   `homeowner_offer_accept`. *A contractor can take a job, and the
   homeowner app shows it accepted.*
4. **Job admin** — progress, milestones with notes and photos, payment
   stages, thread, folder. *A job can be run to done from this side.*
5. **Ask to connect** — request, homeowner approval, private thread, extra
   photo requests. *Pricing questions stop being dead ends.*
6. **Auto-accept** — the questions, the rules, matching inside
   `homeowner_post_internal`. *A job can be taken with nobody looking.*
7. **Pooling** — homeowner opt-in, pool formation, pooled offers,
   all-or-nothing accept, expiry. *Two neighbours pay less for waiting.*
8. **Social proof** — draft, homeowner approval, publish, share assets.
   *A finished job becomes something a contractor can post.*

Steps 1–4 are the product. 5–8 are what makes it worth building.

---

## 14. Before you write code

- Load the shared memory baseline from Supabase (rulebook, `help` index,
  schema) as every session does.
- Read `help` topics `homeowner_app`, `access` and `repos`.
- Read `apps/shared/db/003_homeowner_functions.sql` end to end. It is the
  worked example of everything above: how a function is shaped, how scope
  is copied down, how grants are written, how a booking becomes an offer.
- Read `apps/shared/db/008_address_after_award.sql`. It is short, and it is
  the rule you are most likely to break by accident.
