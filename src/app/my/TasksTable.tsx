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
export function TasksTable({ tasks, initialProject, initialDomain, initialState, syncUrl = false, showTradeTiles = true, todayIso }: {
  tasks: TableTask[];
  initialProject?: string;
  initialDomain?: string;
  initialState?: "open" | "closed" | "all";
  syncUrl?: boolean;
  showTradeTiles?: boolean;
  todayIso: string;
}) {
  const router = useRouter();
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
  const domains = useMemo(
    () => [...new Set(["construction", "system", "cloudhiro", "personal",
      ...tasks.map((t) => t.domain).filter((x): x is string => !!x)])],
    [tasks]
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
    return [...m.entries()].sort((a, b) => b[1].open - a[1].open);
  }, [tasks, project, todayIso]);

  const shown = tasks
    .filter(
      (t) =>
        (state === "all" || t.state === state) &&
        (domain === "all" || t.domain === domain) &&
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
      <div className="btn-row" style={{ gap: 8 }}>
        <select className="input" value={project} onChange={pick(setProject)} style={{ maxWidth: 190 }}>
          <option value="all">All projects</option>
          {projects.map((p) => <option key={p}>{p}</option>)}
        </select>
        <select className="input" value={domain} onChange={pickServer("domain")} style={{ maxWidth: 140 }}>
          <option value="all">All domains</option>
          {domains.map((d) => <option key={d}>{d}</option>)}
        </select>
        <select className="input" value={state} onChange={pickServer("state")} style={{ maxWidth: 110 }}>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="all">All</option>
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

      {showTradeTiles && tradeStats.length > 0 && (
        <div className="tradestat-grid">
          {tradeStats.map(([tr, st]) => (
            <button
              key={tr}
              type="button"
              className={trade === tr ? "tradestat on" : "tradestat"}
              onClick={() => { setTrade(trade === tr ? "all" : tr); setOpen(null); }}
            >
              <span className="tradestat-icon"><TradeIcon trade={tr} /></span>
              <span className="tradestat-name">{tr}</span>
              <span className="tradestat-nums">
                <strong>{st.open}</strong> open
                {st.overdue > 0 && <span className="tradestat-late"> · {st.overdue} late</span>}
                <span className="muted"> · {st.total}</span>
              </span>
            </button>
          ))}
        </div>
      )}

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
