"use client";

import { useMemo, useState, Fragment } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TradeIcon } from "@/components/TradeIcon";

export type TableTask = {
  id: string;
  action: string;
  status: string;
  priority: string | null;
  target_date: string | null;
  last_updated: string | null;
  notes: string | null;
  project: string | null;
  who: "you" | "others";
  project_id?: string | null;
  domain: string | null;
  state: "open" | "closed";
  trade: string | null;
  assignee: string | null;
};

const PRIORITY_ORDER = ["High", "Medium", "Low", "No Priority"];

// Filterable task table: state (open/closed), scope, project, trade, and
// person - so "what do Javier and I have, open and closed, latest first"
// is three dropdowns. A row click expands it in place with the link into
// the full task page.
export function TasksTable({ tasks, initialProject, initialDomain, initialState, syncUrl = false, showTradeTiles = true, compact = false, addTaskSlot, domainOptions, todayIso }: {
  tasks: TableTask[];
  initialProject?: string;
  initialDomain?: string;
  initialState?: "open" | "closed" | "all";
  syncUrl?: boolean;
  showTradeTiles?: boolean;
  compact?: boolean;
  addTaskSlot?: React.ReactNode;
  domainOptions?: string[];
  todayIso: string;
}) {
  const router = useRouter();
  // compact mode: the table stays hidden until a view is picked.
  const [view, setView] = useState<"none" | "mine" | "late" | "all">(compact ? "none" : "all");
  const [state, setState] = useState<"open" | "closed" | "all">(initialState ?? "open");
  const [domain, setDomain] = useState(initialDomain ?? "construction");
  const [project, setProject] = useState(initialProject ?? "all");
  const [trade, setTrade] = useState("all");
  const [person, setPerson] = useState("all");
  const [priority, setPriority] = useState("all");
  const [sort, setSort] = useState<"due" | "updated">("due");
  const [open, setOpen] = useState<string | null>(null);

  const projects = useMemo(
    () => [...new Set(tasks.map((t) => t.project ?? "No project"))].sort(),
    [tasks]
  );
  // Only the domains actually present (or an explicit admin-provided set);
  // never the hardcoded internal list.
  const domains = useMemo(
    () => domainOptions ?? [...new Set(tasks.map((t) => t.domain).filter((x): x is string => !!x))].sort(),
    [tasks, domainOptions]
  );
  const people = useMemo(
    () => [...new Set(tasks.map((t) => t.assignee).filter((x): x is string => !!x))].sort(),
    [tasks]
  );

  // Trade tiles: open/overdue/total per trade within the selected project.
  const tradeStats = useMemo(() => {
    const m = new Map<string, { open: number; overdue: number; total: number }>();
    for (const t of tasks) {
      if (project !== "all" && (t.project ?? "No project") !== project) continue;
      if (!t.trade) continue;
      const s0 = m.get(t.trade) ?? { open: 0, overdue: 0, total: 0 };
      s0.total += 1;
      if (t.state === "open") {
        s0.open += 1;
        if (t.target_date && t.target_date < todayIso) s0.overdue += 1;
      }
      m.set(t.trade, s0);
    }
    return [...m.entries()].filter(([, st]) => st.open > 0).sort((a, b) => b[1].open - a[1].open);
  }, [tasks, project, todayIso]);

  const shown = tasks
    .filter(
      (t) =>
        (state === "all" || t.state === state) &&
        (domain === "all" || t.domain === domain) &&
        (project === "all" || (t.project ?? "No project") === project) &&
        (trade === "all" || t.trade === trade) &&
        (person === "all" || t.assignee === person) &&
        (priority === "all" || (t.priority ?? "No Priority") === priority) &&
        (view !== "mine" || t.who === "you") &&
        (view !== "late" || (t.state === "open" && !!t.target_date && t.target_date < todayIso))
    )
    .sort((a, b) =>
      view === "late"
        ? (a.target_date ?? "9999").localeCompare(b.target_date ?? "9999")
        : sort === "updated"
          ? (b.last_updated ?? "").localeCompare(a.last_updated ?? "")
          : (a.target_date ?? "9999").localeCompare(b.target_date ?? "9999")
    );
  const tableVisible = !compact || view !== "none" || trade !== "all";

  const pick = (setter: (v: never) => void) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    (setter as (v: string) => void)(e.target.value);
    setOpen(null);
  };
  const pickServer = (kind: "domain" | "state") => (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    if (kind === "domain") setDomain(v); else setState(v as "open" | "closed" | "all");
    setOpen(null);
    if (syncUrl) {
      const d = kind === "domain" ? v : domain;
      const st = kind === "state" ? v : state;
      router.replace(`/my/tasks?domain=${encodeURIComponent(d)}&state=${st}`);
    }
  };

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {compact && (
        <div className="halfrow">
          <details className="card" style={{ margin: 0 }}>
            <summary style={{ cursor: "pointer", fontWeight: 700 }}>＋ Add a task</summary>
            <div style={{ marginTop: 10 }}>{addTaskSlot}</div>
          </details>
          <details className="card" style={{ margin: 0 }}>
            <summary style={{ cursor: "pointer", fontWeight: 700 }}>Filters</summary>
            <div className="filterbar" style={{ marginTop: 10 }}>
              <select value={project} onChange={(e) => { pick(setProject)(e); setView("all"); }}>
                <option value="all">All projects</option>
                {projects.map((p) => <option key={p}>{p}</option>)}
              </select>
              {domains.length > 1 && (
                <select value={domain} onChange={pickServer("domain")}>
                  <option value="all">All domains</option>
                  {domains.map((d) => <option key={d}>{d}</option>)}
                </select>
              )}
              <select value={state} onChange={pickServer("state")}>
                <option value="open">Open</option>
                <option value="closed">Closed</option>
                <option value="all">All</option>
              </select>
              <select value={person} onChange={(e) => { pick(setPerson)(e); setView("all"); }}>
                <option value="all">Anyone</option>
                {people.map((p) => <option key={p}>{p}</option>)}
              </select>
              <select value={priority} onChange={(e) => { pick(setPriority)(e); setView("all"); }}>
                <option value="all">Any priority</option>
                {PRIORITY_ORDER.map((p) => <option key={p}>{p}</option>)}
              </select>
              <select value={sort} onChange={pick(setSort)}>
                <option value="due">By due date</option>
                <option value="updated">By last update</option>
              </select>
            </div>
          </details>
        </div>
      )}

      <div className="btn-row" style={{ gap: 6 }}>
        <button type="button" className={view === "mine" ? "btn small" : "btn ghost small"}
          onClick={() => { setView(view === "mine" ? "none" : "mine"); setOpen(null); }}>
          My tasks
        </button>
        <button type="button" className={view === "late" ? "btn small" : "btn ghost small"}
          onClick={() => { setView(view === "late" ? "none" : "late"); setOpen(null); }}>
          Late tasks
        </button>
        <button type="button" className={view === "all" ? "btn small" : "btn ghost small"}
          onClick={() => { setView(view === "all" ? "none" : "all"); setOpen(null); }}>
          Full list
        </button>
      </div>

      {!compact && (
      <div className="filterbar">
        <select value={project} onChange={pick(setProject)}>
          <option value="all">All projects</option>
          {projects.map((p) => <option key={p}>{p}</option>)}
        </select>
        {domains.length > 1 && (
          <select value={domain} onChange={pickServer("domain")}>
            <option value="all">All domains</option>
            {domains.map((d) => <option key={d}>{d}</option>)}
          </select>
        )}
        <select value={state} onChange={pickServer("state")}>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="all">All</option>
        </select>
        <select value={person} onChange={pick(setPerson)}>
          <option value="all">Anyone</option>
          {people.map((p) => <option key={p}>{p}</option>)}
        </select>
        <select value={priority} onChange={pick(setPriority)}>
          <option value="all">Any priority</option>
          {PRIORITY_ORDER.map((p) => <option key={p}>{p}</option>)}
        </select>
        <select value={sort} onChange={pick(setSort)}>
          <option value="due">By due date</option>
          <option value="updated">By last update</option>
        </select>
      </div>
      )}

      {showTradeTiles && tradeStats.length > 0 && (
        <div className="tradestat-grid">
          {tradeStats.map(([tr, st]) => (
            <button
              key={tr}
              type="button"
              className={trade === tr ? "tradestat on" : "tradestat"}
              onClick={() => { setTrade(trade === tr ? "all" : tr); if (trade === tr) setView(compact ? "none" : view); else setView("all"); setOpen(null); }}
            >
              <span className="tradestat-icon"><TradeIcon trade={tr} /></span>
              <span className="tradestat-text">
                <span className="tradestat-name">{tr}</span>
                <span className="tradestat-nums">
                  <strong>{st.open}</strong> open
                  {st.overdue > 0 && <span className="tradestat-late"> · {st.overdue} late</span>}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}

      {!tableVisible ? null : shown.length === 0 ? (
        <p className="muted small" style={{ margin: 0 }}>Nothing matches these filters.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="tasktable">
            <thead>
              <tr>
                <th>Task</th>
                <th>Project</th>
                <th>Trade</th>
                <th>{sort === "updated" ? "Updated" : "Due"}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => (
                <Fragment key={t.id}>
                  <tr
                    onClick={() => setOpen(open === t.id ? null : t.id)}
                    style={{ cursor: "pointer", opacity: t.state === "closed" ? 0.65 : 1 }}
                    aria-expanded={open === t.id}
                  >
                    <td><strong style={{ fontWeight: 600 }}>{t.action}</strong></td>
                    <td className="muted">{t.project ?? "—"}</td>
                    <td className="muted">{t.trade ?? "—"}</td>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>
                      {sort === "updated"
                        ? (t.last_updated ? t.last_updated.slice(0, 10) : "—")
                        : (t.target_date ?? "—")}
                    </td>
                  </tr>
                  {open === t.id && (
                    <tr className="tasktable-expand">
                      <td colSpan={4}>
                        <div style={{ display: "grid", gap: 6, padding: "4px 0 8px" }}>
                          <span className="small" style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
                            <span className="extra-chip">{t.status}</span>
                            {t.priority && t.priority !== "Missing" && <span className="extra-chip">{t.priority}</span>}
                            {t.assignee && <span className="extra-chip">→ {t.assignee}</span>}
                            {t.who === "you" && <span className="extra-chip">on you</span>}
                          </span>
                          <span className="muted small">
                            {t.target_date && <>Due {t.target_date} · </>}
                            {t.last_updated && <>Updated {t.last_updated.slice(0, 10)}</>}
                          </span>
                          {t.notes && (
                            <span className="muted small" style={{ whiteSpace: "pre-line" }}>
                              {t.notes.length > 400 ? t.notes.slice(0, 400) + "…" : t.notes}
                            </span>
                          )}
                          <span>
                            <Link className="btn ghost small" href={`/my/task/${t.id}`}>Open task →</Link>
                          </span>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
