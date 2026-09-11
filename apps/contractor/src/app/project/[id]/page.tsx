import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";
import { dayClock, shortDate } from "@shared/format";
import { stopwatch } from "@shared/perf";
import { AppBar, Card, ChevronIcon, Notice, Screen } from "@shared/ui";
import { GROUPINGS, coverUrls, getBoard, groupTasks, money, runs, type GroupKey } from "@/lib/board";
import { SearchBox } from "@/components/SearchBox";
import { matchesQuery } from "@/lib/search";
import { siteCheck } from "./actions";
import { CoverPhoto } from "./CoverPhoto";

export const dynamic = "force-dynamic";

// One project, as the person running it needs it: where it is, what is
// behind, what is out to bid, and what it owes. Every number here is
// computed in the database - portal_finance_rollup, portal_bid_packages,
// portal_tasks - so this screen decides what to show and nothing more.
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

// Today on site: whether you are checked in, and when you arrived.
type SiteDay = { date: string; on_site: boolean; arrived_at: string | null; left_at: string | null } | null;

export default async function ProjectPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; q?: string; by?: string; show?: string }>;
}) {
  const { id } = await params;
  const { ok, error, q, by: byRaw, show } = await searchParams;
  const by: GroupKey = GROUPINGS.some((g) => g.key === byRaw) ? (byRaw as GroupKey) : "timing";
  // Open is the default; Done and All are a tap away (Shahar: "i need to see
  // completed as well"). Only the finished list costs an extra read.
  const wantDone = show === "done" || show === "all";
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
  const [board, { data: pkgData }, { data: rollupData }, { data: scopeData }, { data: dayData }] = await Promise.all([
    w.step("board", () => getBoard({ closed: wantDone ? 500 : 0 })),
    w.step("bids", () => rpc<BidPackage[]>(supabase, "portal_bid_packages", { p_project: id })),
    w.step("finance", () => rpc<Rollup>(supabase, "portal_finance_rollup", { p_project_id: id })),
    w.step("scope", () => rpc<ScopeTrade[]>(supabase, "portal_scope_trades", { p_project: id })),
    w.step("day", () => rpc<SiteDay>(supabase, "portal_site_day", { p_project: id })),
  ]);
  if (!board.signed_in) redirect(`/login?next=/project/${id}`);

  const seat = board.seats.find((s) => s.project_id === id);
  if (!seat) notFound();
  const manages = runs(seat);

  // What sits beneath this project, and where "back" goes - both come out of
  // the board read we already have, so neither costs a query.
  const kids = board.seats.filter((s) => s.parent_project_id === id);
  const parent = seat.parent_project_id && board.seats.some((s) => s.project_id === seat.parent_project_id)
    ? seat.parent_project_id : null;
  const openByProject = new Map<string, number>();
  for (const t of board.tasks) {
    if (t.state === "open" && t.project_id) openByProject.set(t.project_id, (openByProject.get(t.project_id) ?? 0) + 1);
  }

  const today = new Date().toISOString().slice(0, 10);
  const packages = pkgData ?? [];
  const roll = rollupData ?? null;
  const scopeLines = (scopeData ?? []).reduce((n, t) => n + t.scope_lines, 0);
  const scopeTrades = (scopeData ?? []).filter((t) => t.chosen).length;
  const day = dayData ?? null;

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
  // Which of them this view is about. Done is fetched only when asked for,
  // so the Open view costs exactly what it did before.
  const shown = show === "done" ? doneHere : show === "all" ? here : openHere;
  // The search (Shahar: "find relevant tasks faster"): a word or two,
  // matched against the subject, the notes, the job, the trade, the person,
  // and now the contract and the phase the sections are named after.
  const query = (q ?? "").trim();
  const found = query
    ? shown.filter((t) => matchesQuery(query, [
        t.action, t.notes, t.project_id ? nameOf.get(t.project_id) ?? t.project : t.project,
        t.trade, t.assignee, t.status, t.contract, t.phase,
      ]))
    : shown;
  // Sections. Timing by default - every task has one; trade, contract and
  // phase are a tap away and name what they cannot place. See groupTasks.
  const sections = groupTasks(found, by);
  // Links that keep the rest of the view: changing the grouping must not
  // throw away the search, and searching must not throw away the grouping.
  const viewHref = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged: Record<string, string | undefined> = {
      q: query || undefined, by: by === "timing" ? undefined : by, show: show || undefined, ...over,
    };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/project/${id}?${s}` : `/project/${id}`;
  };
  const covers = await w.step("cover", () => coverUrls(supabase, [seat.cover]));
  const cover = covers[seat.cover ?? ""] ?? null;
  w.done();

  return (
    <Screen>
      <AppBar back={parent ? `/project/${parent}` : "/"} title={seat.project_name}
        sub={seat.address ?? seat.parent_name ?? undefined} />
      <div className="body">
        {error && <Notice kind="error">{error}</Notice>}
        {ok === "arrive" && <div className="banner-ok">You&apos;re on site. You&apos;re on today&apos;s roster.</div>}
        {ok === "leave" && <div className="banner-ok">Logged. Your day here is recorded.</div>}

        {/* The face. Whoever runs the site can put one on it from here;
            without one a job wears the house's photo (migration 063). */}
        <CoverPhoto projectId={id} url={cover} own={seat.cover_own} canEdit={manages} />

        <div className="kicker">
          {manages ? "You run this" : seat.seat ?? "Your seat"} · {seat.status}
          {seat.stage ? ` · ${seat.stage}` : ""}
        </div>

        {/* FIRST ACTION ON THE SITE - but only where there IS a site. A site
            is a place with an address: a property has one, a job carries the
            property's, a development is a folder of properties and has none.
            "I'm on site" at Green Bergen Development claims to stand in a
            place that does not exist, so the card follows the address, and
            portal_site_check (migration 039) refuses the same case. */}
        {seat.address && (
          <>
          {/* Two buttons, because this is tapped standing in a driveway;
              arriving also puts you on the day's roster. */}
          <Card pad>
            <div className="between" style={{ alignItems: "flex-start" }}>
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="card-title" style={{ fontSize: 15 }}>
                  {day?.on_site ? "You're on site" : "Log a site visit"}
                </div>
                <div className="small text-muted">
                  {day?.on_site
                    ? `Since ${dayClock(day.arrived_at)}. Log your leave when you go.`
                    : day?.left_at
                      ? `You were here today — left ${dayClock(day.left_at)}.`
                      : "Records your day here and puts you on the roster."}
                </div>
              </div>
              {day?.on_site && <span className="tag tag-ok">On site</span>}
            </div>
            <form action={(day?.on_site ? siteCheck.bind(null, id, "leave") : siteCheck.bind(null, id, "arrive"))}
                  className="stack" style={{ gap: 8, marginTop: 10 }}>
              <input className="input" name="note" placeholder={day?.on_site ? "Anything worth recording? (optional)" : "What are you here for? (optional)"} />
              <button className="btn btn-primary btn-block">
                {day?.on_site ? "Log that I'm leaving" : "I'm on site"}
              </button>
            </form>
          </Card>

          {/* The three numbers a GC checks first. */}
          <div className="tiles quad" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
            <Stat n={String(openHere.length)}
              label={kids.length ? "open on site" : openHere.length === 1 ? "open task" : "open tasks"}
              tone={late.length ? "status" : undefined} />
            <Stat n={String(packages.filter((p) => p.status === "open").length)} label="out to bid" />
            <Stat n={money(roll?.owed ?? seat.owed) ?? "—"} label="owed" />
          </div>
          {late.length > 0 && (
            <Notice kind="error" title={`${late.length} ${late.length === 1 ? "task is" : "tasks are"} late.`}>
              The oldest was due {shortDate(late.sort((a, b) => (a.target_date ?? "").localeCompare(b.target_date ?? ""))[0]!.target_date)}.
            </Notice>
          )}
          </>
        )}

        {/* What sits beneath this one. A development lists its homes, a home
            lists its jobs - the same order as the board, busiest first. */}
        {kids.length > 0 && (
          <section className="stack" style={{ gap: 8 }}>
            <div className="divider-label">
              {kids.length} {kids.length === 1 ? "job beneath" : "jobs beneath"}
            </div>
            {[...kids]
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
          </section>
        )}

        {/* Scope. Nobody works without one, so it is the step before a bid,
            a contract or a start - and the way in to the bid packages. */}
        <section className="stack" style={{ gap: 8 }}>
          <div className="divider-label">Scope</div>
          <Link href={`/project/${id}/scope`} className="home-row">
            <span className="grow" style={{ minWidth: 0 }}>
              <span className="t">{scopeLines === 0 ? "Write the scope" : `${scopeLines} line${scopeLines === 1 ? "" : "s"} in scope`}</span>
              <span className="m" style={{ display: "block" }}>
                {scopeLines === 0
                  ? "Trades, their blueprint lines, then the bid packages"
                  : `${scopeTrades} trade${scopeTrades === 1 ? "" : "s"} on this job`}
              </span>
            </span>
            <ChevronIcon />
          </Link>
        </section>

        {/* Money. Contracts, milestones, the changes asked for and the
            ledger - the payor's side for whoever runs the site, the
            payee's for a trade on it. */}
        <section className="stack" style={{ gap: 8 }}>
          <div className="divider-label">Money</div>
          <Link href={`/project/${id}/money`} className="home-row">
            <span className="grow" style={{ minWidth: 0 }}>
              <span className="t">{money(roll?.owed ?? seat.owed) ? `${money(roll?.owed ?? seat.owed)} owed` : "Contracts and payments"}</span>
              <span className="m" style={{ display: "block" }}>
                {manages ? "Milestones, approvals, what was paid, changes to decide" : "Your milestones, request a payment, ask for a change"}
              </span>
            </span>
            <ChevronIcon />
          </Link>
        </section>

        {/* Bids. The address rule applies here too: a trade invited to bid
            sees the town until they win it. */}
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

        {/* THE WORK, IN SECTIONS - never a rolling list. A flat list of
            everything answers no question; what is late, what is this week
            and what is waiting on someone else are three different
            questions, and a person on site is only asking the first two.
            That is the default. Trade, contract and phase are the other
            three ways a build divides up (Shahar) - a tap away, each naming
            what it cannot place rather than hiding it. The sections live in
            lib/board.ts so this screen and /tasks cannot drift apart. */}
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
      </div>
    </Screen>
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

function Stat({ n, label, tone }: { n: string; label: string; tone?: "status" }) {
  return (
    <div className="tile" style={{ minHeight: 0, alignItems: "flex-start", textAlign: "left", gap: 2, padding: "12px 12px 10px" }}>
      <div className="mono" style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 22, color: tone === "status" ? "var(--color-status)" : undefined }}>{n}</div>
      <div className="tiny text-muted">{label}</div>
    </div>
  );
}
