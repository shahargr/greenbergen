# Building `apps/builder` — the GC / PM app

Build instructions for the fourth Green Bergen app. Read this before writing
code, then read the database (rulebook + `help`) as every session does.

Companion apps: `/` (owner portal), `apps/homeowner`, `apps/contractor`,
`apps/builder` (this one). Shared code is `apps/shared` (`@shared/*`).

---

## 1. The headline: this is a VIEW, not a re-platform

Shahar's words: *"GC is a view to the existing Supabase."* That is literally
true, and it is the single most important fact for whoever builds this.

The portal's GC half is ~6,500 lines of TSX, and **every one of those screens
already reads and writes through database functions**. There are **74
`portal_*` functions** live today covering scope, bid packages, bidding,
awarding, site visits, crew rosters, finance, tasks, contracts, files,
messages and invitations — plus the shared ones (`me`, `close_action`,
`record_project_file`, `file_attach`, `create_home_project`,
`my_authority_rank`, `can_edit_project`, `home_workstreams`).

So the expected database work for this app is **close to zero**. If you find
yourself writing a migration, stop and check whether a `portal_*` function
already does it. The exceptions are listed in §6, and there are only a few.

What this app is, then: a mobile-first, purpose-built client over a function
surface that is already finished and already in production use.

---

## 2. Who it is for

The GC and the PM — someone running a multi-trade project, not a trade
taking a package (that is `apps/contractor`) and not a neighbour booking one
(that is `apps/homeowner`).

Designed for Shahar first, but **anyone may become their own GC** and run a
large building project. The seat decides what you see: the portal already
distinguishes a **manager** seat (PM / GC — the whole board) from a
**collaborator** seat (contractor — only your own contract-backed work), and
`portal_my_work()` returns `seat` and `rank` per project. Use that, do not
invent a role system.

The portal's admin "hat" cookie (`gb_view` = PM / GC / Contractor) is an
admin masking tool. Do not port it as a user-facing feature; if it is
useful for testing, keep it behind `is_superadmin`.

---

## 3. Rules it inherits

Same as every app here, and one that bites specifically:

1. **The address rule (migration `008`) applies to GC projects too** —
   confirmed, deliberately, no exemption. A trade a GC invites to bid sees
   the **town** until they win. `bid_may_see_address` is the one test;
   `project_town` and `project_label_no_address` are what everyone else
   gets. When you build the invite-bidders screen, say so on it, so the GC
   understands why their bidder is not being told the street.
2. **The database is the app.** Read functions, not tables. The portal
   occasionally queries `project_members` and `projects` directly (see
   `/contractor`); prefer `portal_my_work()` over repeating that.
3. **One task list** — `public.actions`, `domain = 'construction'`.
4. **`blueprint_` is a template, `project_` is an instance**; scope is
   copied down; progress is derived.
5. **Search before creating a table.** §6 is the whole permitted list.
6. **SECURITY DEFINER + pinned `search_path` + revoke-then-grant** for
   anything new.

---

## 4. Where it lives

- Folder `apps/builder/`, imports `@shared/*`, never from another app.
- Vercel project `greenbergen-builder`, Root Directory `apps/builder`,
  production branch `main` → `https://greenbergen-builder.vercel.app`.
- Same Supabase Auth, same `app_users` row. A person can be a homeowner, a
  contractor and a GC with one login.
- Design: `@shared/styles/warm-ink.css`. Same tokens and components as the
  other two apps. This one carries **more data per screen** than the
  homeowner app, so lean on `.home-row`, `.card`, chips and the tasks table
  rather than inventing a denser system.
- Next 16: `proxy.ts` not middleware; `params`/`searchParams` are Promises;
  `force-dynamic` on authenticated pages; no `Date.now()` in render.

---

## 5. Screens, and the function each one already has

The portal route each screen mirrors is named so you can read the original.

### B1 · Board — `/` (mirrors `/contractor`)
Every project you hold a seat on. **`portal_my_work()`** returns it whole:
`project_id, project_name, address, status, stage, domain, parent_project_id,
parent_name, seat, rank, my_open_tasks, bid_amount, latest_bid_id, owed,
owed_count, buckets[]`.

Buckets (`active`, `lead`, `decision`, `payment`, `done`) are computed in the
database — use them as the filter chips rather than deriving your own.
`rank >= 50` is a manager seat (`bid_can_manage`), so the board can split
*projects you run* from *projects you work on*.

Open tasks across the board: **`portal_tasks(p_domain => 'construction')`**.

### B2 · Project — `/project/[id]` (mirrors `/my/project/[id]`, 1,481 lines)
The big one. Break it into tabs rather than one scroll:

| Tab | Functions |
|---|---|
| Overview | `portal_project_brief`, `portal_finance_rollup`, `home_workstreams` |
| Scope | `portal_scope_evidence`, `portal_scope_candidates`, `portal_scope_trades`, `portal_scope_trades_set`, `portal_scope_copy`, `portal_scope_item_save`, `portal_scope_item_delete`, `portal_scope_packages`, `portal_scope_evidence_attach` |
| Tasks | `portal_tasks(p_project_id)`, `portal_task_detail`, `close_action`, `portal_close_task` |
| Bids | see B3 |
| Site | `portal_site_day`, `portal_site_check`, `portal_site_roster_set`, `portal_my_checkin_token` |
| Money | `portal_finance_rollup`, `portal_my_milestones`, `portal_my_contract`, `portal_transaction_detail` |
| Files | `portal_brief_files`, `record_project_file`, `file_attach`, `portal_project_file_delete` |
| People | `project_people`, `portal_invite_to_project`, `portal_update_contact` |

### B3 · Bids — `/project/[id]/bids` and `/bids/[pkg]`
The portal's three-step flow, kept: **1 create a package · 2 invite bidders ·
3 award**.

`portal_bid_needs`, `portal_bid_needs_seed`, `portal_bid_need_add`,
`portal_bid_need_remove` · `portal_bid_packages`, `portal_bid_package`,
`portal_bid_package_save`, `portal_bid_package_items_set` ·
`portal_bid_candidates`, `portal_bid_invite`, `portal_bid_share` ·
`portal_bid_compare`, `portal_bidder_history`, `portal_bid_review_save` ·
`portal_bid_award` · `portal_bid_doc_attach`, `portal_bid`, `portal_my_bids`.

**This is where `apps/contractor` connects.** The trades a GC invites are
that app's users — `portal_bid_invite` writes the same `bids` rows the
contractor app reads, and `fn_bids_notify` sends the same (address-safe)
message. Two apps, one table, no integration to write.

### B4 · Tasks — `/tasks` (mirrors `/my/tasks`)
The board across every project. `portal_tasks`, `my_lead_actions`,
`portal_projects_overview`.

### B5 · Task — `/task/[id]` (mirrors `/my/task/[id]`, 329 lines)
Detail, evidence, transactions, closing. `portal_task_detail`,
`portal_transaction_detail`, `close_action`, `record_project_file`,
`file_attach`.

### B6 · Money — `/money` (mirrors `/my/payments` + `/my/financials`)
`portal_projects_overview`, `portal_finance_rollup`, `portal_my_milestones`,
`portal_transaction_detail`.

### B7 · People — `/people` (mirrors `/my/contractor/[id]` + settings lists)
`portal_my_contractors`, `portal_contractor`, `portal_my_contacts`,
`portal_bidder_history`, `portal_update_contact`.

### B8 · Inbox — `/inbox` (mirrors `/my/inbox`)
`portal_my_messages`, `portal_my_invites`, `portal_compose_targets`,
`send_portal_message`, `portal_message_seen/set/delete/to_task`,
`portal_invite_respond`.

### B9 · New project — `/new` (mirrors `/my/new-project`)
`create_home_asset`, `create_home_project`, `may_create_project`,
`portal_scope_candidates`, `portal_scope_copy`. All three work sources are
in scope: existing portal projects, a homeowner booking escalated into a
GC-run project, and a project started here.

### B10 · Settings — gear
`portal_my_profile`, `portal_my_profile_save`, `portal_my_business`,
`portal_my_company_save`, `portal_my_terms_save`, `portal_credential_save`,
sign out.

---

## 6. The only database work

Everything above exists. What does not:

| Need | Why nothing fits |
|---|---|
| **Escalating a homeowner booking to a GC project** | Nothing converts a `project_bookings` job into a GC-run project with a manager seat. Small function: seat a GC, mark the booking, keep the history. |
| **`builder_me()`** | A one-round-trip shell read, the way `homeowner_me()` and `contractor_me()` work. Optional — `me()` + `portal_my_work()` covers it — but it saves a round trip on every screen. |
| **A GC's own approval/credentials** | Only if outside GCs become customers. Reuse `contractor_approvals` rather than a second table if so. |

Nothing else. If a screen seems to need a new function, read §5 again first.

---

## 7. Build order

1. **Shell and board** — app, Vercel project, auth, `/` from
   `portal_my_work()` + `portal_tasks()`. *A GC sees everything they run.*
2. **Project overview and tasks** — `/project/[id]` header, finance rollup,
   task list; `/task/[id]`. *A GC runs the work.*
3. **Bids** — packages, invite, compare, award. *A GC buys the work, and
   `apps/contractor` lights up on the other side.*
4. **Scope** — evidence, candidates, trades, copy-down.
5. **Site** — visits, roster, days on site by person and trade.
6. **Money** — rollups, milestones, contracts, transactions.
7. **People, inbox, new project, settings.**

---

## 8. Then: what comes OUT of the portal

Once this ships, the portal is replicating three apps. Removal is its own
task and should not start until each app has replaced the surface — but the
map is roughly:

| Portal route | Replaced by |
|---|---|
| `/contractor`, `/my/bid/*` | `apps/contractor` + `apps/builder` |
| `/my/project/*`, `/my/tasks`, `/my/task/*` | `apps/builder` |
| `/my/payments`, `/my/financials` | `apps/builder` |
| `/my/house/*`, `/my/new-home` | `apps/homeowner` |
| `/my/business`, `/my/profile` | `apps/contractor` / `apps/builder` |

**Stays in the portal:** `/admin/*` (there is no admin app), `/deals`,
`/vision`, `/help`, `/p/[slug]` public showcase, `/join`, `/vendor`.

Do not delete anything from the portal until the replacement is in real use.
A screen with no replacement is a capability lost, not a simplification.
