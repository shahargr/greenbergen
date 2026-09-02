"use client";

import { useMemo, useState, Fragment } from "react";
import Link from "next/link";

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
  state: "open" | "closed";
  trade: string | null;
  assignee: string | null;
};

const PRIORITY_ORDER = ["High", "Medium", "Low", "No Priority"];

// Filterable task table: state (open/closed), scope, project, trade, and
// person - so "what do Javier and I have, open and closed, latest first"
// is three dropdowns. A row click expands it in place with the link into
// the full task page.
export function TasksTable({ tasks }: { tasks: TableTask[] }) {
  const [state, setState] = useState<"open" | "closed" | "all">("open");
  const [scope, setScope] = useState<"all" | "you" | "others">("you");
  const [project, setProject] = useState("all");
  const [trade, setTrade] = useState("all");
  const [person, setPerson] = useState("all");
  const [priority, setPriority] = useState("all");
  const [sort, setSort] = useState<"due" | "updated">("due");
  const [open, setOpen] = useState<string | null>(null);

  const projects = useMemo(
    () => [...new Set(tasks.map((t) => t.project ?? "No project"))].sort(),
    [tasks]
  );
  const trades = useMemo(
    () => [...new Set(tasks.map((t) => t.trade).filter((x): x is string => !!x))].sort(),
    [tasks]
  );
  const people = useMemo(
    () => [...new Set(tasks.map((t) => t.assignee).filter((x): x is string => !!x))].sort(),
    [tasks]
  );

  const shown = tasks
    .filter(
      (t) =>
        (state === "all" || t.state === state) &&
        (scope === "all" || t.who === scope) &&
        (project === "all" || (t.project ?? "No project") === project) &&
        (trade === "all" || t.trade === trade) &&
        (person === "all" || t.assignee === person) &&
        (priority === "all" || (t.priority ?? "No Priority") === priority)
    )
    .sort((a, b) =>
      sort === "updated"
        ? (b.last_updated ?? "").localeCompare(a.last_updated ?? "")
        : (a.target_date ?? "9999").localeCompare(b.target_date ?? "9999")
    );

  const pick = (setter: (v: never) => void) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    (setter as (v: string) => void)(e.target.value);
    setOpen(null);
  };

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div className="btn-row" style={{ gap: 8 }}>
        <select className="input" value={state} onChange={pick(setState)} style={{ maxWidth: 110 }}>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="all">All</option>
        </select>
        <select className="input" value={scope} onChange={pick(setScope)} style={{ maxWidth: 125 }}>
          <option value="you">On you</option>
          <option value="others">On others</option>
          <option value="all">Everyone</option>
        </select>
        <select className="input" value={project} onChange={pick(setProject)} style={{ maxWidth: 170 }}>
          <option value="all">All projects</option>
          {projects.map((p) => <option key={p}>{p}</option>)}
        </select>
        <select className="input" value={trade} onChange={pick(setTrade)} style={{ maxWidth: 150 }}>
          <option value="all">All trades</option>
          {trades.map((t) => <option key={t}>{t}</option>)}
        </select>
        <select className="input" value={person} onChange={pick(setPerson)} style={{ maxWidth: 170 }}>
          <option value="all">Anyone</option>
          {people.map((p) => <option key={p}>{p}</option>)}
        </select>
        <select className="input" value={priority} onChange={pick(setPriority)} style={{ maxWidth: 135 }}>
          <option value="all">Any priority</option>
          {PRIORITY_ORDER.map((p) => <option key={p}>{p}</option>)}
        </select>
        <select className="input" value={sort} onChange={pick(setSort)} style={{ maxWidth: 150 }}>
          <option value="due">By due date</option>
          <option value="updated">By last update</option>
        </select>
      </div>

      {shown.length === 0 ? (
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
