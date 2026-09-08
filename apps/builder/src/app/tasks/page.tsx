import Link from "next/link";
import { redirect } from "next/navigation";
import { AppBar, Card, Notice, Screen, ShellIcons } from "@shared/ui";
import { shortDate } from "@shared/format";
import { stopwatch } from "@shared/perf";
import { getBoard, runs, type Task } from "@/lib/me";
import { BuildTabs } from "@/components/BuildTabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tasks" };

// Everything open across every project, ordered by what is late. A GC's
// question is never "what tasks exist" - it is "what is behind, and whose".
// portal_tasks already returns the assignee, the trade and whether the work
// is contract-backed, so the grouping is free.
type Group = { key: string; label: string; rows: Task[] };

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ who?: string }> }) {
  const { who } = await searchParams;
  const w = stopwatch("/tasks");
  const board = await w.step("board", () => getBoard());
  w.done();
  if (!board.signed_in) redirect("/login?next=/tasks");

  const mineOnly = who === "me";
  const seatById = new Map(board.seats.map((s) => [s.project_id, s]));
  const contact = board.me?.contact_id ?? null;

  const open = board.tasks
    .filter((t) => t.state === "open")
    .filter((t) => !mineOnly || (contact && t.assignee_id === contact));

  const today = new Date().toISOString().slice(0, 10);
  const late = open.filter((t) => t.target_date && t.target_date < today);
  const soon = open.filter((t) => t.target_date && t.target_date >= today);
  const undated = open.filter((t) => !t.target_date);

  const groups: Group[] = [
    { key: "late", label: "Late", rows: late.sort((a, b) => (a.target_date ?? "").localeCompare(b.target_date ?? "")) },
    { key: "soon", label: "Coming up", rows: soon.sort((a, b) => (a.target_date ?? "").localeCompare(b.target_date ?? "")) },
    { key: "undated", label: "No date", rows: undated },
  ].filter((g) => g.rows.length > 0);

  const mineCount = contact ? board.tasks.filter((t) => t.state === "open" && t.assignee_id === contact).length : 0;

  return (
    <Screen>
      <AppBar brand right={<ShellIcons gearHref="/settings" inboxHref="/inbox" />} />
      <div className="body">
        {board.degraded && <Notice kind="error" title="Some of this may be missing.">Try again in a moment.</Notice>}
        <div className="hero">
          <h1>Open work</h1>
          <p className="lead">
            {open.length === 0
              ? mineOnly ? "Nothing assigned to you right now." : "Nothing open across your projects."
              : `${open.length} open${late.length ? `, ${late.length} late` : ""}, across ${new Set(open.map((t) => t.project_id)).size} ${new Set(open.map((t) => t.project_id)).size === 1 ? "project" : "projects"}.`}
          </p>
        </div>

        <nav className="chips" aria-label="Whose tasks">
          <Link href="/tasks" aria-current={!mineOnly ? "page" : undefined}
            className={`tag ${!mineOnly ? "" : "tag-neutral"}`} style={{ textDecoration: "none", padding: "7px 12px", fontSize: 12 }}>
            Everyone · {board.tasks.filter((t) => t.state === "open").length}
          </Link>
          <Link href="/tasks?who=me" aria-current={mineOnly ? "page" : undefined}
            className={`tag ${mineOnly ? "" : "tag-neutral"}`} style={{ textDecoration: "none", padding: "7px 12px", fontSize: 12 }}>
            On me · {mineCount}
          </Link>
        </nav>

        {groups.map((g) => (
          <section className="stack" style={{ gap: 8 }} key={g.key}>
            <div className="divider-label">{g.label} · {g.rows.length}</div>
            {g.rows.map((t) => {
              const seat = t.project_id ? seatById.get(t.project_id) : undefined;
              const runsIt = seat ? runs(seat) : false;
              return (
                <Card pad key={t.id} className="tight">
                  <div className="between">
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="card-title" style={{ fontSize: 15 }}>{t.action}</div>
                      <div className="small text-muted">
                        {t.project_id
                          ? <Link href={`/project/${t.project_id}`}>{t.project ?? "Project"}</Link>
                          : (t.project ?? "No project")}
                        {t.trade ? ` · ${t.trade}` : ""}
                        {t.assignee ? ` · ${t.assignee}` : runsIt ? " · unassigned" : ""}
                        {t.status && t.status !== "Not Started" ? ` · ${t.status}` : ""}
                      </div>
                    </div>
                    {t.target_date && (
                      <span className={`tag ${g.key === "late" ? "tag-status" : "tag-neutral"}`} style={{ whiteSpace: "nowrap" }}>
                        {shortDate(t.target_date)}
                      </span>
                    )}
                  </div>
                </Card>
              );
            })}
          </section>
        ))}

        {open.length === 0 && (
          <Card soft pad>
            <div className="small">
              {mineOnly ? <>Nothing on you. <Link href="/tasks">See everyone&apos;s</Link>.</> : "All clear across every project you hold a seat on."}
            </div>
          </Card>
        )}
      </div>
      <BuildTabs current="tasks" tasks={board.tasks.filter((t) => t.state === "open").length} />
    </Screen>
  );
}
