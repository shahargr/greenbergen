import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";
import { shortDate } from "@shared/format";
import { stopwatch } from "@shared/perf";
import { AppBar, Card, ChevronIcon, Notice, Screen } from "@shared/ui";
import { TradeIllustration } from "@shared/Illustrations";
import { MapLink } from "@shared/MapLink";
import { GROUPINGS, buildTree, coverUrls, faceUrl, flat, getBoard, groupWork, money, nest, oneList, openBeneath, readMoney, runs, seatLabel, topLevels, urgencyOf, type Group, type GroupKey, type ListRow, type Node, type Seat, type Task, type TaskMoney, type Twig } from "@/lib/board";
import { DuePill, HighPill, UrgencyKey, rowClass } from "@/components/TaskRowBits";
import { lensOf, lensesFor, readLens, type Lens, type PanelKey } from "@/lib/lens";
import { PropertyCard } from "@/components/PropertyCard";
import { ProjectTypeIcon } from "@/components/ProjectTypeIcon";
import { QuickActions } from "@/components/QuickActions";
import { SearchBox } from "@/components/SearchBox";
import { TaskTable } from "@/components/TaskTable";
import { TradeSpine, type Spine } from "@/components/TradeSpine";
import type { PanelPrefs } from "@/components/Panels";
import { matchesQuery } from "@/lib/search";
import { ProjectSetup } from "./ProjectSetup";
import { SiteVisits, type Visit } from "./SiteVisits";
import { SiteWeekTrades, weekDay, type SiteWeek } from "./SiteWeek";
// Cancelling was greyed out for everybody on 2026-09-13 ("this is too
// risky"). It is back on 2026-09-14 - "as the owner of a project, I need to
// be able to cancel and archive it" - for the OWNER only; a site manager
// still sees the greyed row. The database has always allowed rank 50 here;
// the screen being stricter than the database is the safe direction.
import { archiveProject, cancelProject, closeProject, reopenProject } from "./actions";

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
// 9th panel as a place holder for now"). The KEYS live in lib/lens.ts, with
// the lens that decides which of them a person is offered and in what order.

export default async function ProjectPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; q?: string; by?: string; show?: string; panel?: string; as?: string; who?: string; setup?: string }>;
}) {
  const { id } = await params;
  const { ok, error, q, by: byRaw, show, panel: panelRaw, as: asRaw, who, setup: setupQ } = await searchParams;
  // TRADE IS THE DEFAULT ARRANGEMENT NOW. Shahar (2026-09-13), looking at
  // one bucket holding almost everything: "where there are tasks open, club
  // them by trade. anything you don't know club under the owner." Timing is
  // still the first chip - late and this week are the day's question - but a
  // site with 250 open tasks answers "what is going on here" by trade.
  const by: GroupKey = GROUPINGS.some((g) => g.key === byRaw) ? (byRaw as GroupKey) : "trade";
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
  const [board, { data: pkgData }, { data: rollupData }, { data: scopeData }, { data: weekData }, { data: visitData }, { data: moneyData }, { data: spineData }, { data: prefsData }] = await Promise.all([
    w.step("board", () => getBoard({ closed: wantDone ? 500 : 0 })),
    w.step("bids", () => rpc<BidPackage[]>(supabase, "portal_bid_packages", { p_project: id })),
    w.step("finance", () => rpc<Rollup>(supabase, "portal_finance_rollup", { p_project_id: id })),
    w.step("scope", () => rpc<ScopeTrade[]>(supabase, "portal_scope_trades", { p_project: id })),
    // Who is on site this week, and the record of who has been (migration 068).
    w.step("week", () => rpc<SiteWeek>(supabase, "portal_site_week", { p_project: id })),
    w.step("visits", () => rpc<Visit[]>(supabase, "portal_site_visits", { p_project: id, p_limit: 20 })),
    // What every task on this site and beneath it has cost and still owes
    // (migration 078) - one read for the whole family, so a category can
    // carry its money without a query per task. Only the work panel needs
    // it, and which panel that is cannot be settled until the seat is read.
    // The week panel needs it too - that is where a working lens offers "log
    // a payment", and the offer must not appear for somebody the database
    // would refuse.
    // Every panel now: the QuickActions panel at the top offers "Log
    // payment" only to somebody the database would let, whichever panel
    // is open beneath it (2026-09-17).
    w.step("taskMoney", () => rpc<TaskMoney>(supabase, "portal_task_money", { p_project: id })),
    // THE SPINE: this job as its trades, in build order, across the whole
    // family beneath it (migration 139). It is one read rather than a
    // grouping done here, because it also has to answer what the job NEEDS
    // and has not started - which no list of tasks can say.
    w.step("spine", () => rpc<Spine>(supabase, "portal_project_trades", { p_project: id })),
    // Which panels this person pulled up or folded away here (migration 173).
    w.step("prefs", () => rpc<PanelPrefs>(supabase, "portal_panel_prefs", { p_project: id })),
  ]);
  if (!board.signed_in) redirect(`/login?next=/project/${id}`);
  const prefs: PanelPrefs = prefsData && Array.isArray(prefsData.shown)
    ? prefsData : { shown: [], hidden: [] };

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
  // Open work at or beneath each of them. Counting the rows ON a child is
  // what made 55 Walnut - a live house with a hundred and fifty open tasks on
  // the jobs under it - read as "not started" (Shahar's screenshot).
  const openByProject = openBeneath(board.seats, board.tasks);

  // The day this site is having, not the day UTC is having: a visit logged at
  // eight in the evening in Bergen County is still today's visit.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const packages = pkgData ?? [];
  const roll = rollupData ?? null;
  const owed = roll?.owed ?? seat.owed ?? 0;
  const scopeLines = (scopeData ?? []).reduce((n, t) => n + t.scope_lines, 0);
  const scopeTrades = (scopeData ?? []).filter((t) => t.chosen).length;
  const week = (weekData ?? null) as SiteWeek | null;
  const spine: Spine = spineData && Array.isArray(spineData.trades)
    ? spineData : { trades: [], untagged: { open: 0, late: 0 } };
  const visits = Array.isArray(visitData) ? visitData : [];
  const closedAlready = seat.status.startsWith("Closed");
  const onSite = !!seat.address;

  // A FOLDER, NOT A SITE.
  //
  // Shahar (2026-09-11), looking at Green Bergen Development wearing the site
  // panels: "top level should show different view, higher one on projects
  // only. design and deploy a view that shows at a higher level the project
  // under it (only its children)."
  //
  // He is right that the nine panels ask questions a development cannot
  // answer - "trades on site this week" of a thing that is not a place, "open
  // tasks on this site" of four sites at once. A development holds
  // PROPERTIES, and the only useful thing to say about it is how each of them
  // is doing. So it gets the portfolio instead, and nothing else.
  const folderTree = !onSite && kids.length > 0
    ? buildTree(board.seats, board.tasks, board.me?.contact_id ?? null) : [];
  const findNode = (ns: Node[]): Node | null => {
    for (const n of ns) {
      if (n.seat.project_id === id) return n;
      const found = findNode(n.children);
      if (found) return found;
    }
    return null;
  };
  const node = folderTree.length > 0 ? findNode(folderTree) : null;
  const isFolder = !!node;
  const childNodes = node?.children ?? [];
  const liveNodes = childNodes.filter((n) => !n.seat.status.startsWith("Closed"));
  const doneNodes = childNodes.filter((n) => n.seat.status.startsWith("Closed"));
  // What its children ARE, said in the right word: a development holds
  // addresses, anything else holds work.
  const childWord = liveNodes.every((n) => n.seat.address) ? "Properties" : "Projects";

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

  // TODAY AND TOMORROW, and what is due inside this week.
  //
  // "Due" is the only schedule this database holds. Migration 081 laid the
  // spine for a real one - activities, links, gates, computed dates - and
  // nothing writes to it yet, so a screen drawing bars off it would be
  // drawing fiction. Dates on tasks are real and are what people set.
  const todayISO = today;
  const dayAfter = (iso: string, n: number) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const tomorrowISO = dayAfter(todayISO, 1);
  // ONE PANEL, SIX ROWS. Shahar (2026-09-14): "change to one panel with the
  // first 6 tasks, and option to click show all tasks."
  //
  // It was two columns, Today beside Tomorrow, four rows each and a "+17
  // more" that went nowhere. Two narrow columns on a phone means every task
  // name clips at three words, and the thing you actually wanted - the whole
  // list - was not reachable from here at all. One column, full width, the
  // six soonest, and a way through to all of them.
  //
  // Today carries everything still open that was due today OR EARLIER: a task
  // that slipped is on today's plate, not filed under the day it was missed.
  const soon = openHere
    .filter((t) => !!t.target_date && t.target_date <= tomorrowISO)
    .sort((a, b) => (a.target_date ?? "").localeCompare(b.target_date ?? "")
      || a.action.localeCompare(b.action));
  // The PROPERTY this project sits under - the same key /tasks groups by, so
  // "Show all tasks" lands on the right group.
  const topHere = topLevels(board.seats).map.get(id)?.project_id ?? id;
  // What this week owes, which is what the panel counts. The week runs from
  // portal_site_week's own window when there is one, so the panel and the
  // list under it cannot disagree about where the week starts.
  const weekTo = week?.to ?? dayAfter(todayISO, 6);
  const dueThisWeek = openHere.filter((t) => !!t.target_date && t.target_date <= weekTo);

  // WHO IS ACTUALLY ON SITE. Shahar (2026-09-14): "under today / tomorrow,
  // list all trades currently working on site. clicking on each will show all
  // the pending items for them."
  //
  // "Currently working" is whoever has been ON here this week - days_on_site
  // is counted from their check-ins, so it is attendance, not intention. When
  // nobody has checked in at all the section would be empty and useless, so it
  // falls back to the trades that owe work this week: still an answer to "who
  // is on this job", just a planned one rather than an observed one.
  const artOf = new Map<string, string | null>();
  for (const t of here) if (t.trade && !artOf.has(t.trade)) artOf.set(t.trade, t.trade_art);
  const attended = (week?.trades ?? []).filter((t) => t.days_on_site > 0);
  const siteTrades = (attended.length > 0
    ? attended
    : (week?.trades ?? []).filter((t) => t.due_this_week > 0 || t.late > 0))
    .slice()
    .sort((a, b) => (b.late - a.late) || (b.days_on_site - a.days_on_site)
      || (b.due_this_week - a.due_this_week) || a.trade.localeCompare(b.trade));
  const observed = attended.length > 0;
  // What is YOURS on this site - the number a trade means by "my work".
  const myOpen = board.me?.contact_id
    ? openHere.filter((t) => t.assignee_id === board.me!.contact_id).length : 0;

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

  // WHERE YOU STAND ON THIS PROJECT, and what that makes the screen look like
  // (Shahar, 2026-09-13: "When i'm a GC I need to be able to quickly see the
  // GC view on the project... allow me to log in as GC / Professional / home
  // owner / investor / viewer").
  //
  // portal_my_work already carries the seat and its authority rank, so the
  // lens costs no read. It changes the ORDER and the SET of panels and where
  // the screen opens - never what the database will hand over, which is why
  // it is safe to let anybody look down their own ladder. See lib/lens.ts.
  const actualLens = lensOf(seat.seat, seat.rank);
  const lenses = lensesFor(actualLens, !!board.me?.is_superadmin);
  const lens = readLens(asRaw, lenses, actualLens);
  const asParam = lens.key === actualLens ? undefined : lens.key;

  // What this project HAS, crossed with what this lens shows. A development
  // has no address, so no site and no week; a job with nothing beneath it has
  // no jobs to count.
  const possible = new Set<PanelKey>([
    "tasks", "bids", "money",
    ...(hasKids ? (["jobs-open", "jobs-working", "jobs-done"] as PanelKey[]) : []),
    ...(onSite ? (["week", "visits"] as PanelKey[]) : []),
    "soon",
  ]);
  const offered: PanelKey[] = lens.panels.filter((k) => possible.has(k));
  const wanted = (panelRaw ?? "") as PanelKey;
  // Where the lens opens, if this project has that panel at all - a trade
  // lands on the week, an investor on the money, and neither has to hunt.
  const fallback: PanelKey = offered.includes(lens.first)
    ? lens.first
    : offered.find((k) => k !== "soon") ?? "tasks";
  const panel: PanelKey = offered.includes(wanted) && wanted !== "soon" ? wanted : fallback;

  // Which tasks this view is about. Done is fetched only when asked for, so
  // the Open view costs exactly what it did before.
  const pool = panel !== "tasks" ? openHere
    : show === "done" ? doneHere : show === "all" ? here : openHere;
  // MINE, on a lens that came here to work. Shahar (2026-09-13): "the
  // contractor needs a view on the project - from this week tasks". A trade
  // standing on a site with two hundred and fifty tasks on it means their
  // own, and the Professional lens says so by default; one tap widens it.
  // Nothing is hidden - the count of everyone's work is on the chip beside it.
  const canSplit = !!board.me?.contact_id && myOpen > 0 && myOpen < openHere.length;
  const onlyMine = canSplit && (who ? who === "mine" : lens.key === "pro");
  const shown = onlyMine ? pool.filter((t) => t.assignee_id === board.me!.contact_id) : pool;
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
  //
  // Timing is ONE list (Shahar, 2026-09-17: "one panel, with different
  // colors based on their importance and urgency"): late first, nested,
  // with the urgency on the row rather than on a heading - see oneList.
  // The other three NEST and carry their money (Shahar, 2026-09-13: "build
  // hierarchy so i can see everything Frame related... and under each
  // category allow me to log a payment") - see groupWork.
  const taskMoney = readMoney(moneyData);
  const listed = panel === "tasks" && by === "timing" ? oneList(found) : [];
  const groups = panel === "tasks" && by !== "timing" ? groupWork(found, by, taskMoney) : [];

  // Links that keep the rest of the view: changing the panel must not throw
  // away nothing, but changing the grouping must not throw away the search.
  const viewHref = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged: Record<string, string | undefined> = {
      panel: panel === fallback ? undefined : panel,
      q: query || undefined, by: by === "trade" ? undefined : by, show: show || undefined,
      as: asParam, who: who || undefined,
      ...over,
    };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/project/${id}?${s}` : `/project/${id}`;
  };
  // Moving to another panel drops the task view's own state - a search for
  // "jimmy" has no meaning on the money panel, and carrying it there only
  // makes the back button lie. The lens is not view state, it is who you are
  // standing as, so it survives every hop on this screen.
  // The set-up panel is opened by the gear on the name, as a query flag
  // rather than client state - the same way the task screen's gear works, and
  // the only way a server-rendered panel can be opened from the app bar.
  const setupOpen = setupQ === "1";
  const keepAs = (extra = "") => {
    const p = new URLSearchParams(extra);
    if (asParam) p.set("as", asParam);
    const s = p.toString();
    return s ? `/project/${id}?${s}` : `/project/${id}`;
  };
  const panelHref = (k: PanelKey) => k === fallback ? keepAs() : keepAs(`panel=${k}`);
  // Where "Show all tasks" goes: the /tasks screen, which is already the
  // window Shahar asked for - its own page, a back arrow, and whose / late /
  // high / search across the top - scoped to this property and told where to
  // come back to.
  const allTasksHref = `/tasks?project=${topHere}&back=${encodeURIComponent(keepAs(`/project/${id}`))}`;
  // Switching lens starts the view again from that lens's own first panel -
  // carrying "panel=bids" into the Professional lens, which has no bids,
  // would land on a panel that is not there.
  const lensHref = (l: Lens) => l.key === actualLens ? `/project/${id}` : `/project/${id}?as=${l.key}`;

  // "under each category allow me to log a payment" (Shahar, 2026-09-13).
  // A payment hangs off a TASK - that is where the receipt belongs and where
  // anybody looks for it - so a category's payment row opens the category's
  // own tasks to choose from, with the money fields already there.
  const payHref = (g: Group) => {
    const p = new URLSearchParams({ back: viewHref({}) });
    if (g.trade) p.set("trade", g.trade);
    // An owner category is "no trade, held by this person", and its payment
    // screen must shortlist exactly that - not every untagged task on site.
    else if (g.owner) p.set("owner", g.owner);
    else if (g.phase) p.set("phase", g.phase);
    else p.set("untagged", "1");
    return `/project/${id}/pay?${p.toString()}`;
  };

  // A TRADE TILE IS A DOOR. The trade's own screen already exists and already
  // carries its work, its contracts and its money, so the tile goes there
  // rather than unfolding a tenth accordion in place.
  const tradeHref = (g: Group) => `/project/${id}/trade/${encodeURIComponent(g.trade!)}`;

  // ONE TASK, one row - written once and used by both arrangements, so the
  // flat buckets and the nested categories cannot drift apart.
  //
  // `depth` is how far under a parent it sits (nest(), lib/board). A step of
  // a blueprint is not a sibling of the thing it is a step of, and rendering
  // it as one is what made the generator's list unreadable: twelve steps of
  // "Hire the generator installer" scattered through the list, in alphabetical
  // order, with their own parent buried among them.
  //
  // `r` is the row as oneList coloured it; a nested arrangement hands only
  // the task and the depth, and the row colours itself the same way.
  const taskRow = (t: (typeof board.tasks)[number], depth = 0, r?: ListRow) => {
    const m = taskMoney.tasks[t.id];
    const urgency = r?.urgency ?? urgencyOf(t);
    return (
      <Link key={t.id} href={`/task/${t.id}?back=${encodeURIComponent(viewHref({}))}`}
        className={rowClass(t, depth, urgency)}>
        <span className="grow" style={{ minWidth: 0 }}>
          <span className="t">{t.action}</span>
          <span className="m">
            {[
              // Which job it is on, when that is not this row.
              t.project_id && t.project_id !== id ? (nameOf.get(t.project_id) ?? t.project) : null,
              // What is under it. A parent with steps says how many are left,
              // so a folded-looking row is never mistaken for a single task.
              t.open_children > 0
                ? `${t.open_children} step${t.open_children === 1 ? "" : "s"} left`
                : null,
              // A step names its parent only when it is not drawn under it -
              // the rail already says so where there is one.
              depth === 0 && t.parent_title ? `part of ${t.parent_title}` : null,
              // Whatever the section is not already named after.
              by === "trade" || by === "phase" ? null : t.trade,
              by === "contract" ? null : t.contract,
              // An assistant is a holder, said as one - it used to read
              // "unassigned" (migration 079).
              t.assignee
                ? (t.assignee_kind === "assistant" ? `${t.assignee} · assistant` : t.assignee)
                : (manages ? "nobody holds this" : null),
              t.status !== "Not Started" ? t.status : null,
            ].filter(Boolean).join(" · ") || "—"}
          </span>
        </span>
        {/* A receipt still to pay is the loudest thing a task can carry. */}
        {m && m.owed > 0 && (
          <span className="tag tag-status" style={{ whiteSpace: "nowrap" }}>{money(m.owed)} to pay</span>
        )}
        {m && m.owed === 0 && m.spent > 0 && (
          <span className="tag tag-neutral" style={{ whiteSpace: "nowrap" }}>{money(m.spent)}</span>
        )}
        <HighPill t={t} />
        <DuePill t={t} urgency={urgency} inherited={r?.inherited} soonest={r?.soonest} />
      </Link>
    );
  };

  // EVERY PANEL, WITH WHAT IT COUNTS AND WHETHER IT COUNTS ANYTHING.
  // Built as data so the grid can drop the empty ones and the line beneath
  // can name them, without the two lists being written twice (Shahar,
  // 2026-09-13: "where there is 0 tasks open, you can hide the panels").
  //
  // `quiet` is what the line calls it - a noun, not a count, because the
  // count is the thing that is missing.
  const visitsToday = visits.filter((v) => v.on_date === today).length;
  // THE PANEL DEFINITIONS ARE GONE with the grid that drew them. `panel`
  // still decides which single answer the content area below shows - the
  // week, the work, the money, the bids, the jobs, the visits - it is just
  // reached from the sections above now rather than from a wall of counts.
  // NO PANEL GRID. Shahar (2026-09-14) replaced it piece by piece: the week's
  // trades became the tile row above, "log task" became the Add task button,
  // and then "remove the also from here" took the quiet line that carried the
  // rest. What is left of PANELS is what the CONTENT AREA below still keys
  // off - `panel` decides which one answer this screen is showing - so the
  // record stays even though nothing draws a grid of it any more.

  // One signed-URL round trip for everything hanging off the visits and for
  // the child jobs' faces - they all live in the same private bucket.
  //
  // THIS PROJECT'S OWN COVER IS NO LONGER IN THAT LIST. Shahar (2026-09-15):
  // "Remove the photo to reduce traffic." It was signed and fetched on every
  // open of every project screen to show a 150px band that said what the type
  // icon now says for nothing. The photo itself is not gone - it is still the
  // project's face on the board, and still changed from behind the gear.
  const visitPaths = panel === "visits" ? visits.flatMap((v) => v.files.map((f) => f.path)) : [];
  const signed = await w.step("media", () => coverUrls(supabase, [...visitPaths, ...kids.map((k) => k.cover)]));
  // WHEN THIS HOUSE SELLS (migration 162): the two planned days live on the
  // PROPERTY - the top of its family - and the loans beneath count backwards
  // from them. Read only there, only for whoever may set them.
  const isProperty = onSite && !isFolder && topHere === id;
  const { data: saleData } = isProperty && manages
    ? await w.step("sale", () => rpc<{ good: string | null; bad: string | null }[]>(supabase, "project_sale_targets", { p_project: id }))
    : { data: null };
  const sale = isProperty && manages
    ? { good: saleData?.[0]?.good ?? null, bad: saleData?.[0]?.bad ?? null }
    : null;
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
      {/* THE SEAT, BY THE NAME. Shahar (2026-09-14): "viewing as should be
          changed to seat, and drop down with all options. top right above the
          photo, by the project name."

          It was six chips wrapping to three rows under the photo - a control
          you touch once a week taking more room than the photo it sat under.
          Up here it is one word, and the list is behind it. */}
      {/* THE GEAR SITS ON THE NAME. Shahar (2026-09-15): "Place the gear
          button next to the Project name." It was floating on the corner of
          the photograph, which has gone. A link carrying ?setup=1 rather than
          client state, the way the task screen's gear already works - and the
          address has come out of the sub line, because it is now said once,
          properly, in the head row below. */}
      <AppBar back={parent ? `/project/${parent}` : "/"}
        title={
          <span className="row" style={{ gap: 6, alignItems: "center", minWidth: 0 }}>
            <span className="grow" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
              {seat.project_name}
            </span>
            {manages && (
              <Link href={setupOpen ? keepAs() : keepAs("setup=1")} scroll={false}
                className={`name-gear${setupOpen ? " on" : ""}`} aria-label="Set this project up"
                title="Set this project up — the photo, the scope, and how it ends">
                <GearIcon />
              </Link>
            )}
          </span>
        }
        right={!isFolder && lenses.length > 1 ? (
          <details className="seat-pop">
            <summary className="seat-chip" aria-label={`Seat: ${lens.label}`} title="Change seat">
              <span className="k">Seat</span>
              <span className="v">{lens.label}</span>
              <span className="chev"><ChevronIcon /></span>
            </summary>
            <div className="seat-menu">
              <div className="seat-menu-label">See this project as</div>
              {lenses.map((l) => (
                <Link key={l.key} href={lensHref(l)} scroll={false}
                  className={`seat-menu-row${l.key === lens.key ? " on" : ""}`}>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="t">{l.label}{l.key === actualLens ? " · you" : ""}</span>
                    <span className="m">{l.full}</span>
                  </span>
                </Link>
              ))}
              <p className="seat-menu-foot">
                This only changes what the screen puts first — never what you are allowed to see.
              </p>
            </div>
          </details>
        ) : undefined} />
      <div className="body">
        {error && <Notice kind="error">{error}</Notice>}
        {ok === "visit" && <div className="banner-ok">Logged. You&apos;re on that day&apos;s roster.</div>}
        {ok === "visit-edit" && <div className="banner-ok">Changed.</div>}
        {ok === "visit-gone" && <div className="banner-ok">Removed. Anything you attached stays on the project.</div>}
        {ok === "closed" && <div className="banner-ok">Finished. The record is frozen and the surveys have gone out.</div>}
        {ok === "closed-owing" && <div className="banner-ok">Finished — with money still outstanding. The ledger keeps it; the record is frozen.</div>}
        {ok === "reopened" && <div className="banner-ok">Open again.</div>}
        {ok === "cancelled" && <div className="banner-ok">Cancelled. The record is frozen and anything open went with it.</div>}
        {ok === "archived" && <div className="banner-ok">Put away. It is off your board — nothing was deleted.</div>}
        {ok === "unarchived" && <div className="banner-ok">Back on your board.</div>}

        {/* Opened by its link rather than found on the board, because the
            owner put it away. Say so, or the empty screen reads as a bug. */}
        {seat.archived && (
          <Notice kind="info" title="This job is put away.">
            It is off your board and nothing was deleted. Bring it back from the ending panel below.
          </Notice>
        )}
        {ok === "cancelled-paid" && <div className="banner-ok">Cancelled — and money had already gone out on it. The ledger keeps that.</div>}

        {/* THE DAY'S WORK, AT THE TOP. Shahar (2026-09-17): "replace this
            panel with new panel, allowing to perform the most repeatable
            tasks in a project: daily site visit, order something, todo
            and/take note." The band that stood here (2026-09-15: the type
            icon, "You run this · In Progress · Active", the address) said
            what you knew and did nothing; its line is kept as the caption
            and the panel under it does the day: site visit, to-do, order,
            note, phone book - and for whoever runs the job, a full task, a
            payment, an award. A folder (a development) has no site and no
            notebook to speak of, so it keeps the quiet band. */}
        {isFolder ? (
          <div className="proj-head">
            <ProjectTypeIcon seat={seat} hasChildren={kids.length > 0} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="what">
                {[manages ? "You run this" : seatLabel(seat) ?? "Your seat", seat.status, seat.stage].filter(Boolean).join(" · ")}
              </div>
              <div className="where">
                {seat.address
                  ? <MapLink address={seat.address} className="nav">{seat.address}</MapLink>
                  : (seat.parent_name ?? "No address on this job")}
              </div>
            </div>
          </div>
        ) : (
          <QuickActions
            standing={[manages ? "You run this" : seatLabel(seat) ?? "Your seat", seat.status, seat.stage].filter(Boolean).join(" · ")}
            where={seat.address ?? seat.parent_name ?? null}
            address={seat.address ?? null}
            visitHref={offered.includes("visits") ? panelHref("visits") : null}
            visitsToday={visitsToday}
            tidyHref={manages ? `/project/${id}/tidy?back=${encodeURIComponent(keepAs(`/project/${id}`))}` : null}
            tidyCount={spine.untagged.open}
            addTaskHref={lens.rank >= 30
              ? `/project/${id}/task/new?back=${encodeURIComponent(keepAs(`/project/${id}`))}` : null}
            payHref={taskMoney.can_log ? `/project/${id}/pay?back=${encodeURIComponent(keepAs())}` : null}
            awardHref={manages ? `/project/${id}/award?back=${encodeURIComponent(keepAs(`/project/${id}`))}` : null} />
        )}

        {/* Everything you set ONCE - the photo, the scope, and how this job
            ends (Shahar, 2026-09-11: "move the cancel this job into the
            setting of it"). Behind the gear on the name; the screen below is
            only about the job running. */}
        <ProjectSetup projectId={id} own={seat.cover_own} stock={!!seat.cover_url} canEdit={manages}
          open={setupOpen} closeHref={keepAs()}
          scopeLines={scopeLines} scopeTrades={scopeTrades} sale={sale}
          lifecycle={manages ? (
            <Lifecycle projectId={id} status={seat.status} closed={closedAlready}
              owns={seat.rank >= 70} archived={seat.archived}
              open={openHere.length} liveKids={liveKids} owed={owed} paid={roll?.paid ?? 0}
              superadmin={!!board.me?.is_superadmin} />
          ) : null} />

        {/* VIEWING AS. Shahar (2026-09-13): "allow me to log in as GC /
            Professional / home owner / investor / viewer. This currently does
            not work."

            It changes the SHAPE of this screen and nothing else: which panels
            you are offered, in what order, and where it opens. Every read
            under it still goes through the same database gates, so a lens can
            never show you something your seat does not already reach - which
            is exactly why looking down your own ladder is safe, and how you
            check what your trades are actually looking at. */}
        {/* TODAY AND TOMORROW, under the picture. Shahar (2026-09-14):
            "below, image, show today + tomorrow schedule."

            It is built from what tasks are DUE, because that is the only
            schedule this database actually holds - migration 081 laid the
            spine for a real one (activities, gates, computed dates) but
            nothing writes to it yet. Saying "nothing due" is true; drawing an
            empty Gantt would not be. */}
        {/* THE TRADES, IN BUILD ORDER — the spine of the screen.
            Shahar (2026-09-15): "when I land on task, I see a long list of
            tasks. Instead of that, I would like to start by seeing all the
            trades, the panels for all the different trades and what is
            currently being worked on... I want you to know how the trades are
            sequenced on a project."

            It goes ABOVE today and tomorrow because it is the question you
            are actually asking when you open a job — what stage is this house
            at, and who is on it — and the two days are the detail inside
            that. A trade with nothing open does not take a panel; it appears
            as a chip with one move on it, which is the other half of what he
            asked for ("you need to start an engagement"). */}
        {!isFolder && (
          <TradeSpine projectId={id} spine={spine} manages={manages} mode="panels" prefs={prefs}
            back={keepAs(`/project/${id}`)} allTasksHref={allTasksHref} />
        )}

        {!isFolder && (
          <section className="next-up">
            <div className="head">
              <span className="when">Today and tomorrow</span>
              <span className="date">{weekDay(todayISO)} · {weekDay(tomorrowISO)}</span>
            </div>
            {/* THE SAME TABLE THE TASK LIST USES. Shahar (2026-09-15): "when
                you show the tasks open, show in table format. assigned to,
                name, stage, comment, target end date." This panel used to say
                "today" or "tomorrow" where the date goes and nothing at all
                about stage or the latest word on the task - so a job you were
                standing in front of told you less than the list one tap away.
                One component now, so the two cannot drift apart again. */}
            {soon.length === 0
              ? <p className="none">Nothing due today or tomorrow.</p>
              : <TaskTable rows={flat(soon.slice(0, 6))} back={keepAs(`/project/${id}`)} />}
            {/* THE WHOLE LIST, ON ITS OWN SCREEN. "all tasks should be a new
                window, with a back, or filter" - which /tasks already is: a
                back to the board, whose / late / high, and a search. Scoped
                to this property, because that is where you were standing. */}
            <Link href={allTasksHref} className="all-tasks">
              <span>Show all tasks</span>
              <span className="n">{openHere.length}</span>
            </Link>
          </section>
        )}

        {/* A DEVELOPMENT: ONLY WHAT IS UNDER IT (Shahar, 2026-09-11).
            Three roll-ups across the whole portfolio, then one card per
            property with its own face and its own numbers. Every number here
            is the family's, rolled up by buildTree - a house with its work on
            the jobs beneath it reads as busy, which it is. */}
        {isFolder ? (
          <>
            <div className="pgrid">
              <Panel n={liveNodes.length}
                label={childWord === "Properties"
                  ? liveNodes.length === 1 ? "property under way" : "properties under way"
                  : liveNodes.length === 1 ? "project under way" : "projects under way"}
                sub={doneNodes.length > 0 ? `${doneNodes.length} finished` : "none finished yet"} />
              <Panel n={node?.open ?? 0} label="open tasks across them all"
                sub={late.length > 0 ? `${late.length} past its date` : "nothing is late"}
                tone={late.length > 0 ? "late" : undefined} />
              <Panel n={money(node?.owed) ?? "$0"} label="owed to the trades"
                sub={(node?.count ?? 0) > 0 ? `${node?.count} project${node?.count === 1 ? "" : "s"} in all` : "nothing beneath yet"} />
            </div>

            <section className="stack" style={{ gap: 10 }}>
              <div className="divider-label">{childWord} · {liveNodes.length}</div>
              {liveNodes.length === 0 && (
                <Card soft pad><div className="small">Nothing is under way here. Everything beneath this one is finished.</div></Card>
              )}
              {liveNodes.map((n) => (
                <PropertyCard key={n.seat.project_id} node={n} url={faceUrl(n.seat, signed)} />
              ))}
            </section>

            {/* The finished ones stay reachable without taking the space of a
                card - they are a filing cabinet, not the work. */}
            {doneNodes.length > 0 && (
              <section className="stack" style={{ gap: 6 }}>
                <div className="divider-label">Finished · {doneNodes.length}</div>
                {doneNodes.map((n) => (
                  <Link href={`/project/${n.seat.project_id}`} className="home-row" key={n.seat.project_id}>
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="t">{n.seat.project_name}</span>
                      <span className="m" style={{ display: "block" }}>
                        {[n.seat.address, n.seat.status.replace("Closed - ", "")].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <ChevronIcon />
                  </Link>
                ))}
              </section>
            )}
          </>
        ) : (
          <>
        {/* THE PANELS THAT HAVE SOMETHING TO SAY.
            Shahar (2026-09-13): "where there is 0 tasks open, you can hide
            the panels."

            A panel reading zero is a tile of screen spent saying nothing -
            four of the nine on 55 Walnut. They come out of the grid and go
            into one quiet line beneath it, so the route to them survives:
            hiding a panel outright would mean the only way to reach the bid
            book on a site with no open package is to guess the URL. The one
            you are looking at always stays, whatever it counts. */}
        {/* ON SITE NOW, and what each of them still owes. Tapping a trade
            opens its own screen - every pending item it holds, its contracts
            and its money - which is what "show all the pending items for
            them" already means here. */}
        {/* WHO HAS ACTUALLY BEEN HERE THIS WEEK. This is attendance - counted
            from check-ins - which is a different fact from the spine above,
            and the only one that answers "did the plumber turn up". It used to
            fall back to whoever OWED work this week when nobody had checked
            in, which made it a weaker copy of the spine; now that the spine
            leads the screen, this row only appears when it has something the
            spine does not say. */}
        {observed && siteTrades.length > 0 && (
          <section className="stack" style={{ gap: 8 }}>
            <div className="divider-label" style={{ padding: 0 }}>
              On site this week · {siteTrades.length}
            </div>
            <div className="trade-grid">
              {siteTrades.map((t) => (
                <Link key={t.trade} href={`/project/${id}/trade/${encodeURIComponent(t.trade)}`}
                  className="trade-tile">
                  <span className="art" aria-hidden><TradeIllustration name={artOf.get(t.trade) ?? null} /></span>
                  <span className="t">{t.trade}</span>
                  <span className="n">
                    {observed && t.days_on_site > 0
                      ? `${t.days_on_site} ${t.days_on_site === 1 ? "day" : "days"} on site`
                      : `${t.open} open`}
                  </span>
                  {t.late > 0 && <span className="late">{t.late} late</span>}
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* ADD TASK, SITE VISIT AND AWARD WORK (Shahar, 2026-09-14: "add Add
            task and Search window" / "need quick access to site visit"; "as
            a GC i'd like to award business") moved up into the QuickActions
            panel at the top of the screen (2026-09-17), beside to-do, order,
            note and the phone book. One panel, not a band and a row. */}

        {/* The search lives up here now, not buried above the list, because
            with 129 open tasks it is how most people find one. */}
        {here.length > 3 && (
          <SearchBox placeholder="Search tasks on this site" count={query ? found.length : null} />
        )}

        {/* ONE ANSWER, belonging to the panel above that is lit. */}
        {panel === "week" && (
          <section className="stack" style={{ gap: 8 }}>
            <div className="divider-label">
              On site this week{week ? ` · ${weekDay(week.from)}–${weekDay(week.to)}` : ""}
            </div>
            <SiteWeekTrades projectId={id} week={week} />

            {/* THE THREE THINGS SOMEBODY WORKING ON SITE ACTUALLY DOES.
                Shahar (2026-09-13): "the contractor needs a view on the
                project - from this week tasks, to logging payments, and
                adding site visit."

                They were all here already and all of them were a hunt: the
                work behind a panel in the grid, the payment inside whichever
                task it belonged to, the visit behind another panel. Under a
                working lens they are three rows where the week ends, in the
                order the day runs in. */}
            {lens.onSite && (
              <div className="stack" style={{ gap: 6 }}>
                <Link href={panelHref("tasks")} className="home-row">
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="t">
                      The work{myOpen > 0 ? ` · ${myOpen} yours` : openHere.length > 0 ? ` · ${openHere.length} open` : ""}
                    </span>
                    <span className="m" style={{ display: "block" }}>
                      {late.length > 0 ? `${late.length} past its date` : "What is late, what is this week, what is waiting"}
                    </span>
                  </span>
                  <ChevronIcon />
                </Link>
                {taskMoney.can_log && (
                  <Link href={`/project/${id}/pay?back=${encodeURIComponent(keepAs())}`} className="home-row">
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="t">Log a payment</span>
                      <span className="m" style={{ display: "block" }}>
                        A receipt, an invoice, something you bought — filed against the task it belongs to
                      </span>
                    </span>
                    <ChevronIcon />
                  </Link>
                )}
                <Link href={panelHref("visits")} className="home-row">
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="t">
                      {visits.some((v) => v.on_date === today) ? "Today's site visit" : "Log today's site visit"}
                    </span>
                    <span className="m" style={{ display: "block" }}>
                      {visits.some((v) => v.on_date === today)
                        ? "Already logged — open it to add a photo or change what it says"
                        : "A note, a photo, a voice note. It puts you on the day's roster."}
                    </span>
                  </span>
                  <ChevronIcon />
                </Link>
              </div>
            )}
          </section>
        )}

        {panel === "visits" && (
          /* The record of being here: a note, a photo, a voice note; yours to
             correct or remove. Today's is the one you write in; the one before
             it is a line until you open it. */
          <SiteVisits projectId={id} visits={visits} urls={signed}
            canLog={!!board.me?.contact_id} today={today} address={seat.address ?? null} />
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
            <div className="between" style={{ alignItems: "baseline", gap: 10 }}>
              {/* "Open work" said what the list WAS. Shahar (2026-09-14):
                  "change the open work to tasks to complete" - which says
                  what it is FOR, and is the only reading of the number that
                  makes somebody do something about it. */}
              <div className="divider-label" style={{ padding: 0 }}>
                {show === "done" ? "Done" : show === "all" ? "All work" : "Tasks to complete"} · {shown.length}
                {!show && dueThisWeek.length > 0 && (
                  <span className="text-muted" style={{ fontWeight: 400 }}> · {dueThisWeek.length} this week</span>
                )}
              </div>
              {/* WRITING SOMETHING DOWN ON SITE HAS TO COST NOTHING, so the
                  way in sits on the heading of the list it joins rather than
                  behind a menu. Only for somebody who may add work; the
                  database refuses the rest anyway (portal_task_create). */}
              {lens.rank >= 30 && (
                <Link href={`/project/${id}/task/new?back=${encodeURIComponent(keepAs(`/project/${id}`))}`}
                  className="btn btn-secondary small" style={{ minHeight: 32 }}>+ New task</Link>
              )}
            </div>

            {here.length > 3 && <SearchBox placeholder="Find a task on this site" count={query ? found.length : null} />}

            {/* THREE ROWS OF BUTTONS, FOLDED AWAY. Shahar (2026-09-14): "all
                filters (3 rows of buttons) to be visible under a filter icon
                and unfold when clicking on it."

                They were eating the top third of the screen above the work
                itself, every time, for a set of choices most people make once.
                Folded, the summary line says what is currently on - so it
                still answers "why am I only seeing 58?" without being opened.

                It opens by itself when a filter is doing something, because a
                hidden filter that is silently changing the list is worse than
                no filter at all. */}
            <details className="filters" open={!!show || onlyMine || by !== "trade"}>
              <summary className="filters-head">
                <span className="ic" aria-hidden>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 5h18M6 12h12M10 19h4" />
                  </svg>
                </span>
                <span className="grow">
                  Filters
                  <span className="m">
                    {[
                      onlyMine ? "mine" : null,
                      show === "done" ? "done" : show === "all" ? "all" : "open",
                      `by ${GROUPINGS.find((g) => g.key === by)?.label.toLowerCase() ?? "trade"}`,
                    ].filter(Boolean).join(" · ")}
                  </span>
                </span>
                <span className="chev"><ChevronIcon /></span>
              </summary>

              <div className="filters-body">
                {/* Whose. Only where the answer is not the same either way. */}
                {canSplit && (
                  <nav className="chips" aria-label="Whose tasks">
                    <Chip href={viewHref({ who: "mine" })} on={onlyMine} label={`Mine · ${myOpen}`} />
                    <Chip href={viewHref({ who: "all" })} on={!onlyMine} label={`Everyone · ${openHere.length}`} />
                  </nav>
                )}

                {/* Open / Done / All. Done is a separate read, so it is only
                    paid for when it is asked for. */}
                <nav className="chips" aria-label="Which tasks">
                  <Chip href={viewHref({ show: undefined })} on={!show} label={`Open · ${openHere.length}`} />
                  <Chip href={viewHref({ show: "done" })} on={show === "done"}
                    label={wantDone ? `Done · ${doneHere.length}` : "Done"} />
                  <Chip href={viewHref({ show: "all" })} on={show === "all"} label="All" />
                </nav>

                {/* How they are arranged. */}
                <nav className="chips" aria-label="Group tasks by">
                  {GROUPINGS.map((g) => (
                    <Chip key={g.key} href={viewHref({ by: g.key === "trade" ? undefined : g.key })}
                      on={by === g.key} label={g.label} />
                  ))}
                </nav>
              </div>
            </details>

            {shown.length === 0 && (
              <Card soft pad>
                <div className="small">
                  {show === "done" ? "Nothing finished on this project yet."
                    : onlyMine ? "Nothing on this site is assigned to you. Everyone's work is one tap away, above."
                    : "Nothing open on this project."}
                </div>
              </Card>
            )}
            {shown.length > 0 && found.length === 0 && (
              <Card soft pad><div className="small">Nothing matches &ldquo;{query}&rdquo;.</div></Card>
            )}

            {/* TIMING: one list. Late leads and This week follows, as the
                buckets had it - but said by the colour of the row, not by a
                heading, so a process and its steps are never split across
                two panels (Shahar, 2026-09-17). */}
            {listed.length > 0 && (
              <>
                <UrgencyKey />
                <div className="bucket-rows">
                  {listed.map((r) => taskRow(r.t, r.depth, r))}
                </div>
              </>
            )}

            {/* TRADE: TILES, THREE ACROSS. Shahar (2026-09-14): "Each trade
                should be presented in a panel with the image of the trade and
                # of tasks not completed. aim for 3 in a row."

                A trade is a place you GO, not a drawer you open in place -
                nine stacked accordions is a list of headings you scroll past.
                Three across, each with its drawing and its count, is a set of
                doors you can see all of at once. The tile opens the trade's
                own screen, which already exists and already carries the work,
                the money and the way to log a payment.

                Every other arrangement - contract, phase, timing - keeps the
                panels: they nest, they have no picture, and their labels are
                sentences rather than names. */}
            {by === "trade" && groups.some((g) => g.trade) && (
              <div className="trade-grid">
                {groups.filter((g) => g.trade).map((g) => (
                  <Link key={g.key} href={tradeHref(g)} className="trade-tile">
                    <span className="art" aria-hidden><TradeIllustration name={g.art} /></span>
                    <span className="t">{g.label}</span>
                    <span className="n">{g.n} {g.n === 1 ? "task" : "tasks"}</span>
                    {g.late > 0 && <span className="late">{g.late} late</span>}
                    {g.owed > 0 && <span className="owed">{money(g.owed)} to pay</span>}
                  </Link>
                ))}
              </div>
            )}

            {/* The leftovers keep their panel. A group filed under a person is
                "no trade recorded, held by them" - it has no trade screen to
                open and no picture to show, and turning it into a tile would
                dress up the very thing that needs classifying. */}
            {(by !== "trade" ? groups : groups.filter((g) => !g.trade)).map((g) => (
              <GroupBlock key={g.key} g={g} depth={0} row={taskRow} payHref={payHref}
                canLog={taskMoney.can_log} />
            ))}
          </section>
        )}
        </>
        )}
      </div>
    </Screen>
  );
}

const GearIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 8.9 19a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 5 8.9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);

// A panel: a number, the words for what it counts, and a second line that
// says the thing the number leaves out. With an href, tapping it opens it
// below; without one it is simply a number that had to be said (the
// development's roll-ups, where the only thing to open is a property).
function Panel({ href, on, n, label, sub, tone }: {
  href?: string; on?: boolean; n: number | string; label: string; sub?: string; tone?: "late";
}) {
  const inside = (
    <>
      <div className="n">{n}</div>
      <div className="l">{label}</div>
      {sub && <div className={`s ${tone === "late" ? "late" : ""}`}>{sub}</div>}
    </>
  );
  const cls = `pnl ${tone === "late" ? "late" : ""}${href ? "" : " flat"}`;
  return href
    ? <Link href={href} aria-current={on ? "page" : undefined} scroll={false} className={cls}>{inside}</Link>
    : <div className={cls}>{inside}</div>;
}

// A CATEGORY, AND WHAT IS UNDER IT.
//
// Shahar (2026-09-13): "even when i click on trade to sort, it might sort, but
// not show things nested under every trade. build hierarchy so i can see
// everything Frame related (example the receipt i need to pay) and under each
// category allow me to log a payment."
//
// So a category is a panel that opens, not a heading: its line says how much
// work is under it, how much of that is late, what has been paid and what is
// still owed, and opening it shows the trades beneath it, then the work, then
// the way to log a payment against the category.
//
// It opens by itself when there is something owed or something late - the two
// reasons a person is on this screen - and stays shut otherwise, which is what
// makes a hundred and forty tasks readable at all.
// A SECTION'S ROWS, WITH THE STEPS UNDER THE THING THEY ARE STEPS OF.
//
// nest() hands back the same rows in the same order, each carrying how deep
// it sits. They stay DIRECT children of .bucket-rows - the hairlines and the
// padding come from `> a` - so the indent is a class on the row, not a
// wrapper around it.
// The TIMING sections arrive already nested (groupFamilies, 2026-09-17: a
// process and its steps stay in one section, the soonest step's); the
// nested arrangements still hand a flat list to nest() here.
function TaskRows({ rows, row }: {
  rows: Task[] | Twig[];
  row: (t: Task, depth?: number) => React.ReactNode;
}) {
  const twigs: Twig[] = rows.length > 0 && "depth" in rows[0]! ? (rows as Twig[]) : nest(rows as Task[]);
  return <div className="bucket-rows">{twigs.map(({ t, depth }) => row(t, depth))}</div>;
}

function GroupBlock({ g, depth, row, payHref, canLog }: {
  g: Group;
  depth: number;
  row: (t: Group["rows"][number], depth?: number) => React.ReactNode;
  payHref: (g: Group) => string;
  canLog: boolean;
}) {
  const open = g.owed > 0 || g.late > 0;
  const line = [
    // An owner group is what no trade claimed, so it says so - otherwise a
    // person's name sitting among the trades reads as a trade. An assistant
    // holding it is worth saying too: it is held, but not by a person.
    g.owner ? (g.rows[0]?.assignee_kind === "assistant" ? "assistant · no trade recorded" : "no trade recorded") : null,
    `${g.n} ${g.n === 1 ? "task" : "tasks"}`,
    g.late > 0 ? `${g.late} late` : null,
    g.owed > 0 ? `${money(g.owed)} to pay` : null,
    g.spent > 0 ? `${money(g.spent)} paid` : null,
  ].filter(Boolean).join(" · ");

  return (
    <details className="home-panel" open={open} style={depth > 0 ? { marginLeft: 0 } : undefined}>
      <summary className="home-row">
        <span className="grow" style={{ minWidth: 0 }}>
          <span className="t">{g.label}</span>
          <span className="m" style={{ display: "block" }}>{line}</span>
        </span>
        {g.owed > 0 && <span className="tag tag-status" style={{ whiteSpace: "nowrap" }}>{money(g.owed)}</span>}
        <span className="chev"><ChevronIcon /></span>
      </summary>
      <div className="drawer stack" style={{ gap: 10, paddingTop: 10 }}>
        {g.sub.map((s) => (
          <GroupBlock key={s.key} g={s} depth={depth + 1} row={row} payHref={payHref} canLog={canLog} />
        ))}
        {g.rows.length > 0 && <TaskRows rows={g.rows} row={row} />}
        {/* The payment belongs to a task; this row is the way in. */}
        {canLog && g.rows.length > 0 && (
          <Link href={payHref(g)} className="home-row">
            <span className="grow" style={{ minWidth: 0 }}>
              <span className="t">Log a payment in {g.label.toLowerCase()}</span>
              <span className="m" style={{ display: "block" }}>
                A receipt, an invoice, something you bought — filed against the task it belongs to
              </span>
            </span>
            <span className="chev"><ChevronIcon /></span>
          </Link>
        )}
      </div>
    </details>
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
function Lifecycle({ projectId, status, closed, owns, archived, open, liveKids, owed, paid, superadmin }: {
  projectId: string; status: string; closed: boolean;
  // The asset owner (rank 70). Ending a job and deciding what stays on the
  // board are theirs; running it day to day is not the same authority.
  owns: boolean; archived: boolean;
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

        {/* PUTTING IT AWAY (migration 115). The ending froze the record; this
            only decides whether the owner keeps looking at it. Nothing is
            deleted and the same button brings it back. */}
        {owns && (
          <form action={archiveProject.bind(null, projectId, !archived)}>
            <button className="btn btn-secondary btn-block">
              {archived ? "Bring it back onto the board" : "Put this job away"}
            </button>
            <p className="tiny text-muted" style={{ margin: "6px 0 0", textAlign: "center" }}>
              {archived
                ? "It is off your board. Nothing was deleted."
                : "It comes off your board. Nothing is deleted, and this button brings it back."}
            </p>
          </form>
        )}
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

      {/* THE OTHER ENDING (migration 070). Greyed out for everybody on
          2026-09-13 - "this is too risky" - and back on 2026-09-14 for the
          person who owns the job: "as the owner of a project, I need to be
          able to cancel and archive it."

          It is still the heaviest button on the screen: it ends the work and
          takes every open task down with it. So it stays folded, it asks for
          a reason in the person's own words (the database refuses fewer than
          four characters), and it says the count out loud before the press.
          Below rank 70 the row stays greyed and says whose call it is. */}
      {owns ? (
        <details className="home-panel">
          <summary className="home-row">
            <span className="grow" style={{ minWidth: 0 }}>
              <span className="t">Cancel this job</span>
              <span className="m" style={{ display: "block" }}>
                It will not happen — this ends it and takes
                {open > 0 ? ` ${open} open ${open === 1 ? "task" : "tasks"}` : " anything open"} with it
              </span>
            </span>
            <span className="chev"><ChevronIcon /></span>
          </summary>
          <form action={cancelProject.bind(null, projectId)} className="drawer stack" style={{ gap: 8, paddingTop: 12 }}>
            <p className="small text-muted" style={{ margin: 0 }}>
              Everything still open here is cancelled with it and the record freezes — the reason
              you give is written onto the job and onto every task that goes with it.
            </p>
            {paid > 0 && (
              <p className="tiny" style={{ color: "var(--color-status)", margin: 0 }}>
                {money(paid)} has already been paid on this one. Cancelling does not unspend it; the
                ledger keeps it.
              </p>
            )}
            <label className="field" style={{ marginBottom: 0 }}>
              <span className="field-label">Why it is being cancelled</span>
              <input className="input" name="reason" required minLength={4}
                placeholder="Duplicate of the other generator job · homeowner changed their mind" />
            </label>
            <button className="btn btn-secondary btn-block">Cancel this job</button>
          </form>
        </details>
      ) : (
        <div className="home-row" aria-disabled="true"
          style={{ cursor: "not-allowed", opacity: 0.45, alignItems: "flex-start" }}>
          <span className="grow" style={{ minWidth: 0 }}>
            <span className="t">Cancel this job</span>
            <span className="m" style={{ display: "block" }}>
              The owner&apos;s call — it would end the work and take
              {open > 0 ? ` ${open} open ${open === 1 ? "task" : "tasks"}` : " anything open"} with it
            </span>
          </span>
        </div>
      )}
      <p className="tiny text-muted" style={{ margin: 0 }}>
        Either ending freezes the record. Once it has ended you can put it away, which takes it off
        your board without deleting anything.
        {paid > 0 ? ` ${money(paid)} has already been paid on this one.` : ""}
      </p>
    </div>
  );
}
