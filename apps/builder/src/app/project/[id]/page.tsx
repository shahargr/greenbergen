import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";
import { shortDate } from "@shared/format";
import { stopwatch } from "@shared/perf";
import { AppBar, Card, Notice, Screen } from "@shared/ui";
import { getBoard, money, runs, type Task } from "@/lib/me";
import { BuildTabs } from "@/components/BuildTabs";

export const dynamic = "force-dynamic";

// One project, as the person running it needs it: where it is, what is
// behind, what is out to bid, and what it owes. Every number here is
// computed in the database - portal_finance_rollup, portal_bid_packages,
// portal_tasks - so this screen decides what to show and nothing more.
type Rollup = {
  contracted?: number | null; paid?: number | null; owed?: number | null;
  approved?: number | null; stages?: number | null; open_stages?: number | null;
} | null;

type BidPackage = {
  id: string; trade: string | null; category: string | null; phase: string | null;
  status: string; reply_by: string | null; bids: number | null;
  invited: number | null; received: number | null; awarded_bid_id: string | null;
};

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const w = stopwatch("/project/[id]");
  const supabase = await createClient();

  // The shell and the project's own reads do not depend on each other.
  const [board, { data: tasksData }, { data: pkgData }, { data: rollupData }] = await Promise.all([
    w.step("board", () => getBoard()),
    w.step("tasks", () => rpc<Task[]>(supabase, "portal_tasks", { p_project_id: id, p_domain: "construction", p_closed_limit: 0 })),
    w.step("bids", () => rpc<BidPackage[]>(supabase, "portal_bid_packages", { p_project: id })),
    w.step("finance", () => rpc<Rollup>(supabase, "portal_finance_rollup", { p_project_id: id })),
  ]);
  w.done();
  if (!board.signed_in) redirect(`/login?next=/project/${id}`);

  const seat = board.seats.find((s) => s.project_id === id);
  if (!seat) notFound();
  const manages = runs(seat);

  const open = (tasksData ?? []).filter((t) => t.state === "open");
  const today = new Date().toISOString().slice(0, 10);
  const late = open.filter((t) => t.target_date && t.target_date < today);
  const packages = pkgData ?? [];
  const roll = rollupData ?? null;

  return (
    <Screen>
      <AppBar back="/" title={seat.project_name} sub={seat.address ?? seat.parent_name ?? undefined} />
      <div className="body">
        <div className="kicker">
          {manages ? "You run this" : seat.seat ?? "Your seat"} · {seat.status}
          {seat.stage ? ` · ${seat.stage}` : ""}
        </div>

        {/* The three numbers a GC checks first. */}
        <div className="tiles quad" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
          <Stat n={String(open.length)} label={open.length === 1 ? "open task" : "open tasks"} tone={late.length ? "status" : undefined} />
          <Stat n={String(packages.filter((p) => p.status === "open").length)} label="out to bid" />
          <Stat n={money(roll?.owed ?? seat.owed) ?? "—"} label="owed" />
        </div>
        {late.length > 0 && (
          <Notice kind="error" title={`${late.length} ${late.length === 1 ? "task is" : "tasks are"} late.`}>
            The oldest was due {shortDate(late.sort((a, b) => (a.target_date ?? "").localeCompare(b.target_date ?? ""))[0]!.target_date)}.
          </Notice>
        )}

        {/* Bids. The address rule applies here too: a trade invited to bid
            sees the town until they win it. */}
        <section className="stack" style={{ gap: 8 }}>
          <div className="divider-label">Bid packages · {packages.length}</div>
          {packages.length === 0 && (
            <Card soft pad><div className="small">Nothing out to bid. Creating a package is step 3 of the build order.</div></Card>
          )}
          {packages.map((p) => (
            <div className="home-row" key={p.id} style={{ cursor: "default" }}>
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="t">{p.category ?? p.trade ?? "Package"}</span>
                <span className="m" style={{ display: "block" }}>
                  {[p.trade, p.phase, p.reply_by ? `reply by ${shortDate(p.reply_by)}` : null]
                    .filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className={`tag ${p.status === "awarded" ? "tag-ok" : p.status === "open" ? "tag-status" : "tag-neutral"}`}>
                {p.status}
              </span>
            </div>
          ))}
          {packages.length > 0 && (
            <p className="tiny text-muted" style={{ margin: 0 }}>
              Invited trades see the <strong>town</strong> until the job is awarded to them — the same rule
              the whole community runs on.
            </p>
          )}
        </section>

        {/* Tasks. Full detail and closing arrive in step 2. */}
        <section className="stack" style={{ gap: 8 }}>
          <div className="divider-label">Open work · {open.length}</div>
          {open.length === 0 && <Card soft pad><div className="small">Nothing open on this project.</div></Card>}
          {open.slice(0, 12).map((t) => (
            <Card pad key={t.id} className="tight">
              <div className="between">
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="card-title" style={{ fontSize: 15 }}>{t.action}</div>
                  <div className="small text-muted">
                    {[t.trade, t.assignee ?? (manages ? "unassigned" : null), t.status !== "Not Started" ? t.status : null]
                      .filter(Boolean).join(" · ")}
                  </div>
                </div>
                {t.target_date && (
                  <span className={`tag ${t.target_date < today ? "tag-status" : "tag-neutral"}`} style={{ whiteSpace: "nowrap" }}>
                    {shortDate(t.target_date)}
                  </span>
                )}
              </div>
            </Card>
          ))}
          {open.length > 12 && (
            <p className="small text-muted" style={{ margin: 0 }}>
              …and {open.length - 12} more. <Link href="/tasks">The whole board</Link>.
            </p>
          )}
        </section>

        <Card soft pad>
          <div className="kicker">Next</div>
          <p className="small" style={{ margin: "6px 0 0" }}>
            Scope, site visits, crew days, the full task detail and the money screens are steps 2 to 6.
            Every one of them already has its database function — see <code>apps/builder/BUILD.md</code>.
          </p>
        </Card>
      </div>
      <BuildTabs current="board" tasks={board.tasks.filter((t) => t.state === "open").length} />
    </Screen>
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
