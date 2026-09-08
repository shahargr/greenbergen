# Retiring the owner portal

The goal: the portal at `greenbergen.vercel.app` becomes the **admin** surface,
and everyone else lives in the homeowner, contractor or builder app.

This file exists because of one instruction — *"making sure we don't leave any
capabilities behind"* — and the honest answer to it is: **not yet.** Six things
the portal does today have no home anywhere else. Gating it to admins now would
delete them from the product. They are listed below, and each is a small,
well-defined build on functions that already exist.

## Done: people are routed on the way in

`/after-login` resolves where a person belongs and sends them there. All three
sign-in paths land on it — the emailed code, the magic link and Google — so
they can never disagree.

| Who | Lands on |
| --- | --- |
| Admin (`app_users.is_superadmin`) | `/my` — the portal is theirs |
| Exactly one door | that app, directly |
| More than one door, not admin | `/choose` — asked, never guessed |
| No door yet (a brand-new account) | `/my` |

`my_doors()` decides, using tests the rest of the system already uses so they
cannot drift: **builder** = a seat at `authority_rank >= 50` (the line
`bid_can_manage` draws and the builder app calls `MANAGES`); **homeowner** = a
seat on a project that *is* an asset; **contractor** = a `contractor_approvals`
row or any bid.

An explicit `?next=` still wins everywhere, so deep links into the portal keep
working. **This is routing, not a gate — nothing has been taken away.**

## The 33 portal routes, and who covers them

### Stays in the portal for good — admin and public

`/admin`, `/admin/deals`, `/admin/finance`, `/admin/photos`, `/admin/projects`,
`/admin/storage`, `/admin/users`, `/deals`, `/vision`, `/help`, `/p/[slug]`
(public project pages), `/vendor/complete` (a link vendors are sent), `/join`,
`/login`, `/`.

### Already replaced — safe to gate

| Portal | Replaced by |
| --- | --- |
| `/contractor` | builder `/` |
| `/my/tasks` | builder `/tasks` |
| `/my/task/[id]` | builder `/task/[id]` |
| `/my/business` | contractor `/business` (+ `/trades`, `/documents`) |
| `/my/settings` | `/settings` in each app |
| `/my/new-home` | homeowner `/homes/new` |
| `/my/invite` | homeowner `/settings` |
| `/my/inbox` | `/inbox` in all four — one shared model, same functions |

### NOT replaced — gating today would lose these

1. **Running a bid.** `/my/project/[id]/bids` and `/bids/[pkg]` — 769 lines over
   thirteen functions: `portal_bid_package_save`, `portal_bid_package_items_set`,
   `portal_bid_invite`, `portal_bid_compare`, `portal_bid_award`,
   `portal_bid_review_save`, `portal_bid_doc_attach`, `portal_bidder_history`.
   This is builder step 3. **Nothing anywhere else can put a job out to bid.**
2. **Answering a bid.** `/my/bid/[bidId]` — `portal_bid`, `portal_bid_reply`.
   This is the contractor app's offer feed, not yet built. **A trade currently
   has no other way to price a job.**
3. **Money.** `/my/financials` and `/my/payments` — `portal_finance_rollup`,
   `portal_projects_overview`. The builder's `/money` is still a placeholder.
4. **Starting a project.** `/my/new-project`. No app can create one.
5. **The contractor directory.** `/my/contractor/[id]` — `portal_contractor`.
6. **Profile, price list and terms.** `/my/profile` (`portal_my_profile_save`,
   `portal_my_trades_set`, `portal_credential_save`) and the price-item and
   terms halves of `/my/business` (`portal_price_item_save`,
   `portal_my_terms_save`). The contractor app covers the business record and
   documents but neither the price list nor the terms.

## The order to do it in

1. Builder step 3 — bid packages, invite, compare, award. Clears (1).
2. Contractor offer feed — accept, ask for details, decline. Clears (2).
3. Builder `/money` on `portal_finance_rollup`. Clears (3).
4. Profile, price list, terms into the contractor and builder settings. Clears (6).
5. New project + contractor directory. Clears (4) and (5).
6. **Then** gate: `/my/*` and `/contractor` admit `is_superadmin` only, and every
   replaced route 302s to the app that replaced it rather than 404ing.

Step 6 is one middleware change. It is deliberately last, and the five before it
are what "no capabilities left behind" actually costs.

## Rules that hold throughout

- Redirect, never delete. A replaced route should send people to its
  replacement — an old bookmark must not become a dead end.
- The apps are separate origins. Every hop between them is a full link, and the
  session travels because all four sit on one Supabase Auth login.
- `/admin/*`, `/deals`, `/vision`, `/help`, `/p/[slug]` and `/vendor/complete`
  are not on the table at any point.
