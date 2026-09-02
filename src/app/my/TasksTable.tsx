"use client";

import { useMemo, useState, Fragment } from "react";
import Link from "next/link";

export type TableTask = {
  id: string;
  action: string;
  status: string;
  priority: string | null;
  target_date: string | null;
  notes: string | null;
  project: string | null;
  who: "you" | "others";
};

const PRIORITY_ORDER = ["High", "Medium", "Low", "No Priority"];

// Filterable task table: scope, project, priority. A row click expands it
// in place (status + notes + the link into the full task page).
export function TasksTable({ tasks }: { tasks: TableTask[] }) {
  const [scope, setScope] = useState<"all" | "you" | "others">("you");
  const [project, setProject] = useState("all");
  const [priority, setPriority] = useState("all");
  const [open, setOpen] = useState<string | null>(null);

  const projects = useMemo(
    () => [...new Set(tasks.map((t) => t.project ?? "No project"))].sort(),
    [tasks]
  );

  const shown = tasks.filter(
    (t) =>
      (scope === "all" || t.who === scope) &&
      (project === "all" || (t.project ?? "No project") === project) &&
      (priority === "all" || (t.priority ?? "No Priority") === priority)
  );

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div className="btn-row" style={{ gap: 8 }}>
        <select className="input" value={scope} onChange={(e) => { setScope(e.target.value as typeof scope); setOpen(null); }} style={{ maxWidth: 130 }}>
          <option value="you">On you</option>
          <option value="others">On others</option>
          <option value="all">Everyone</option>
        </select>
        <select className="input" value={project} onChange={(e) => { setProject(e.target.value); setOpen(null); }} style={{ maxWidth: 190 }}>
          <option value="all">All projects</option>
          {projects.map((p) => <option key={p}>{p}</option>)}
        </select>
        <select className="input" value={priority} onChange={(e) => { setPriority(e.target.value); setOpen(null); }} style={{ maxWidth: 140 }}>
          <option value="all">Any priority</option>
          {PRIORITY_ORDER.map((p) => <option key={p}>{p}</option>)}
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
                <th>Priority</th>
                <th>Due</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((t) => (
                <Fragment key={t.id}>
                  <tr
                    onClick={() => setOpen(open === t.id ? null : t.id)}
                    style={{ cursor: "pointer" }}
                    aria-expanded={open === t.id}
                  >
                    <td><strong style={{ fontWeight: 600 }}>{t.action}</strong></td>
                    <td className="muted">{t.project ?? "—"}</td>
                    <td className="muted">{t.priority && t.priority !== "Missing" ? t.priority : "—"}</td>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>{t.target_date ?? "—"}</td>
                  </tr>
                  {open === t.id && (
                    <tr className="tasktable-expand">
                      <td colSpan={4}>
                        <div style={{ display: "grid", gap: 6, padding: "4px 0 8px" }}>
                          <span className="small">
                            <span className="extra-chip">{t.status}</span>
                            {t.who === "you" && <span className="extra-chip" style={{ marginLeft: 6 }}>on you</span>}
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
