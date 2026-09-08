import Link from "next/link";
import { redirect } from "next/navigation";
import { AppBar, Card, ChevronIcon, Notice, Screen, ShellIcons } from "@shared/ui";
import { stopwatch } from "@shared/perf";
import { BUCKETS, getBoard, money, runs, type BucketKey, type Seat } from "@/lib/me";
import { BuildTabs } from "@/components/BuildTabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your board" };

// The board: every project you hold a seat on, split by whether you RUN it
// (a manager seat - PM or GC) or work on it. portal_my_work() computes the
// whole thing, buckets included, so this screen is arrangement and nothing
// else. The portal's /contractor builds the same list by querying
// project_members and projects by hand; that is the thing not to copy.
export default async function BoardPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { show } = await searchParams;
  const w = stopwatch("/");
  const board = await w.step("board", () => getBoard());
  w.done();
  if (!board.signed_in) redirect("/login?next=/");

  const filter: BucketKey = BUCKETS.some((b) => b.key === show) ? (show as BucketKey) : "all";
  const inBucket = (s: Seat) => filter === "all" || (s.buckets ?? []).includes(filter);
  const counts: Record<string, number> = { all: board.seats.length };
  for (const s of board.seats) for (const b of s.buckets ?? []) counts[b] = (counts[b] ?? 0) + 1;

  const shown = board.seats.filter(inBucket);
  const mine = shown.filter(runs);
  const theirs = shown.filter((s) => !runs(s));
  const openTasks = board.tasks.filter((t) => t.state === "open");
  const owed = board.seats.reduce((a, s) => a + (s.owed ?? 0), 0);
  const first = board.me?.full_name?.trim().split(" ")[0] ?? null;

  return (
    <Screen>
      <AppBar brand right={<ShellIcons gearHref="/settings" inboxHref="/inbox" />} />
      <div className="body">
        {board.degraded && (
          <Notice kind="error" title="We couldn&apos;t load the whole board.">
            Some of it may be missing. <Link href="/">Try again</Link>.
          </Notice>
        )}

        <div className="hero">
          <h1>{first ? `${first}'s board.` : "Your board."}</h1>
          <p className="lead">
            {board.seats.length === 0
              ? "No project seats yet. When a project hands you the PM or GC seat, it lands here."
              : `${mine.length || "No"} ${mine.length === 1 ? "project" : "projects"} you run${theirs.length ? `, ${theirs.length} you work on` : ""}${openTasks.length ? ` · ${openTasks.length} open ${openTasks.length === 1 ? "task" : "tasks"}` : ""}${money(owed) ? ` · ${money(owed)} owed` : ""}.`}
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
            <div className="divider-label">Projects you run · {mine.length}</div>
            {mine.map((s) => <SeatRow key={s.project_id} s={s} />)}
          </section>
        )}

        {theirs.length > 0 && (
          <section className="stack" style={{ gap: 8 }}>
            <div className="divider-label">Projects you work on · {theirs.length}</div>
            {theirs.map((s) => <SeatRow key={s.project_id} s={s} />)}
          </section>
        )}

        {shown.length === 0 && board.seats.length > 0 && (
          <Card soft pad><div className="small">Nothing in that filter. <Link href="/">Show everything</Link>.</div></Card>
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
      <BuildTabs current="board" tasks={openTasks.length} />
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

// One project. The line has to say where it is and what it wants from you,
// because a GC with fifteen seats reads this list and nothing else.
function SeatRow({ s }: { s: Seat }) {
  const where = s.address ?? null;
  const bits = [
    s.parent_name ? `under ${s.parent_name}` : null,
    where,
    s.seat && !runs(s) ? s.seat : null,
    s.status,
  ].filter(Boolean) as string[];
  const owed = money(s.owed);
  return (
    <Link href={`/project/${s.project_id}`} className="home-row">
      <span className="grow" style={{ minWidth: 0 }}>
        <span className="t">{s.project_name}</span>
        <span className="m" style={{ display: "block" }}>{bits.join(" · ")}</span>
      </span>
      <span className="stack" style={{ gap: 4, alignItems: "flex-end" }}>
        {s.my_open_tasks > 0 && <span className="tag tag-status">{s.my_open_tasks} open</span>}
        {owed && <span className="tag tag-outline">{owed}</span>}
        {s.my_open_tasks === 0 && !owed && <ChevronIcon />}
      </span>
    </Link>
  );
}
