import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";
import { shortDate } from "@shared/format";
import { stopwatch } from "@shared/perf";
import { AppBar, Card, ChevronIcon, Notice, Screen } from "@shared/ui";
import { GROUPINGS, coverUrls, getBoard, groupTasks, money, runs, type GroupKey, type Seat } from "@/lib/board";
import { SearchBox } from "@/components/SearchBox";
import { matchesQuery } from "@/lib/search";
import { ProjectSetup } from "./ProjectSetup";
import { SiteVisits, type Visit } from "./SiteVisits";
import { SiteWeekTrades, weekDay, type SiteWeek } from "./SiteWeek";
import { cancelProject, closeProject, reopenProject } from "./actions";

export const dynamic = "force-dynamic";

// ONE PROJECT, AS NINE PANELS AND ONE ANSWER.
//
// Shahar (2026-09-11): "on each panel we should have a clear wording
// explaining the numbers. each panel should be clickable. The panel on site
// this week should change to the panel content once one clicks on it… open
// work and no due date are not needed unless called for from the 9 buttons."
//
// So the screen is a grid of counts, each saying in words what it counts, and
// exactly ONE content area beneath it belonging to whichever panel is
// selected. Nothing stacks: the task list, the bids, the money, the jobs
// beneath, the week's trades and the visits are six views of one place, and
// you are only ever looking at one. Every number is still computed in the
// database - portal_finance_rollup, portal_bid_packages, portal_tasks,
// portal_site_week - so this screen decides what to show and nothing more.
type Rollup = {
  contracted?: number | null; paid?: number | null; owed?: number | null;
  approved?: number | null; stages?: number | null; open_stages?: number | null;
} | null;

type ScopeTrade = { trade: string; chosen: boolean; scope_lines: number };

// portal_bid_packages names the counts n_invited / n_received - this screen
// asked for "invited" and "received", which are not keys the function
// returns, so the row never showed how many were on a package.
type BidPackage = {
  id: string; trade: string | null; category: string | null; phase: string | null;
  status: string; reply_by: string | null;
  n_invited: number | null; n_received: number | null; awarded_bid_id: string | null;
};

// The nine. Eight carry a number; the ninth is held open (Shahar: "leave the
// 9th panel as a place holder for now").
type PanelKey =
  | "tasks" | "bids" | "money"
  | "jobs-open" | "jobs-working" | "jobs-done"
  | "week" | "visits" | "soon";

export default async function ProjectPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; q?: string; by?: string; show?: string; panel?: string }>;
}) {
  const { id } = await params;
  const { ok, error, q, by: byRaw, show, panel: panelRaw } = await searchParams;
  const by: GroupKey = GROUPINGS.some((g) => g.key === byRaw) ? (byRaw as GroupKey) : "timing";
  // Open is the default; Done and All are a tap away (Shahar: "i need to see
  // completed as well"). Only the finished list costs an extra read, and only
  // the tasks panel asks for it - which panel that is cannot be settled until
  // the seat is read (a project with no site opens on the work), so the test
  // is "not some other panel" rather than "the tasks panel".
  const wantDone = (show === "done" || show === "all") && (!panelRaw || panelRaw === "tasks");
  const w = stopwatch("/project/[id]");
  const supabase = await createClient();

  // The shell and the project's own reads do not depend on each other.
  // portal_scope_trades is one row per worker trade carrying its counts, so
  // the scope summary costs a small read - the scope lines themselves are
  // only fetched on the screen that shows them.
  // No per-project task read: getBoard() already fetches every open task in
  // the domain, and this screen wants the whole property anyway (see below),
  // which a project-scoped portal_tasks could not answer without one call
  // per job beneath it.
  const [board, { data: pkgData }, { data: rollupData }, { data: scopeData }, { data: weekData }, { data: visitData }] = await Promise.all([
    w.step("board", () => getBoard({ closed: wantDone ? 500 : 0 })),
    w.step("bids", () => rpc<BidPackage[]>(supabase, "portal_bid_packages", { p_project: id })),
    w.step("finance", () => rpc<Rollup>(supabase, "portal_finance_rollup", { p_project_id: id })),
    w.step("scope", () => rpc<ScopeTrade[]>(supabase, "portal_scope_trades", { p_project: id })),
    // Who is on site this week, and the record of who has been (migration 068).
    w.step("week", () => rpc<SiteWeek>(supabase, "portal_site_week", { p_project: id })),
    w.step("visits", () => rpc<Visit[]>(supabase, "portal_site_visits", { p_project: id, p_limit: 20 })),
  ]);
  if (!board.signed_in) redirect(`/login?next=/project/${id}`);

  const seat = board.seats.find((s) => s.project_id === id);
  if (!seat) notFound();
  const manages = runs(seat);

  // What sits beneath this project, and where "back" goes - both come out of
  // the board read we already have, so neither costs a query.
  const kids = board.seats.filter((s) => s.parent_project_id === id);
  // What still stands in the way of closing this one (migration 069).
  const liveKids = kids.filter((s) => !s.status.startsWith("Closed")).length;
  const parent = seat.parent_project_id && board.seats.some((s) => s.project_id === seat.parent_project_id)
    ? seat.parent_project_id : null;
  const openByProject = new Map<string, number>();
  for (const t of board.tasks) {
    if (t.state === "open" && t.project_id) openByProject.set(t.project_id, (openByProject.get(t.project_id) ?? 0) + 1);
  }

  // The day this site is having, not the day UTC is having: a visit logged at
  // eight in the evening in Bergen County is still today's visit.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const packages = pkgData ?? [];
  const openPkgs = packages.filter((p) => p.status === "open");
  const roll = rollupData ?? null;
  const owed = roll?.owed ?? seat.owed ?? 0;
  const scopeLines = (scopeData ?? []).reduce((n, t) => n + t.scope_lines, 0);
  const scopeTrades = (scopeData ?? []).filter((t) => t.chosen).length;
  const week = (weekData ?? null) as SiteWeek | null;
  const visits = Array.isArray(visitData) ? visitData : [];
  const closedAlready = seat.status.startsWith("Closed");
  const onSite = !!seat.address;

  // OPEN WORK ACROSS THE WHOLE PROPERTY, not just this row.
  //
  // A property container carries no tasks of its own - fn_actions_not_on_property
  // sees to that, and the work lives on the jobs beneath it. So asking
  // portal_tasks for 55 Walnut returns nothing while eleven jobs under it
  // are busy, and the screen would say "nothing open" about a live site.
  // Everything at or beneath this project is what a person means by "the
  // tasks on 55 Walnut", and board.tasks already holds them - the descendant
  // set comes out of seats we have, so this costs no query.
  const family = new Set<string>([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const s of board.seats) {
      if (s.parent_project_id && family.has(s.parent_project_id) && !family.has(s.project_id)) {
        family.add(s.project_id); grew = true;
      }
    }
  }
  const nameOf = new Map(board.seats.map((s) => [s.project_id, s.project_name]));
  const here = board.tasks.filter((t) => t.project_id && family.has(t.project_id));
  const openHere = here.filter((t) => t.state === "open");
  const doneHere = here.filter((t) => t.state === "closed");
  const late = openHere.filter((t) => t.target_date && t.target_date < today);

  // THE JOBS BENEATH, AS THREE COUNTS (Shahar, 2026-09-11). The words mean
  // what they say:
  //   open       still open, nothing on the board yet - waiting to start
  //   working    still open, with tasks on it - somebody is on it
  //   completed  closed as completed
  //
  // A job closed as CANCELLED is none of those, and folding it into
  // "completed" would be a lie, so it is listed under the completed ones
  // rather than counted with them. Every job beneath is reachable.
  const kidOpen = kids.filter((k) => !k.status.startsWith("Closed") && (openByProject.get(k.project_id) ?? 0) === 0);
  const kidWorking = kids.filter((k) => !k.status.startsWith("Closed") && (openByProject.get(k.project_id) ?? 0) > 0);
  const kidDone = kids.filter((k) => k.status === "Closed - Completed");
  const kidEnded = kids.filter((k) => k.status.startsWith("Closed") && k.status !== "Closed - Completed");

  // Which panels this project actually has. A development has no address, so
  // it has no site to stand on and no week; a job with nothing beneath it has
  // no jobs to count. The grid stays three wide either way and the ninth is
  // always the one being held open.
  const hasKids = kids.length > 0;
  const offered: PanelKey[] = [
    "tasks", "bids", "money",
    ...(hasKids ? (["jobs-open", "jobs-working", "jobs-done"] as PanelKey[]) : []),
    ...(onSite ? (["week", "visits"] as PanelKey[]) : []),
    "soon",
  ];
  const wanted = (panelRaw ?? "") as PanelKey;
  // On site this week is what the screen opens on - it is the question a
  // person running a build asks first. Off site, the work itself is.
  const fallback: PanelKey = onSite ? "week" : "tasks";
  const panel: PanelKey = offered.includes(wanted) && wanted !== "soon" ? wanted : fallback;

  // Which tasks this view is about. Done is fetched only when asked for, so
  // the Open view costs exactly what it did before.
  const shown = panel !== "tasks" ? openHere
    : show === "done" ? doneHere : show === "all" ? here : openHere;
  // The search (Shahar: "find relevant tasks faster"): a word or two,
  // matched against the subject, the notes, the job, the trade, the person,
  // and the contract and phase the sections are named after.
  const query = (q ?? "").trim();
  const found = query
    ? shown.filter((t) => matchesQuery(query, [
        t.action, t.notes, t.project_id ? nameOf.get(t.project_id) ?? t.project : t.project,
        t.trade, t.assignee, t.status, t.contract, t.phase,
      ]))
    : shown;
  // Sections. Timing by default - every task has one; trade, contract and
  // phase are a tap away and name what they cannot place. See groupTasks.
  const sections = panel === "tasks" ? groupTasks(found, by) : [];

  // Links that keep the rest of the view: changing the panel must not throw
  // away nothing, but changing the grouping must not throw away the search.
  const viewHref = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged: Record<string, string | undefined> = {
      panel: panel === fallback ? undefined : panel,
      q: query || undefined, by: by === "timing" ? undefined : by, show: show || undefined,
      ...over,
    };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/project/${id}?${s}` : `/project/${id}`;
  };
  // Moving to another panel drops the task view's own state - a search for
  // "jimmy" has no meaning on the money panel, and carrying it there only
  // makes the back button lie.
  const panelHref = (k: PanelKey) => k === fallback ? `/project/${id}` : `/project/${id}?panel=${k}`;

  // One signed-URL round trip for the cover and everything hanging off the
  // visits - they all live in the same private bucket.
  const visitPaths = panel === "visits" ? visits.flatMap((v) => v.files.map((f) => f.path)) : [];
  const signed = await w.step("media", () => coverUrls(supabase, [seat.cover, ...visitPaths]));
  const cover = signed[seat.cover ?? ""] ?? null;
  w.done();

  const jobRows = (list: Seat[], empty: string) => (
    <div className="stack" style={{ gap: 6 }}>
      {list.length === 0 && <Card soft pad><div className="small">{empty}</div></Card>}
      {[...list]
        .sort((a, b) => (openByProject.get(b.project_id) ?? 0) - (openByProject.get(a.project_id) ?? 0)
          || a.project_name.localeCompare(b.project_name))
        .map((k) => {
          const n = openByProject.get(k.project_id) ?? 0;
          return (
            <Link href={`/project/${k.project_id}`} className="home-row" key={k.project_id}>
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="t">{k.project_name}</span>
                <span className="m" style={{ display: "block" }}>
                  {[k.seat && !runs(k) ? k.seat : null, k.status].filter(Boolean).join(" · ")}
                </span>
              </span>
              {n > 0
                ? <span className="tag tag-outline" style={{ whiteSpace: "nowrap" }}>{n} open</span>
                : <ChevronIcon />}
            </Link>
          );
        })}
    </div>
  );

  return (
    <Screen>
      <AppBar back={parent ? `/project/${parent}` : "/"} title={seat.project_name}
        sub={seat.address ?? seat.parent_name ?? undefined} />
      <div className="body">
        {error && <Notice kind="error">{error}</Notice>}
        {ok === "visit" && <div className="banner-ok">Logged. You&apos;re on that day&apos;s roster.</div>}
        {ok === "visit-edit" && <div className="banner-ok">Changed.</div>}
        {ok === "visit-gone" && <div className="banner-ok">Removed. Anything you attached stays on the project.</div>}
        {ok === "closed" && <div className="banner-ok">Finished. The record is frozen and the surveys have gone out.</div>}
        {ok === "closed-owing" && <div className="banner-ok">Finished — with money still outstanding. The ledger keeps it; the record is frozen.</div>}
        {ok === "reopened" && <div className="banner-ok">Open again.</div>}
        {ok === "cancelled" && <div className="banner-ok">Cancelled. The record is frozen and anything open went with it.</div>}
        {ok === "cancelled-paid" && <div className="banner-ok">Cancelled — and money had already gone out on it. The ledger keeps that.</div>}

        {/* The face, and the gear that holds everything you set ONCE - the
            photo, the scope, and how this job ends (Shahar, 2026-09-11: "move
            the cancel this job into the setting of it"). The screen below is
            only about the job running. */}
        <ProjectSetup projectId={id} url={cover} own={seat.cover_own} canEdit={manages}
          scopeLines={scopeLines} scopeTrades={scopeTrades}
          lifecycle={manages ? (
            <Lifecycle projectId={id} status={seat.status} closed={closedAlready}
              open={openHere.length} liveKids={liveKids} owed={owed} paid={roll?.paid ?? 0}
              superadmin={!!board.me?.is_superadmin} />
          ) : null} />

        <div className="kicker">
          {manages ? "You run this" : seat.seat ?? "Your seat"} · {seat.status}
          {seat.stage ? ` · ${seat.stage}` : ""}
        </div>

        {/* THE NINE. Each says in words what its number counts, and tapping
            one puts its content in the single area below. */}
        <div className="pgrid">
          {offered.map((k) => {
            const on = k === panel;
            switch (k) {
              case "tasks":
                return <Panel key={k} href={panelHref(k)} on={on} n={openHere.length}
                  label={hasKids ? "tasks open on this site" : "tasks still open"}
                  sub={late.length > 0 ? `${late.length} past its date` : "nothing is late"}
                  tone={late.length > 0 ? "late" : undefined} />;
              case "bids":
                return <Panel key={k} href={panelHref(k)} on={on} n={openPkgs.length}
                  label="packages out to bid"
                  sub={packages.length > openPkgs.length ? `${packages.length - openPkgs.length} settled` : "waiting on numbers"} />;
              case "money":
                return <Panel key={k} href={panelHref(k)} on={on} n={money(owed) ?? "$0"}
                  label="owed to the trades"
                  sub={money(roll?.paid) ? `${money(roll?.paid)} paid so far` : "nothing paid yet"} />;
              case "jobs-open":
                return <Panel key={k} href={panelHref(k)} on={on} n={kidOpen.length}
                  label="jobs not started" sub="open, nothing on the board" />;
              case "jobs-working":
                return <Panel key={k} href={panelHref(k)} on={on} n={kidWorking.length}
                  label="jobs being worked" sub="open, with tasks on them" />;
              case "jobs-done":
                return <Panel key={k} href={panelHref(k)} on={on} n={kidDone.length}
                  label="jobs completed"
                  sub={kidEnded.length > 0 ? `${kidEnded.length} cancelled` : "closed and frozen"} />;
              case "week":
                return <Panel key={k} href={panelHref(k)} on={on} n={week?.trades.length ?? 0}
                  label="trades on site this week"
                  sub={week ? `${weekDay(week.from)}–${weekDay(week.to)}` : "this week"} />;
              case "visits": {
                // Today's count, and what came before it - never "last Sep 11"
                // on the eleventh of September.
                const loggedToday = visits.filter((v) => v.on_date === today).length;
                const before = visits.find((v) => v.on_date !== today);
                return <Panel key={k} href={panelHref(k)} on={on} n={loggedToday}
                  label="site visits logged today"
                  sub={loggedToday > 0
                    ? before ? `before that ${shortDate(before.on_date)}` : "the first one here"
                    : before ? `last was ${shortDate(before.on_date)}` : "nobody has logged one"} />;
              }
              default:
                return (
                  <div className="pnl soon" key={k} aria-hidden>
                    <div className="n">—</div>
                    <div className="l">held for what comes next</div>
                  </div>
                );
            }
          })}
        </div>

        {/* ONE ANSWER, belonging to the panel above that is lit. */}
        {panel === "week" && (
          <section className="stack" style={{ gap: 8 }}>
            <div className="divider-label">
              On site this week{week ? ` · ${weekDay(week.from)}–${weekDay(week.to)}` : ""}
            </div>
            <SiteWeekTrades projectId={id} week={week} />
          </section>
        )}

        {panel === "visits" && (
          /* The record of being here: a note, a photo, a voice note; yours to
             correct or remove. Today's is the one you write in; the one before
             it is a line until you open it. */
          <SiteVisits projectId={id} visits={visits} urls={signed}
            canLog={!!board.me?.contact_id} today={today} />
        )}

        {panel === "money" && (
          /* Contracts, milestones, the changes asked for and the ledger - the
             payor's side for whoever runs the site, the payee's for a trade. */
          <section className="stack" style={{ gap: 8 }}>
            <div className="divider-label">Money</div>
            <Card soft pad>
              <div className="stack" style={{ gap: 6 }}>
                <Line label="Contracted" value={money(roll?.contracted) ?? "nothing signed yet"} />
                <Line label="Paid" value={money(roll?.paid) ?? "nothing has gone out"} />
                <Line label="Owed" value={money(owed) ?? "nothing outstanding"} tone={owed > 0 ? "status" : undefined} />
                {(roll?.stages ?? 0) > 0 && (
                  <Line label="Milestones" value={`${roll?.open_stages ?? 0} of ${roll?.stages} still to come`} />
                )}
              </div>
            </Card>
            <Link href={`/project/${id}/money`} className="home-row">
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="t">Open the ledger</span>
                <span className="m" style={{ display: "block" }}>
                  {manages ? "Milestones, approvals, what was paid, changes to decide" : "Your milestones, request a payment, ask for a change"}
                </span>
              </span>
              <ChevronIcon />
            </Link>
          </section>
        )}

        {panel === "bids" && (
          /* The address rule applies here too: a trade invited to bid sees the
             town until they win it. */
          <section className="stack" style={{ gap: 8 }}>
            <div className="divider-label">Bid packages · {packages.length}</div>
            {packages.length === 0 && (
              <Card soft pad><div className="small">Nothing out to bid. Creating a package is step 3 of the build order.</div></Card>
            )}
            {/* A package opens (Shahar: "bid does not allow me to click in") -
                its scope, its bidders, their numbers and the award. */}
            {packages.map((p) => (
              <Link href={`/project/${id}/bids/${p.id}`} className="home-row" key={p.id}>
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="t">{p.category ?? p.trade ?? "Package"}</span>
                  <span className="m" style={{ display: "block" }}>
                    {[
                      p.trade, p.phase,
                      p.n_invited ? `${p.n_received ?? 0} of ${p.n_invited} replied` : null,
                      p.reply_by ? `reply by ${shortDate(p.reply_by)}` : null,
                    ].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className={`tag ${p.status === "awarded" ? "tag-ok" : p.status === "open" ? "tag-status" : "tag-neutral"}`}>
                  {p.status}
                </span>
                <ChevronIcon />
              </Link>
            ))}
            {packages.length > 0 && (
              <p className="tiny text-muted" style={{ margin: 0 }}>
                Invited trades see the <strong>town</strong> until the job is awarded to them — the same rule
                the whole community runs on.
              </p>
            )}
          </section>
        )}

        {panel === "jobs-open" && (
          <section className="stack" style={{ gap: 8 }}>
            <div className="divider-label">Not started · {kidOpen.length}</div>
            {jobRows(kidOpen, "Every job beneath this one has work on it or is closed.")}
          </section>
        )}

        {panel === "jobs-working" && (
          <section className="stack" style={{ gap: 8 }}>
            <div className="divider-label">Being worked · {kidWorking.length}</div>
            {jobRows(kidWorking, "No job beneath this one has an open task on it.")}
          </section>
        )}

        {panel === "jobs-done" && (
          <section className="stack" style={{ gap: 8 }}>
            <div className="divider-label">Completed · {kidDone.length}</div>
            {jobRows(kidDone, "Nothing beneath this one has been finished yet.")}
            {/* Cancelled is not completed, so it is listed rather than counted
                with them - and never hidden. */}
            {kidEnded.length > 0 && (
              <>
                <div className="divider-label" style={{ marginTop: 6 }}>
                  Ended another way · {kidEnded.length}
                </div>
                {jobRows(kidEnded, "")}
              </>
            )}
          </section>
        )}

        {panel === "tasks" && (
          /* THE WORK, IN SECTIONS - never a rolling list. A flat list of
             everything answers no question; what is late, what is this week
             and what is waiting on someone else are three different
             questions, and a person on site is only asking the first two.
             That is the default. Trade, contract and phase are the other
             three ways a build divides up (Shahar) - a tap away, each naming
             what it cannot place rather than hiding it. The sections live in
             lib/board.ts so this screen and /tasks cannot drift apart. */
          <section className="stack" style={{ gap: 14 }}>
            <div className="divider-label">
              {show === "done" ? "Done" : show === "all" ? "All work" : "Open work"} · {shown.length}
            </div>

            {here.length > 3 && <SearchBox placeholder="Find a task on this site" count={query ? found.length : null} />}

            {/* Open / Done / All. Done is a separate read, so it is only paid
                for when it is asked for. */}
            <nav className="chips" aria-label="Which tasks">
              <Chip href={viewHref({ show: undefined })} on={!show} label={`Open · ${openHere.length}`} />
              <Chip href={viewHref({ show: "done" })} on={show === "done"}
                label={wantDone ? `Done · ${doneHere.length}` : "Done"} />
              <Chip href={viewHref({ show: "all" })} on={show === "all"} label="All" />
            </nav>

            {/* How they are arranged. */}
            <nav className="chips" aria-label="Group tasks by">
              {GROUPINGS.map((g) => (
                <Chip key={g.key} href={viewHref({ by: g.key === "timing" ? undefined : g.key })}
                  on={by === g.key} label={g.label} />
              ))}
            </nav>

            {shown.length === 0 && (
              <Card soft pad>
                <div className="small">
                  {show === "done" ? "Nothing finished on this project yet." : "Nothing open on this project."}
                </div>
              </Card>
            )}
            {shown.length > 0 && found.length === 0 && (
              <Card soft pad><div className="small">Nothing matches &ldquo;{query}&rdquo;.</div></Card>
            )}

            {sections.map((b) => (
              <div key={b.key}>
                <div className="bucket">
                  <span className={`h ${b.tone === "status" ? "late" : ""}`}>{b.label}</span>
                  <span className="n">{b.rows.length}{b.late > 0 && b.tone !== "status" ? ` · ${b.late} late` : ""}</span>
                </div>
                <div className="bucket-rows">
                  {b.rows.map((t) => (
                    <Link key={t.id} href={`/task/${t.id}?back=${encodeURIComponent(viewHref({}))}`}>
                      <span className="grow" style={{ minWidth: 0 }}>
                        <span className="t">{t.action}</span>
                        <span className="m">
                          {[
                            // Which job it is on, when that is not this row.
                            t.project_id && t.project_id !== id ? (nameOf.get(t.project_id) ?? t.project) : null,
                            // Whatever the section is not already named after.
                            by === "trade" ? null : t.trade,
                            by === "contract" ? null : t.contract,
                            t.assignee ?? (manages ? "unassigned" : null),
                            t.status !== "Not Started" ? t.status : null,
                          ].filter(Boolean).join(" · ") || "—"}
                        </span>
                      </span>
                      {t.state === "open" && t.priority === "High" && <span className="tag tag-outline" style={{ whiteSpace: "nowrap" }}>High</span>}
                      {t.state === "closed" ? (
                        <span className="tag tag-neutral" style={{ whiteSpace: "nowrap" }}>
                          {t.completed_on ? shortDate(t.completed_on) : "done"}
                        </span>
                      ) : t.target_date ? (
                        <span className={`tag ${t.target_date < today ? "tag-status" : "tag-neutral"}`} style={{ whiteSpace: "nowrap" }}>
                          {shortDate(t.target_date)}
                        </span>
                      ) : null}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}
      </div>
    </Screen>
  );
}

// A panel: a number, the words for what it counts, and a second line that
// says the thing the number leaves out. Tapping it opens it below.
function Panel({ href, on, n, label, sub, tone }: {
  href: string; on: boolean; n: number | string; label: string; sub?: string; tone?: "late";
}) {
  return (
    <Link href={href} aria-current={on ? "page" : undefined} scroll={false}
      className={`pnl ${tone === "late" ? "late" : ""}`}>
      <div className="n">{n}</div>
      <div className="l">{label}</div>
      {sub && <div className={`s ${tone === "late" ? "late" : ""}`}>{sub}</div>}
    </Link>
  );
}

function Line({ label, value, tone }: { label: string; value: string; tone?: "status" }) {
  return (
    <div className="between">
      <span className="small text-muted">{label}</span>
      <span className="small" style={{ fontWeight: 600, color: tone === "status" ? "var(--color-status)" : undefined }}>
        {value}
      </span>
    </div>
  );
}

function Chip({ href, on, label }: { href: string; on: boolean; label: string }) {
  return (
    <Link href={href} aria-current={on ? "page" : undefined}
      className={`tag ${on ? "" : "tag-neutral"}`}
      style={{ textDecoration: "none", padding: "7px 12px", fontSize: 12 }} scroll={false}>
      {label}
    </Link>
  );
}

// HOW THIS JOB ENDS (migrations 069, 070), behind the gear.
//
// Shahar first: "The scope was complete / no place to close it as complete
// from inside?" - there was not; the only door was the portal's Setup tab.
// Then: "move the cancel this job into the setting of it" - so both endings
// sit with the other things you do to a job rather than to the work on it.
//
// The rules are the database's and they are old: complete needs zero open
// tasks anywhere in the family and no live job beneath it; cancelled needs a
// reason and takes the open work down with it; both FREEZE the record. So
// this says which of those is in the way rather than offering a button that
// will be refused.
function Lifecycle({ projectId, status, closed, open, liveKids, owed, paid, superadmin }: {
  projectId: string; status: string; closed: boolean;
  open: number; liveKids: number; owed: number; paid: number; superadmin: boolean;
}) {
  if (closed) {
    return (
      <div className="stack" style={{ gap: 8 }}>
        <Card soft pad>
          <div className="small">
            This job is {status.replace("Closed - ", "").toLowerCase()}. Its tasks, contracts and
            payments are frozen — work that comes back belongs in a new job beneath the property.
          </div>
        </Card>
        {superadmin && (
          <details className="home-panel">
            <summary className="home-row">
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="t">Reopen it</span>
                <span className="m" style={{ display: "block" }}>Superadmin only — it unfreezes everything</span>
              </span>
              <span className="chev"><ChevronIcon /></span>
            </summary>
            <form action={reopenProject.bind(null, projectId)} className="drawer stack" style={{ gap: 8, paddingTop: 12 }}>
              <label className="field" style={{ marginBottom: 0 }}>
                <span className="field-label">Why it is opening again</span>
                <input className="input" name="reason" placeholder="The motor failed again · a bill arrived late" />
              </label>
              <button className="btn btn-secondary btn-block">Reopen this job</button>
            </form>
          </details>
        )}
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <details className="home-panel">
        <summary className="home-row">
          <span className="grow" style={{ minWidth: 0 }}>
            <span className="t">Finish this job</span>
            <span className="m" style={{ display: "block" }}>
              {open > 0 ? `${open} ${open === 1 ? "task is" : "tasks are"} still open`
                : liveKids > 0 ? `${liveKids} ${liveKids === 1 ? "job beneath it is" : "jobs beneath it are"} still open`
                : "Nothing is open — it can close as complete"}
            </span>
          </span>
          <span className="chev"><ChevronIcon /></span>
        </summary>
        <div className="drawer stack" style={{ gap: 8, paddingTop: 12 }}>
          {open > 0 ? (
            <p className="small text-muted" style={{ margin: 0 }}>
              A job closes as complete only when there is nothing left on it — finish or cancel
              {open === 1 ? " that task" : " those tasks"} and this turns into a button.
            </p>
          ) : liveKids > 0 ? (
            <p className="small text-muted" style={{ margin: 0 }}>
              Close {liveKids === 1 ? "the job" : "the jobs"} beneath this one first.
            </p>
          ) : (
            <form action={closeProject.bind(null, projectId)} className="stack" style={{ gap: 8 }}>
              <p className="small text-muted" style={{ margin: 0 }}>
                Closing it freezes the record — tasks, contracts and payments can no longer be
                written — and sends the surveys.
              </p>
              {owed > 0 && (
                <p className="tiny" style={{ color: "var(--color-status)", margin: 0 }}>
                  {money(owed)} is still outstanding. That does not stop you — a finished job with a
                  bill left to pay is normal — but the ledger keeps it after the freeze.
                </p>
              )}
              <label className="field" style={{ marginBottom: 0 }}>
                <span className="field-label">How it ended <span className="text-muted">(optional)</span></span>
                <input className="input" name="note" placeholder="Shade fixed and tested, homeowner happy" />
              </label>
              <button className="btn btn-primary btn-block">Close this job as complete</button>
            </form>
          )}
        </div>
      </details>

      {/* THE OTHER ENDING (migration 070). Complete means the work is done and
          demands nothing be open; cancelled means it will not happen, needs a
          reason, and takes the open work down with it. It is offered whatever
          is open, because open work is the usual reason to cancel. */}
      <details className="home-panel">
        <summary className="home-row">
          <span className="grow" style={{ minWidth: 0 }}>
            <span className="t">Cancel this job</span>
            <span className="m" style={{ display: "block" }}>
              The work will not happen{open > 0
                ? ` — ${open} open ${open === 1 ? "task goes" : "tasks go"} with it`
                : ""}
            </span>
          </span>
          <span className="chev"><ChevronIcon /></span>
        </summary>
        <form action={cancelProject.bind(null, projectId)} className="drawer stack" style={{ gap: 8, paddingTop: 12 }}>
          <p className="tiny text-muted" style={{ margin: 0 }}>
            Anything still open is cancelled with it and carries your reason, so a task read a year
            from now says why it stopped. The record freezes either way.
          </p>
          {paid > 0 && (
            <p className="tiny" style={{ color: "var(--color-status)", margin: 0 }}>
              {money(paid)} has already been paid on this job. Cancelling does not unpay it.
            </p>
          )}
          <label className="field" style={{ marginBottom: 0 }}>
            <span className="field-label">Why it is being cancelled <span className="text-muted">(required)</span></span>
            <input className="input" name="reason" required minLength={4}
              placeholder="Homeowner changed their mind · replaced under warranty" />
          </label>
          <button className="btn btn-secondary btn-block btn-danger">Cancel this job</button>
        </form>
      </details>
    </div>
  );
}
