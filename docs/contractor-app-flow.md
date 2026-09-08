# The contractor side, end to end

What a contractor does in Green Bergen, from never having heard of us to being
paid and rated — screen by screen, with the database behind each one.

Written 2026-09-08 against the live database (project `oznqiwldgjrykadqsriv`)
and the code in this repo. This is a **brief for drawing screens**, not a spec
for building them: it says what has to be on each screen and what is true
underneath, and leaves the layout to the designer.

**Read `apps/contractor/BUILD.md` first.** That is the SPEC - what to build, in
what order, on which tables, and the four decisions the app is built on
(pooling is opt-in on the homeowner's side and is never a contractor discount;
browsing is free but documents gate the first accept; "ask for details" never
releases the address). This file is the SCREEN BRIEF: what has to be on each
screen and which RPC feeds it. Where the two disagree, BUILD.md wins and this
file is wrong.

Its sibling for the homeowner side is `apps/homeowner/docs/retiring-the-old-portal.md`;
`docs/PORTAL-DEPRECATION.md` maps what the root portal still holds that no app
has replaced.

**Status, 2026-09-08:** §3 (getting in) and §4.1 (business, trades, documents)
ARE BUILT and live at `greenbergen-contractor.vercel.app`. Everything from §5
onward - the offer feed, both bid doors, the job, money, finishing - is not.
Read the [live]/[wired]/[new] tags below as describing the DATABASE, not the
contractor app: "[live]" means the root portal renders it today, not that this
app does.

## How to read it

Every screen is tagged:

- **[live]** — the database function exists and something already renders it,
  today, in the root portal (`/`). The screen is being *redrawn*, not invented.
- **[wired]** — the database function exists and is tested; nothing renders it.
  Draw freely; the data is waiting.
- **[new]** — neither exists. A design decision comes first.

The **Source** line on each screen names the exact RPC. If a field is not in
that function's return, it is not on the screen — that is the discipline that
keeps the drawing honest.

---

## 1. The shape of the thing

Green Bergen is one Supabase database with several front ends. The homeowner
app (`apps/homeowner`, live) is where a resident picks a pre-priced package and
books it. The contractor app (`apps/contractor`, **signup and business built,
the rest not**) is the other side of the same glass: the offer that homeowner created arrives here, and one
contractor takes it.

Same Supabase Auth, same `app_users` row, same login (email code or Google).
A person who is both a homeowner and a contractor has **one** account and sees
both apps. Nothing about the contractor app is a separate identity system.

Three things a designer should hold onto:

1. **Mobile first, one phone-wide column.** A contractor reads this in a truck,
   in the rain, with one hand. The homeowner app is already built this way; the
   contractor app matches it.
2. **The price is not negotiated on a package job.** Accept at the stated price
   or pass. There is no counter-offer field, anywhere, on that path. (The
   separate bid path, §5, *is* a priced reply — two different doors, and
   confusing them is the most expensive mistake this document can prevent.)
3. **Speed is the whole product.** A package offer expires 24 hours after it is
   posted, and the first contractor to accept wins — the row is locked. Every
   screen on the offer path is racing a clock that is visible to the user.

---

## 2. Who is "the contractor", exactly

Not one person. `project_roles` is a decision-authority ladder, and four rungs
of it open this app. What a seat can see is enforced in the database, so the
design must not promise more than the seat holds.

| Seat | Rank | Sees |
| --- | --- | --- |
| Contractor manager | 40 | Their own contract **and its money** — value, milestones, transactions |
| Contractor | 30 | Their own contract, its scope and its tasks. **No money** |
| Sub-contractor manager / sub | 20 / 10 | Only tasks assigned to them or to their own reports-to subtree |
| Crew | 5 | The same, plus site check-in. Nothing about money, scope, or another trade |

Two rules that shape every screen:

- **Money is a rank, not a checkbox.** Rank ≥ 40 sees the money because they run
  the firm. There is no "show financials" toggle to draw.
- **No bounded member ever sees bids** — not even their own trade's. A contractor
  never learns what the other bidders said. Do not draw a comparison view.

A member is *bounded* when every active seat they hold carries a `contract_id`.
That is every contractor. The unbounded seats — owner, GC, site PM — belong to
the root portal, not here.

---

## 3. Getting in

### 3.1 Landing — what this is for a pro **[new]**
Not the homeowner landing. The promise: *work in your trade, in your towns, at
a price stated up front, paid on milestones you can see.* One call to action —
**Apply** — and a quiet **Sign in** for people who already have an account.

### 3.2 Apply **[live]** · today `/vendor/complete`
**Source:** `vendor_register(...)`

Fields, in the order the function validates them: company name, your name,
email, phone (all four required) → trades (at least one, from `trades` where
`is_worker_trade`) → service ZIP, how far you travel in miles, whether you cross
into adjacent states → licence number, website → insurance: workers' comp,
liability, GC insurance (three yes/no) → how you heard about us, who referred you.

Three refusals need designed states, because the function raises them by name:
- `PHONE_EXISTS` — *"this phone number is already registered with us. If this is
  you, just log in instead."* Draw it as a route to sign-in, not an error.
- `BAD_PHONE`, `BAD_ZIP` (5 digits), `BAD_RADIUS` (1–250 miles).
- `NO_TRADE` / `UNKNOWN_TRADE`.

On success the applicant gets a **vendor code** (`GB-1234`) and status
`applied`, with `needs_review = true` on both the company and the contact. Show
the code — it is what they quote when they call.

### 3.3 Verify **[live]**
**Source:** `vendor_request_code(identifier)` → `vendor_verify_code(id, code)`

A code to the phone or email on file. Standard six-box entry.

### 3.4 Pending review **[new]**
Between `applied` and a real seat, there is a wait. Today nothing tells the
applicant what happens next. Draw an honest holding screen: what we check
(business active, insurance certificate in the same legal name), roughly how
long, and what they can do meanwhile — **complete your profile**, which is §4
and is the thing that makes offers arrive at all.

### 3.5 Sign in **[live]**
Email code or Google, the same `/login` as every other app. Same Supabase
provider, same `handle_new_auth_user` bridge.

### 3.6 Invited straight onto a job **[live]**
**Source:** `portal_invite_respond(id, accept)`, listed by `portal_my_invites()`

A homeowner can invite a contractor who is not on Green Bergen yet; the link is
the credential. The join screen previews the invitation and pre-populates. This
path skips §3.2 entirely — draw it as a first-class entry, not an edge case.

---

## 4. Business — the profile that makes work arrive

### 4.1 Business home **[live]** · today `/my/business` (364 lines, the richest thing we have)
**Source:** `portal_my_business()` — returns `company`, `settings`, `prices[]`,
`documents[]`, `funnel`, `trades[]`, `all_trades[]` in one call.

Five sections, in the order the contractor cares about:

**Sales & growth** — the funnel, straight off `bids`: invited, submitted, won,
lost, total, average bid, won value. This is the screen's hero. A contractor
opens this app to find out whether the last month worked.

**Company** — name, legal name, DBA, address, phone, email, website, licence
number, EIN; service ZIP, radius in miles, adjacent states.
*Save via `portal_my_company_save(jsonb)`.*

**Trades** — *the most consequential control in the app and it does not look
like it.* A package offer is routed to every contractor who has a login and the
package's trade in `contact_trade_roles`. Untick a trade and the work stops
arriving. Draw it with that weight.
*Save via `portal_my_trades_set(text[])`.*

**Price list** — what you charge for, trade, unit (each / hour / sq ft / day),
price, what it includes. Proposals are drafted from this.
*Save via `portal_price_item_save(jsonb)`, delete via `portal_price_item_delete(id)`.*

**Terms & automatic bids** — auto-bid on/off with a standard note, net days,
deposit %, retainage % you accept, where invoices go, how you prefer to be paid,
the warranty you offer.
*Save via `portal_my_terms_save(jsonb)`.*

**W9, insurance & warranties** — `contact_credentials` filtered to
`w9 / insurance / warranty / bond / tax`. Each carries `expires_on` and the
function returns a computed **`expired`** boolean. An expired COI is the single
most common reason a contractor is turned away at the gate: draw the expiry
state loudly, and count down before it lapses.
*Save via `portal_credential_save(jsonb)`.*

### 4.2 Your rating **[wired]**
**Source:** `contractor_rating(company_id)` — `score`, `responses`,
`rehire_pct`, `provisional`

Averaged from completed `surveys`. **A contractor with no reviews scores 8.0 and
the function flags `provisional: true`** — design must say "not yet rated"
rather than showing a confident 8.0. Getting this wrong makes every new
contractor look identically mediocre.

---

## 5. Work arriving — two doors, and they are not the same door

This is the heart of the app and the part most likely to be drawn wrong.

### Door A — a community package offer (the homeowner app)

A resident picked a pre-priced package and booked it. The system created a
`bid_packages` offer and invited **one `bids` row per contractor holding that
trade**. Everyone invited sees the same job at the same price at the same moment.

**Accept at the stated price, or pass. There is no counter-offer.**

#### 5.1 Offers **[wired]**
**Source:** `homeowner_offers()`

Returns, per open offer: `package` name, `trade`, `price_cents`, `config_label`
(what the homeowner chose on the levers), **`town`** — note: the town only, cut
from the address — `posted_at`, `reply_by`, `scope` (the scope lines as an
array), **`photos` as a count, not the photos**, and the bid `status`.

**Decided 2026-09-08 (Shahar): the contractor sees the owner's photos and the
town, but not the street address, before accepting.**

- **The photos are shown.** A contractor cannot price or judge a job blind, so
  the pictures the owner uploaded are part of the offer card. Draw them as the
  card's evidence — a strip, tappable to full screen.
- **No street address until you accept.** The town, not the line. Draw the card
  so it is still decidable: package, config, price, scope lines, photos, town,
  clock. The address arrives at the moment of acceptance, with the phone number.

⚠️ **This needs a database change before it can be drawn against real data.**
`homeowner_offers()` today returns `photos` as a **count**, not paths. It needs
to return the file rows, and `project-media` is a private bucket — so the app
needs signed URLs for a contractor who is invited but not yet seated. Until that
lands, design against the intent and treat the count as a placeholder.

The clock: `reply_by` is `posted_at + 24 hours`. A visible countdown, and a card
that changes character in the last hours, is the single highest-value thing on
this screen.

#### 5.2 One offer, and the accept sheet **[wired]**
**Source:** `homeowner_offer_accept(project_id)` / `homeowner_offer_decline(project_id)`

Accepting is not a "yes" — it writes a **contract**. The sheet must say what is
being taken on, because all of it is fixed by the function and none of it is
negotiable afterwards:

- A `construction trade contract`, status **awarded**, amount = the package
  price, trade = the package trade.
- Deposit = the package's `permit_deposit_pct`. **Retainage = 0.**
- `consumables_by` and `finish_material_by` are **both set to `subcontractor`** —
  on a package job the contractor supplies everything. (This deliberately
  departs from the house default in rulebook §53, where the owner supplies
  finish material. Worth confirming — see §10.)
- The payment milestones already on the job bind to this contract.
- You are seated on the project as `collaborator` / `contractor`, **bounded by
  that contract**.
- The homeowner gets a message on the job timeline: *"…accepted the job at $X.
  You now have each other's contact details."* That sentence is the moment the
  address and phone number appear. Design the accept confirmation as *the reveal*.

**The race.** `homeowner_offer_accept` takes a row lock and refuses unless the
booking is still `posted`. If someone else got there first the function returns
`{ ok: false, code: 'TAKEN', reason: 'This job is no longer open.' }`.
**Draw the TAKEN state properly.** Every contractor who loses the race sees it,
which makes it one of the most-viewed screens in the app. It should point
somewhere — the next open offer — not dead-end.

**Passing** (`homeowner_offer_decline`) marks that contractor's bid `declined`
and the offer drops off their list. It is silent to the homeowner and it is not
undoable from the UI. A confirm step is warranted.

### Door B — a bid package (a real project, priced by you)

Not a package: a homeowner or GC wrote a scope and asked several trades to
price it. Here the contractor **does** reply with numbers.

#### 5.3 Bid invitations **[live]** · today `/my/bid/[bidId]` (222 lines)
**Source:** `portal_my_bid_projects()` (across projects), `portal_my_bids(project)`,
`portal_bid(bid_id)` for one

`portal_my_bid_projects` sorts by **who owes the next move** — `awarded`,
`pending you`, `pending customer`, `not awarded`. That ordering is the screen;
keep it.

#### 5.4 The reply **[live]**
**Source:** `portal_bid(bid_id)` to read, `portal_bid_reply(...)` to write

The package arrives in its own shape and the reply answers it line by line:

- **Scope items**, each `is_required` or not, each answered **included / not
  included** with your own note and number.
- **Terms** to accept or counter: deposit %, retainage % and its release
  trigger, net days, consumables by, finish material by.
- **Insurance**: GL per occurrence, GL aggregate, workers' comp, COI required.
- **One total**, a `valid_until` date, free notes.
- The owner's **budget is shown only if `budget_visible`** — draw both states.

The rule with teeth: `portal_bid_reply` computes **scope gaps** server-side.
Every required line you did not mark `included` is collected into `scope_gaps`,
and `is_like_for_like` becomes false. The contractor should see that verdict
*before* submitting — "your price is not like-for-like: 2 required items are
not included" — because it is what the owner will judge them on.

`can_reply` is true only while the package is `open` and the bid is
`invited / received / under negotiation`. Otherwise the screen is read-only.

**Bid statuses in use:** `invited`, `received`, `under negotiation`, `awarded`,
`not awarded`, `declined`, `expired`, `no response`, `withdrawn`.

---

## 6. The job

### 6.1 Work home **[live]** · today `/contractor`
**Source:** `portal_my_work()` — one call, everything

Per project it returns `seat`, `rank`, `my_open_tasks`, `bid_amount`, `owed`,
`owed_count`, the home above it (`parent_name`), and — the useful part — a
**`buckets` array** the database computes for you:

| Bucket | Means |
| --- | --- |
| `lead` | You are invited and have not replied |
| `decision` | You replied; the customer is deciding |
| `active` | You are seated or won it; it is running |
| `payment` | Money is owed to you on it |
| `done` | The project is closed |

A project can be in several. **These buckets are the information architecture of
the home screen** — do not invent a different set of tabs. The homeowner app's
equivalent (live / planned / done) is the pattern to mirror.

### 6.2 One job **[live]** · today `/my/project/[id]` with `ContractorView`
The job screen carries, in this order: **what is next** (open tasks on you),
the **contract card**, the **milestones and money** (rank ≥ 40 only), the
**scope with its evidence**, the **timeline**, and **who else is on it**.

### 6.3 The contract **[live]**
**Source:** `portal_my_contract(project_id)`

Title, status, trade, amount, signed/start/end dates, the scope text, and the
terms that cause arguments: net days, deposit %, retainage % and release
trigger, **consumables by**, **finish material by**, payment-terms notes,
whether a COI is required, and the milestone count.

Those two "by" fields deserve a plain-English line on the screen, not a label
and a value. *"You supply nails, screws, glue, blades, caulk. The owner supplies
the tile, the flooring, the glass."* This is rulebook §53 and it exists to
prevent a mid-job argument about a box of screws.

### 6.4 Scope and evidence **[live]**
**Source:** `portal_scope_evidence(project_id)`, attach via
`portal_scope_evidence_attach(file_id, scope_item, role)`

The scope line by line with the proof against each. The contractor doing the
work and the owner who wrote the scope add to the same list. A bid was priced
from these lines; this is where they are shown to have been delivered.

### 6.5 Tasks, and closing one **[live]**
**Source:** `portal_task_detail(task)`, close via `portal_close_task(action_id, unlock_reason)`

**The photo gate is the rule this app exists to enforce.** `portal_close_task`
counts photos linked to the task and:

- 0 photos, no reason → refuses with `code: 'NEEDS_PHOTO'` —
  *"Add a photo, or unlock and say why there is none."*
- 0 photos, reason under 8 characters → `REASON_TOO_SHORT` —
  *"Say why in a few words - this is recorded against the task."*
- 0 photos with a real reason → closes, and writes a permanent comment on the
  task: **"CLOSED WITHOUT PHOTO. Reason given: …"**

Design the camera as the primary action on a task, not a secondary one. The
unlock should feel like what it is: a thing that goes on the record.

**Decided 2026-09-08 (Shahar): the PM *and the homeowner* may close without an
image, as an override with a comment. A contractor may not.**

So the unlock is a **seat-dependent control**, and the screen changes shape by
who is looking:

| Who | Closing a photo-required task with no photo |
| --- | --- |
| Homeowner (project owner) | May override, with a comment |
| PM / GC | May override, with a comment |
| Contractor, sub, crew | **May not.** The close control stays disabled; the ask is "add a photo", and the route out is to message the PM |

⚠️ **Two things must change to make that true.** `portal_close_task` as written
lets *anyone* who passes `can_edit_project` unlock with a typed reason — it does
not distinguish a contractor from a PM. And rulebook §14 currently names the PM
alone as the override holder; the homeowner has to be added to it. Neither is a
design question, but the contractor screen must not offer a control the seat
will not be allowed to keep.

### 6.6 Timeline **[live]**
**Source:** `messages` between the two contacts, channel `in app`; photos via
`record_project_file` into `project-media`

Messages, photos and voice notes on the job. One attachment per message
(`messages.file_id`). The homeowner app already has this composer — reuse it.

### 6.7 Site check-in **[live]**
**Source:** `portal_my_checkin_token(project)` mints/returns the token;
`checkin_context(token)`, `checkin_submit(token, kind, note, lat, lng, urls[])`,
`checkin_history(token)`

A token link, which is why crew with no login can use it. Arrive or leave, a
note, location, and **at least one photo — the function refuses without one**
(max 10). History is the last 14 days.

This is the crew screen and it should be almost nothing: a big **I'm here**, a
camera, and **I'm leaving**. `CrewSite.tsx` in the root portal already has the
right instinct — *"the whole project, for a hand on site: are you here, a photo,
a word, and signing out at the end. Nothing about money, scope or anyone else's
trade."*

---

## 7. Money

### 7.1 Milestones **[live]** — rank ≥ 40
**Source:** `portal_my_milestones(project_id)`

Per stage: name, sequence, amount, percent of contract, the **trigger** that
releases it, due date, status, `requires_photo`, `paid_at`, `settlement_status`.

Two vocabularies, and they are not the same:
`payment_stages.status` = Planned, Ready, Requested, Approved, Paid, Disputed,
Cancelled. `settlement_status` = not_started, authorized, pending_clearance,
paid, refunded, failed.

**Approved means the milestone is met; paid means the money moved.** The gap
between them is what a contractor is chasing, and the screen should show it as a
gap, not as one status.

### 7.2 What I am owed **[wired]**
`portal_my_work()` already returns `owed` and `owed_count` per project —
transactions out to this contractor not yet in a paid/settled state. A single
"owed" figure across all jobs is a one-line derivation and is probably the
second thing a contractor opens the app for.

### 7.3 Getting paid, and the waiver **[new]**
Card payments are **not wired** — the processor rail exists in `payment_methods`
but nothing collects. Today the homeowner records a check, cash or Zelle and
photographs it. On the contractor side that means: a milestone goes Approved,
then Paid, and the contractor confirms receipt.

Rulebook §51 requires a **lien waiver at handover** — partial waivers during the
job, a final unconditional one with the last payment, and *never a final payment
without one*. Nothing in the app does this yet.

**Decided 2026-09-08 (Shahar): the waiver is baked into every signed addendum as
a hard requirement.** It is not an optional step at the end and not a separate
document to chase — the signature that releases a payment carries the waiver
with it. For the designer that means there is no "send a waiver" screen to draw:
there is a **signing** screen, and the waiver language is part of what is being
signed, shown plainly above the signature rather than buried in a link.

This is the largest genuinely new surface on the contractor side and it protects
both parties: one signature proves payment and releases lien rights to that date.

**Retainage:** on a package job it is 0. On a bid job `stage_payment_quote`
deducts `contracts.retainage_pct` from every milestone and a stage flagged
`is_retainage_release` pays it out. A contractor needs to see the withheld
total somewhere or they will believe they were underpaid.

---

## 8. Finishing

- **The last task.** A project can only close as `Closed - Completed` with
  **zero open tasks** — a hard gate, no override. The contractor's list emptying
  is what allows the homeowner's progress line to say Done.
- **Progress is derived** (rulebook §34) from spend against budget, milestones
  paid, and tasks closed. There is no status field for anyone to set, and
  nothing in this app should offer to set one.
- **The rating.** A completed job invites a survey; the score feeds
  `contractor_rating` and shows on the contractor's card to the next homeowner.
  Closing the loop back to §4.2 is the retention mechanic.
- **The share card.** The homeowner may publish the finished job
  (`homeowner_share_publish`) — package, town, dates, community price,
  **contractor name and rating**. The contractor is named on it and should know
  that, and probably should be able to see it.

---

## 9. Design system — do not start from scratch

The look is decided and it is in the repo: `apps/shared/src/styles/warm-ink.css`,
"Warm Ink". Warm off-white ground, white cards, black pills and chips, coral for
status only. Manrope, weight 800 for headings, -0.02em tracking.

```
--color-bg #f6f3ee   --color-surface #ffffff  --color-text #161513
--color-muted #7a746c --color-status #e5654e  --color-brand #2f8f3e
--color-ok #2f7a55    --color-danger #b8432f
--radius-card 24px    --radius-tile 20px      --radius-input 16px
--radius-pill 999px   --shadow-card 0 10px 30px rgba(22,21,19,.07)
```

The component classes already exist — `.card`, `.tile`, `.pill-time`, `.chips`,
`.tag-ok`, `.tag-danger`, `.tag-status`, `.status-hero`, `.sheet`, `.tabbar`,
`.composer`, `.viewfinder`, `.shutter`, `.steps`, `.seg`, `.thread`, `.bubble`,
`.price`, `.scope`, `.facts`, `.wait-bar` — as do the primitives in
`apps/shared/src/ui.tsx`: `Screen`, `Card`, `AppBar`, `Wordmark`, `StatusHero`,
`Notice`, `StepKicker`, `NumberedNotes`, `Avatar`, `Skeleton`.

**The ask for the designer is not a new visual language.** It is: these screens,
in this system, for a different user — one who is working rather than shopping.
Where the contractor app needs something the homeowner app does not have (a
countdown, a race-lost state, a milestone ledger, a waiver signature), that is
where new design is genuinely needed.

Layout: one phone-wide column, centred on desktop. Three tabs, matching the
homeowner shell — **Work · Inbox · Business**.

---

## 10. Decisions

### Settled 2026-09-08 (Shahar)

1. **Photos before accepting — YES.** The contractor sees the photos the owner
   uploaded. §5.1. *Carries database work: `homeowner_offers()` must return the
   file rows, and `project-media` is private, so signed URLs are needed for an
   invited-but-not-seated contractor.*
2. **Address before accepting — NO.** Town only; the address arrives with the
   acceptance. §5.1.
3. **The photo-close override — the PM and the homeowner may override with a
   comment; the contractor may not.** §6.5. *Carries work: `portal_close_task`
   does not currently distinguish the seats, and rulebook §14 names the PM
   alone and must be widened to include the homeowner.*
4. **Lien waiver — baked into every signed addendum as a hard requirement.**
   Not a separate document, not an optional final step. §7.3.

> **The open ones are tracked in `public.actions`**, as gate children under
> *"Contractor app: settle the seven open decisions (BUILD.md §12)"* — together
> with the seven from that section, so there is ONE register and not two
> (CLAUDE.md: tasks live in `public.actions`, never a second list). Answering
> one means closing the child AND writing the answer here in the same breath.
>
> The two settled decisions that carry database work — photos before accepting
> (§10.1) and the photo-close override (§10.3) — are their own action rows,
> because they are build work now, not decisions.

### Still open — deliberately parked

5. **Consumables and finish material on package jobs** (§5.2). The accept
   function sets *both* to `subcontractor`, departing from the rulebook §53
   default where the owner supplies finish material. Probably right for all-in
   package pricing, but it lives only in a function body and should be stated.
   **Still needs an answer** — it changes a sentence on the contract screen.
6. **Auto-bid.** `contractor_settings.auto_bid` exists and nothing reads it.
   Auto-accepting at a stated price is plausible and dangerous. Design it
   deliberately or hide the switch.
7. **The pending-review wait** (§3.4) — what an applicant sees, and for how long.
8. **Notifications.** A 24-hour offer window is worthless if the app has to be
   open. Push, SMS or email is a product decision that predates the screens.

---

## Appendix — the function surface, in one place

**Onboarding:** `vendor_register`, `vendor_request_code`, `vendor_verify_code`,
`vendor_update_profile`, `vendor_trades`, `portal_my_invites`,
`portal_invite_respond`

**Business:** `portal_my_business`, `portal_my_company_save`,
`portal_my_terms_save`, `portal_my_trades_set`, `portal_price_item_save`,
`portal_price_item_delete`, `portal_credential_save`,
`portal_credential_delete`, `portal_my_profile`, `portal_my_profile_save`,
`contractor_rating`

**Package offers:** `homeowner_offers`, `homeowner_offer_accept`,
`homeowner_offer_decline`

**Bids:** `portal_my_bid_projects`, `portal_my_bids`, `portal_bid`,
`portal_bid_reply`, `portal_bidder_history`

**The job:** `portal_my_work`, `portal_my_contract`, `portal_my_milestones`,
`portal_scope_evidence`, `portal_scope_evidence_attach`, `portal_task_detail`,
`portal_close_task`, `portal_my_messages`, `portal_message_seen`

**Site:** `portal_my_checkin_token`, `checkin_context`, `checkin_submit`,
`checkin_history`

Tables worth knowing by name: `bids`, `bid_packages`, `bid_package_items`,
`project_bookings`, `contracts`, `payment_stages`, `project_members`,
`project_roles`, `contractor_settings`, `contractor_price_items`,
`contact_credentials`, `contact_trade_roles`, `site_checkin_links`,
`site_checkins`, `surveys`.
