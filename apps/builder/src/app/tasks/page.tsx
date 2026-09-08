import Link from "next/link";
import { redirect } from "next/navigation";
import { AppBar, Card, Notice, Screen, ShellIcons } from "@shared/ui";
import { shortDate } from "@shared/format";
import { stopwatch } from "@shared/perf";
import { getBoard, priorityRank, topLevels, type Task } from "@/lib/me";
import { BuildTabs } from "@/components/BuildTabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tasks" };

// Everything open, grouped the way the work is grouped. A flat list of 164
// tasks is not a task list, it is a wall - and the shape of the data proves
// it: 122 of them sit on one job. So the page groups by property, then by
// job, and only unfolds what is actually behind.
//
// A GC's question is never "what tasks exist" - it is "what is late, whose
// is it, and which job is it on". portal_tasks already returns the assignee,
// the trade, the priority and the project, so all three answers are free.
const today = () => new Date().toISOString().slice(0, 10);

type Sub = { key: string; label: string; rows: Task[]; late: number };
type Group = { key: string; label: string; subs: Sub[]; open: number; late: number };

const CAP = 10; // rows per job before the group sends you to its own page

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ who?: string; show?: string; project?: string }>;
}) {
  const { who, show, project } = await searchParams;
  const w = stopwatch("/tasks");
  const board = await w.step("board", () => getBoard());
  w.done();
  if (!board.signed_in) redirect("/login?next=/tasks");

  const now = today();
  const isLate = (t: Task) => !!t.target_date && t.target_date < now;
  const mineOnly = who === "me";
  const contact = board.me?.contact_id ?? null;
  const { map: topOf } = topLevels(board.seats);

  const allOpen = board.tasks.filter((t) => t.state === "open");
  const byWho = allOpen.filter((t) => !mineOnly || (contact && t.assignee_id === contact));

  // Counts on the chips describe what the chip would show, so they are taken
  // before that chip's own filter is applied.
  const lateCount = byWho.filter(isLate).length;
  const highCount = byWho.filter((t) => t.priority === "High").length;

  const groupOf = (t: Task) => {
    const top = t.project_id ? topOf.get(t.project_id) : undefined;
    return {
      key: top?.project_id ?? t.project_id ?? "none",
      label: top?.project_name ?? t.project ?? "No project",
    };
  };

  const rows = byWho
    .filter((t) => (show === "late" ? isLate(t) : show === "high" ? t.priority === "High" : true))
    .filter((t) => !project || groupOf(t).key === project);

  // Late first and oldest first, then everything dated, then the undated by
  // priority - an undated task has nothing else to order it by.
  const bucket = (t: Task) => (isLate(t) ? 0 : t.target_date ? 1 : 2);
  const order = (a: Task, b: Task) =>
    bucket(a) - bucket(b) ||
    (a.target_date ?? "").localeCompare(b.target_date ?? "") ||
    priorityRank(a.priority) - priorityRank(b.priority) ||
    a.action.localeCompare(b.action);

  const groups: Group[] = [];
  const index = new Map<string, Group>();
  for (const t of rows) {
    const g = groupOf(t);
    let grp = index.get(g.key);
    if (!grp) {
      grp = { key: g.key, label: g.label, subs: [], open: 0, late: 0 };
      index.set(g.key, grp);
      groups.push(grp);
    }
    const subKey = t.project_id ?? "none";
    let sub = grp.subs.find((s) => s.key === subKey);
    if (!sub) {
      sub = { key: subKey, label: t.project ?? "No project", rows: [], late: 0 };
      grp.subs.push(sub);
    }
    sub.rows.push(t);
    grp.open += 1;
    if (isLate(t)) { grp.late += 1; sub.late += 1; }
  }
  // What is behind comes first; after that, where the work is.
  groups.sort((a, b) => b.late - a.late || b.open - a.open || a.label.localeCompare(b.label));
  for (const g of groups) {
    g.subs.sort((a, b) => b.late - a.late || b.rows.length - a.rows.length || a.label.localeCompare(b.label));
    for (const s of g.subs) s.rows.sort(order);
  }

  const focused = !!project;
  const heading = focused ? groups[0]?.label ?? "Nothing here" : "Open work";
  // Where a task should send you when you are done with it: back to exactly
  // this list, filters and all.
  const here = (() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ who, show, project })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/tasks?${s}` : "/tasks";
  })();
  const q = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { who, show, project, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/tasks?${s}` : "/tasks";
  };

  return (
    <Screen>
      {focused
        ? <AppBar back={q({ project: undefined })} title={heading} sub={`${rows.length} open`} />
        : <AppBar brand right={<ShellIcons gearHref="/settings" inboxHref="/inbox" />} />}
      <div className="body">
        {board.degraded && <Notice kind="error" title="Some of this may be missing.">Try again in a moment.</Notice>}

        {!focused && (
          <div className="hero">
            <h1>Open work</h1>
            <p className="lead">
              {rows.length === 0
                ? mineOnly ? "Nothing assigned to you right now." : "Nothing open across your projects."
                : `${rows.length} open${lateCount ? `, ${lateCount} late` : ""}, across ${groups.length} ${groups.length === 1 ? "property" : "properties"}.`}
            </p>
          </div>
        )}

        <nav className="chips" aria-label="Whose tasks">
          <Chip href={q({ who: undefined })} on={!mineOnly} label={`Everyone · ${allOpen.length}`} />
          <Chip href={q({ who: "me" })} on={mineOnly}
            label={`On me · ${contact ? allOpen.filter((t) => t.assignee_id === contact).length : 0}`} />
        </nav>

        {/* Priority and lateness are the two things that decide what to do
            next, so they are filters and not just badges. */}
        <nav className="chips" aria-label="Which tasks">
          <Chip href={q({ show: undefined })} on={!show} label="All" />
          <Chip href={q({ show: "late" })} on={show === "late"} label={`Late · ${lateCount}`} />
          <Chip href={q({ show: "high" })} on={show === "high"} label={`High · ${highCount}`} />
        </nav>

        {groups.map((g) => {
          // A property with late work opens itself; the rest stay folded, so
          // the page starts at what is behind rather than at everything.
          const open = focused || g.late > 0 || groups.length === 1;
          return (
            <details key={g.key} open={open} className="branch">
              <summary className="divider-label" style={{ cursor: "pointer", marginBottom: 4 }}>
                {g.label} · {g.open}{g.late ? ` · ${g.late} late` : ""}
              </summary>
              <div className="stack" style={{ gap: 10 }}>
                {g.subs.map((s) => (
                  <div className="stack" style={{ gap: 6 }} key={s.key}>
                    {g.subs.length > 1 && (
                      <div className="tiny text-muted" style={{ paddingLeft: 2 }}>
                        {s.label} · {s.rows.length}{s.late ? ` · ${s.late} late` : ""}
                      </div>
                    )}
                    {(focused ? s.rows : s.rows.slice(0, CAP)).map((t) => (
                      <Row key={t.id} t={t} late={isLate(t)} back={here} />
                    ))}
                    {!focused && s.rows.length > CAP && (
                      <p className="small text-muted" style={{ margin: "0 0 2px" }}>
                        …and {s.rows.length - CAP} more.{" "}
                        <Link href={q({ project: g.key })}>Open {g.label}</Link>.
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </details>
          );
        })}

        {rows.length === 0 && (
          <Card soft pad>
            <div className="small">
              {show || mineOnly
                ? <>Nothing matches that. <Link href="/tasks">Show everything open</Link>.</>
                : "All clear across every project you hold a seat on."}
            </div>
          </Card>
        )}
      </div>
      <BuildTabs current="tasks" tasks={allOpen.length} />
    </Screen>
  );
}

function Chip({ href, on, label }: { href: string; on: boolean; label: string }) {
  return (
    <Link href={href} aria-current={on ? "page" : undefined}
      className={`tag ${on ? "" : "tag-neutral"}`}
      style={{ textDecoration: "none", padding: "7px 12px", fontSize: 12 }}>
      {label}
    </Link>
  );
}

// Priority earns a badge only when it says something: High and Low do,
// Medium is the default and unset is unknown. Sixty-nine red pills would
// tell you nothing.
function Row({ t, late, back }: { t: Task; late: boolean; back: string }) {
  const meta = [
    t.trade,
    t.assignee ?? "unassigned",
    t.status && t.status !== "Not Started" ? t.status : null,
  ].filter(Boolean) as string[];
  return (
    <Link href={`/task/${t.id}?back=${encodeURIComponent(back)}`}
      style={{ textDecoration: "none", color: "inherit", display: "block" }}>
      <Card pad className="tight">
        <div className="between">
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="card-title" style={{ fontSize: 15 }}>{t.action}</div>
            <div className="small text-muted">{meta.join(" · ")}</div>
          </div>
          <span className="stack" style={{ gap: 4, alignItems: "flex-end" }}>
            {t.target_date && (
              <span className={`tag ${late ? "tag-status" : "tag-neutral"}`} style={{ whiteSpace: "nowrap" }}>
                {shortDate(t.target_date)}
              </span>
            )}
            {t.priority === "High" && <span className="tag tag-outline">High</span>}
            {t.priority === "Low" && <span className="tag tag-neutral">Low</span>}
          </span>
        </div>
      </Card>
    </Link>
  );
}
