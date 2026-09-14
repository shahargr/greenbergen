import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";
import { shortDate } from "@shared/format";
import { stopwatch } from "@shared/perf";
import { AppBar, Card, ChevronIcon, Notice, Screen } from "@shared/ui";
import { GROUPINGS, buildTree, coverUrls, faceUrl, getBoard, groupTasks, groupWork, money, openBeneath, readMoney, runs, type Group, type GroupKey, type Node, type Seat, type TaskMoney } from "@/lib/board";
import { lensOf, lensesFor, readLens, type Lens, type PanelKey } from "@/lib/lens";
import { PropertyCard } from "@/components/PropertyCard";
import { SearchBox } from "@/components/SearchBox";
import { matchesQuery } from "@/lib/search";
import { ProjectSetup } from "./ProjectSetup";
import { SiteVisits, type Visit } from "./SiteVisits";
import { SiteWeekTrades, weekDay, type SiteWeek } from "./SiteWeek";
// cancelProject is deliberately NOT imported: the row that called it is
// greyed out for now (Shahar, 2026-09-13 - "this is too risky"). The action
// and migration 070 stay where they are; one import turns it back on.
import { closeProject, reopenProject } from "./actions";

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
  searchParams: Promise<{ ok?: string; error?: string; q?: string; by?: string; show?: string; panel?: string; as?: string; who?: string }>;
}) {
  const { id } = await params;
  const { ok, error, q, by: byRaw, show, panel: panelRaw, as: asRaw, who } = await searchParams;
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
  const [board, { data: pkgData }, { data: rollupData }, { data: scopeData }, { data: weekData }, { data: visitData }, { data: moneyData }] = await Promise.all([
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
    (!panelRaw || panelRaw === "tasks" || panelRaw === "week")
      ? w.step("taskMoney", () => rpc<TaskMoney>(supabase, "portal_task_money", { p_project: id }))
      : Promise.resolve({ data: null }),
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
  // Open work at or beneath each of them. Counting the rows ON a child is
  // what made 55 Walnut - a live house with a hundred and fifty open tasks on
  // the jobs under it - read as "not started" (Shahar's screenshot).
  const openByProject = openBeneath(board.seats, board.tasks);

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
  // Timing stays a flat list of buckets: late first, this week next, and
  // collapsing those would hide the two things the screen exists to say.
  // The other three NEST and carry their money (Shahar, 2026-09-13: "build
  // hierarchy so i can see everything Frame related... and under each
  // category allow me to log a payment") - see groupWork.
  const taskMoney = readMoney(moneyData);
  const sections = panel === "tasks" && by === "timing" ? groupTasks(found, by) : [];
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
  const keepAs = (extra = "") => {
    const p = new URLSearchParams(extra);
    if (asParam) p.set("as", asParam);
    const s = p.toString();
    return s ? `/project/${id}?${s}` : `/project/${id}`;
  };
  const panelHref = (k: PanelKey) => k === fallback ? keepAs() : keepAs(`panel=${k}`);
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

  // ONE TASK, one row - written once and used by both arrangements, so the
  // flat buckets and the nested categories cannot drift apart.
  const taskRow = (t: (typeof board.tasks)[number]) => {
    const m = taskMoney.tasks[t.id];
    return (
      <Link key={t.id} href={`/task/${t.id}?back=${encodeURIComponent(viewHref({}))}`}>
        <span className="grow" style={{ minWidth: 0 }}>
          <span className="t">{t.action}</span>
          <span className="m">
            {[
              // Which job it is on, when that is not this row.
              t.project_id && t.project_id !== id ? (nameOf.get(t.project_id) ?? t.project) : null,
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
  const beforeToday = visits.find((v) => v.on_date !== today);
  const PANELS: Record<PanelKey, {
    n: number | string; empty: boolean; label: string; sub?: string; tone?: "late"; quiet: string;
  }> = {
    tasks: {
      n: openHere.length, empty: openHere.length === 0, quiet: "open work",
      label: hasKids ? "tasks open on this site" : "tasks still open",
      sub: late.length > 0 ? `${late.length} past its date` : "nothing is late",
      tone: late.length > 0 ? "late" : undefined,
    },
    bids: {
      n: openPkgs.length, empty: openPkgs.length === 0, quiet: "bids",
      label: "packages out to bid",
      sub: packages.length > openPkgs.length ? `${packages.length - openPkgs.length} settled` : "waiting on numbers",
    },
    money: {
      // Money is never empty in the way a count is: "nothing owed" is an
      // answer somebody came here for, and $0 paid on a live job is news.
      n: money(owed) ?? "$0", empty: owed === 0 && (roll?.paid ?? 0) === 0 && (roll?.contracted ?? 0) === 0,
      quiet: "money", label: "owed to the trades",
      sub: money(roll?.paid) ? `${money(roll?.paid)} paid so far` : "nothing paid yet",
    },
    "jobs-open": {
      n: kidOpen.length, empty: kidOpen.length === 0, quiet: "jobs not started",
      label: "jobs not started", sub: "open, nothing on the board",
    },
    "jobs-working": {
      n: kidWorking.length, empty: kidWorking.length === 0, quiet: "jobs being worked",
      label: "jobs being worked", sub: "open, with tasks on them",
    },
    "jobs-done": {
      n: kidDone.length, empty: kidDone.length === 0 && kidEnded.length === 0, quiet: "jobs completed",
      label: "jobs completed",
      sub: kidEnded.length > 0 ? `${kidEnded.length} cancelled` : "closed and frozen",
    },
    week: {
      n: week?.trades.length ?? 0, empty: (week?.trades.length ?? 0) === 0, quiet: "who is on site",
      label: "trades on site this week",
      sub: week ? `${weekDay(week.from)}–${weekDay(week.to)}` : "this week",
    },
    visits: {
      // Today's count, and what came before it - never "last Sep 11" on the
      // eleventh of September.
      n: visitsToday, empty: visitsToday === 0, quiet: "today's site visit",
      label: "site visits logged today",
      sub: visitsToday > 0
        ? beforeToday ? `before that ${shortDate(beforeToday.on_date)}` : "the first one here"
        : beforeToday ? `last was ${shortDate(beforeToday.on_date)}` : "nobody has logged one",
    },
    soon: { n: "—", empty: false, quiet: "", label: "held for what comes next" },
  };
  // The one you are looking at stays whatever it counts - a panel that
  // vanished when you opened it would be a screen arguing with you.
  const shownPanels = offered
    .filter((k) => !PANELS[k].empty || k === panel)
    .map((k) => ({ key: k, ...PANELS[k] }));
  const emptyPanels = offered
    .filter((k) => PANELS[k].empty && k !== panel && k !== "soon")
    .map((k) => ({ key: k, ...PANELS[k] }));

  // One signed-URL round trip for the cover and everything hanging off the
  // visits - they all live in the same private bucket.
  const visitPaths = panel === "visits" ? visits.flatMap((v) => v.files.map((f) => f.path)) : [];
  const signed = await w.step("media", () => coverUrls(supabase, [seat.cover, ...visitPaths, ...kids.map((k) => k.cover)]));
  const cover = faceUrl(seat, signed);
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
        <ProjectSetup projectId={id} url={cover} own={seat.cover_own} stock={!!seat.cover_url} canEdit={manages}
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

        {/* VIEWING AS. Shahar (2026-09-13): "allow me to log in as GC /
            Professional / home owner / investor / viewer. This currently does
            not work."

            It changes the SHAPE of this screen and nothing else: which panels
            you are offered, in what order, and where it opens. Every read
            under it still goes through the same database gates, so a lens can
            never show you something your seat does not already reach - which
            is exactly why looking down your own ladder is safe, and how you
            check what your trades are actually looking at. */}
        {!isFolder && lenses.length > 1 && (
          <section className="stack" style={{ gap: 6 }}>
            <nav className="chips" aria-label="View this project as">
              <span className="tiny text-muted" style={{ alignSelf: "center", marginRight: 2 }}>Viewing as</span>
              {lenses.map((l) => (
                <Chip key={l.key} href={lensHref(l)} on={l.key === lens.key}
                  label={l.key === actualLens ? `${l.label} · you` : l.label} />
              ))}
            </nav>
            <p className="tiny text-muted" style={{ margin: 0 }}>
              {lens.full}.{lens.key === actualLens ? "" : " This only changes what the screen puts first — never what you are allowed to see."}
            </p>
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
        <div className="pgrid">
          {shownPanels.map((p) => (
            p.key === "soon"
              ? <div className="pnl soon" key={p.key} aria-hidden><div className="n">—</div><div className="l">held for what comes next</div></div>
              : <Panel key={p.key} href={panelHref(p.key)} on={p.key === panel}
                  n={p.n} label={p.label} sub={p.sub} tone={p.tone} />
          ))}
        </div>

        {emptyPanels.length > 0 && (
          <p className="tiny text-muted" style={{ margin: "-4px 0 0" }}>
            Nothing yet:{" "}
            {emptyPanels.map((p, i) => (
              <span key={p.key}>
                {i > 0 ? " · " : ""}
                <Link href={panelHref(p.key)}>{p.quiet}</Link>
              </span>
            ))}
          </p>
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
            <div className="between" style={{ alignItems: "baseline", gap: 10 }}>
              <div className="divider-label" style={{ padding: 0 }}>
                {show === "done" ? "Done" : show === "all" ? "All work" : "Open work"} · {shown.length}
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

            {/* Whose. Only where the answer is not the same either way. */}
            {canSplit && (
              <nav className="chips" aria-label="Whose tasks">
                <Chip href={viewHref({ who: "mine" })} on={onlyMine} label={`Mine · ${myOpen}`} />
                <Chip href={viewHref({ who: "all" })} on={!onlyMine} label={`Everyone · ${openHere.length}`} />
              </nav>
            )}

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
                <Chip key={g.key} href={viewHref({ by: g.key === "trade" ? undefined : g.key })}
                  on={by === g.key} label={g.label} />
              ))}
            </nav>

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

            {/* TIMING: flat buckets, exactly as they were. Late and This
                week are the two things this screen exists to say, and a
                bucket you have to open is a bucket you do not read. */}
            {sections.map((b) => (
              <div key={b.key}>
                <div className="bucket">
                  <span className={`h ${b.tone === "status" ? "late" : ""}`}>{b.label}</span>
                  <span className="n">{b.rows.length}{b.late > 0 && b.tone !== "status" ? ` · ${b.late} late` : ""}</span>
                </div>
                <div className="bucket-rows">{b.rows.map(taskRow)}</div>
              </div>
            ))}

            {/* TRADE · CONTRACT · PHASE: the hierarchy, each category
                carrying its count, what is late, what it has cost and what
                is still to pay, and a way to log a payment against it. */}
            {groups.map((g) => (
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
function GroupBlock({ g, depth, row, payHref, canLog }: {
  g: Group;
  depth: number;
  row: (t: Group["rows"][number]) => React.ReactNode;
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
        {g.rows.length > 0 && <div className="bucket-rows">{g.rows.map(row)}</div>}
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

      {/* THE OTHER ENDING (migration 070), AND IT IS SWITCHED OFF.
          Shahar (2026-09-13): "inside the project, clicking on the gear
          button, there is an option to cancel the job - this is too risky;
          for now, gray this out as an option."

          Cancelling a job takes every open task down with it and freezes the
          record - on 55 Walnut that is 136 tasks behind one button in a
          settings panel. So the row stays, greyed, saying what it would do
          and that it is not available: hiding it entirely would only mean
          somebody hunts for it and finds the database function instead.
          cancelProject and migration 070 are untouched - this is the SCREEN
          declining to offer it, and one line turns it back on. */}
      <div className="home-row" aria-disabled="true"
        style={{ cursor: "not-allowed", opacity: 0.45, alignItems: "flex-start" }}>
        <span className="grow" style={{ minWidth: 0 }}>
          <span className="t">Cancel this job</span>
          <span className="m" style={{ display: "block" }}>
            Switched off for now — it would end the work and take
            {open > 0 ? ` ${open} open ${open === 1 ? "task" : "tasks"}` : " anything open"} with it
          </span>
        </span>
      </div>
      <p className="tiny text-muted" style={{ margin: 0 }}>
        A job that will not happen: finish it as complete if the work is done, or leave it open and
        cancel its tasks one at a time, which keeps each reason on its own record.
        {paid > 0 ? ` ${money(paid)} has already been paid on this one.` : ""}
      </p>
    </div>
  );
}
