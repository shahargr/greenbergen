import Link from "next/link";
import { redirect } from "next/navigation";
import { AppBar, Card, ChevronIcon, Notice, Screen, ShellIcons } from "@shared/ui";
import { stopwatch } from "@shared/perf";
import { unreadForShell } from "@shared/unread";
import {
  BUCKETS, anyRuns, buildTree, getBoard, money, prune, runs,
  type BucketKey, type Node,
} from "@/lib/board";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your board" };

// The board: every project you hold a seat on, arranged the way the work is
// actually arranged - a development holds homes, a home holds jobs. Only the
// top of each tree is on the page; what is beneath it is one tap away and
// counted on the row, so the board answers "where is the work" before it
// answers "what is the work".
//
// portal_my_work() computes the whole thing - seat, rank, buckets, money -
// and hands over parent_project_id with it, so the hierarchy costs no extra
// read. The portal's /contractor builds the same list by querying
// project_members and projects by hand; that is the thing not to copy.
export default async function BoardPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { show } = await searchParams;
  const w = stopwatch("/");
  // The board and the badge do not depend on each other, so they leave together.
  const [board, unread] = await Promise.all([
    w.step("board", () => getBoard()),
    w.step("unread", () => unreadForShell()),
  ]);
  w.done();
  if (!board.signed_in) redirect("/login?next=/projects");

  const filter: BucketKey = BUCKETS.some((b) => b.key === show) ? (show as BucketKey) : "all";
  // COMPLETED IS HIDDEN BY DEFAULT. A board is what you are running; a
  // finished house is a record, and it has its own chip. So "All" counts and
  // shows everything that is not done, and Completed is the only way in.
  const isDone = (s: { buckets?: string[] | null }) => (s.buckets ?? []).includes("done");
  const counts: Record<string, number> = { all: board.seats.filter((s) => !isDone(s)).length };
  for (const s of board.seats) for (const b of s.buckets ?? []) counts[b] = (counts[b] ?? 0) + 1;

  const built = buildTree(board.seats, board.tasks, board.me?.contact_id ?? null);
  // A single root is not a board, it IS the board - every seat hangs off it,
  // so a row for it would be the only row. Promote its children to the top
  // level and let the development become the heading over them.
  const roof = built.length === 1 && built[0]!.children.length > 0 ? built[0]! : null;
  const full = roof ? roof.children : built;

  // A filter hides rows, never the row that leads to them - so a development
  // survives on the strength of a job three levels down, and opens itself.
  const tree = filter === "all"
    ? prune(full, (s) => !isDone(s))
    : prune(full, (s) => (s.buckets ?? []).includes(filter));
  const mine = tree.filter(anyRuns);
  const theirs = tree.filter((n) => !anyRuns(n));

  const openTasks = board.tasks.filter((t) => t.state === "open").length;
  const owed = board.seats.reduce((a, s) => a + (s.owed ?? 0), 0);
  const first = board.me?.full_name?.trim().split(" ")[0] ?? null;
  const beneath = tree.reduce((a, n) => a + n.count, 0);

  return (
    <Screen>
      <AppBar brand right={<ShellIcons unread={unread} gearHref="/business" inboxHref="/inbox" homeHref="/work" />} />
      <div className="body">
        {board.degraded && (
          <Notice kind="error" title="We couldn&apos;t load the whole board.">
            Some of it may be missing. <Link href="/projects">Try again</Link>.
          </Notice>
        )}

        <div className="hero">
          <h1>{first ? `${first}'s board.` : "Your board."}</h1>
          <p className="lead">
            {board.seats.length === 0
              ? "No project seats yet. When a project hands you the PM or GC seat, it lands here."
              : `${tree.length} ${tree.length === 1 ? "property" : "properties"}${beneath ? `, ${beneath} ${beneath === 1 ? "job" : "jobs"} beneath` : ""}${openTasks ? ` · ${openTasks} open ${openTasks === 1 ? "task" : "tasks"}` : ""}${money(owed) ? ` · ${money(owed)} owed` : ""}.`}
          </p>
        </div>

        {board.seats.length > 0 && (
          <nav className="chips" aria-label="Filter projects">
            <Chip k="all" label="All" n={counts.all} on={filter === "all"} />
            {BUCKETS.filter((b) => (counts[b.key] ?? 0) > 0).map((b) => (
              <Chip key={b.key} k={b.key} label={b.label} n={counts[b.key] ?? 0} on={filter === b.key} />
            ))}
          </nav>
        )}

        {mine.length > 0 && (
          <section className="stack" style={{ gap: 8 }}>
            {/* When one root holds everything, its name replaces the generic
                heading rather than taking a row of its own - same line, no
                extra height, and still the way in to the development. */}
            <div className="divider-label">
              {roof
                ? <Link href={`/project/${roof.seat.project_id}`} style={{ color: "inherit" }}>{roof.seat.project_name}</Link>
                : "Projects you run"} · {mine.length}
            </div>
            {mine.map((n) => <Branch key={n.seat.project_id} n={n} open={filter !== "all"} />)}
          </section>
        )}

        {theirs.length > 0 && (
          <section className="stack" style={{ gap: 8 }}>
            <div className="divider-label">Projects you work on · {theirs.length}</div>
            {theirs.map((n) => <Branch key={n.seat.project_id} n={n} open={filter !== "all"} />)}
          </section>
        )}

        {tree.length === 0 && board.seats.length > 0 && (
          <Card soft pad><div className="small">Nothing in that filter. <Link href="/projects">Show everything</Link>.</div></Card>
        )}

        {board.seats.length === 0 && (
          <Card soft pad>
            <div className="small">
              A seat arrives one of three ways: a project invites you as PM or GC, a homeowner&apos;s
              job grows into one, or you start one yourself. Starting one from here is the next
              thing we&apos;re building.
            </div>
          </Card>
        )}
      </div>
    </Screen>
  );
}

function Chip({ k, label, n, on }: { k: string; label: string; n: number; on: boolean }) {
  return (
    <Link href={k === "all" ? "/" : `/?show=${k}`} aria-current={on ? "page" : undefined}
      className={`tag ${on ? "" : "tag-neutral"}`}
      style={{ textDecoration: "none", padding: "7px 12px", fontSize: 12 }}>
      {label} · {n}
    </Link>
  );
}

// One top-level property, with everything beneath it folded away. <details>
// keeps the fold server-rendered and free - no state, no second request, and
// it still works with JavaScript off.
function Branch({ n, open }: { n: Node; open: boolean }) {
  return (
    <div className="stack" style={{ gap: 0 }}>
      <Row n={n} />
      {n.children.length > 0 && (
        <details open={open} className="branch">
          <summary className="tiny text-muted" style={{ cursor: "pointer", padding: "6px 4px 2px 14px", listStyle: "none" }}>
            {n.count} {n.count === 1 ? "job" : "jobs"} beneath
          </summary>
          <div className="stack" style={{ gap: 6, paddingTop: 4 }}>
            {n.children.map((c) => <Twig key={c.seat.project_id} n={c} depth={1} />)}
          </div>
        </details>
      )}
    </div>
  );
}

function Twig({ n, depth }: { n: Node; depth: number }) {
  return (
    <>
      <Row n={n} depth={depth} />
      {n.children.map((c) => <Twig key={c.seat.project_id} n={c} depth={depth + 1} />)}
    </>
  );
}

// One project. The line has to say where it is and what it wants from you,
// because a GC with fifteen seats reads this list and nothing else. The
// counts are rolled up: a development's number is the work under it.
function Row({ n, depth = 0 }: { n: Node; depth?: number }) {
  const s = n.seat;
  const bits = [
    depth === 0 ? s.address : null,
    s.seat && !runs(s) ? s.seat : null,
    s.status,
    n.count > 0 && depth > 0 ? `${n.count} beneath` : null,
  ].filter(Boolean) as string[];
  const owed = money(n.owed);
  return (
    <Link href={`/project/${s.project_id}`} className={depth ? "home-row sub" : "home-row"}
      style={depth ? { marginLeft: 14 + (depth - 1) * 12 } : undefined}>
      <span className="grow" style={{ minWidth: 0 }}>
        <span className="t" style={depth ? { fontSize: 15 } : undefined}>{s.project_name}</span>
        {bits.length > 0 && <span className="m" style={{ display: "block" }}>{bits.join(" · ")}</span>}
      </span>
      <span className="stack" style={{ gap: 4, alignItems: "flex-end" }}>
        {n.open > 0 && <span className="tag tag-outline" style={{ whiteSpace: "nowrap" }}>{n.open} open</span>}
        {n.mine > 0 && <span className="tag tag-status" style={{ whiteSpace: "nowrap" }}>{n.mine} on you</span>}
        {owed && <span className="tag tag-outline" style={{ whiteSpace: "nowrap" }}>{owed}</span>}
        {n.open === 0 && n.mine === 0 && !owed && <ChevronIcon />}
      </span>
    </Link>
  );
}
