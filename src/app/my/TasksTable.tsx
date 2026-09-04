"use client";

import { useMemo, useState, useEffect, Fragment } from "react";
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
  // Subtask linkage: the parent this row hangs under, and this row's own
  // open-children count (so parents can show a "N subtasks" chip).
  parent_id?: string | null;
  parent?: string | null;
  open_children?: number;
};

const PRIORITY_ORDER = ["High", "Medium", "Low", "No Priority"];

// Construction phases, and which trade falls in each (tasks have no phase
// field, so phase is derived from the task's trade).
const PHASES = ["Site prep", "Rough", "Systems", "Appliance", "Finish", "Outside"] as const;
const PHASE_OF: Record<string, string> = {
  Excavation: "Site prep", Demolition: "Site prep", Masonry: "Site prep", "Portable toilet": "Site prep",
  Framing: "Rough", Insulation: "Rough",
  Plumbing: "Systems", Electrical: "Systems", HVAC: "Systems",
  Appliances: "Appliance", "Water Systems": "Appliance", "Water Heater": "Appliance",
  Drywall: "Finish", Painting: "Finish", Flooring: "Finish", "Interior Design": "Finish", Windows: "Finish", Tile: "Finish", Trim: "Finish", Cabinets: "Finish",
  Landscaping: "Outside", Hardscaping: "Outside", Roofing: "Outside", Gutters: "Outside", Driveway: "Outside", Pools: "Outside", Fencing: "Outside",
};
const phaseOf = (trade: string | null) => (trade ? PHASE_OF[trade] ?? null : null);

// When the project's budget stages drive the tiles, tasks map into a stage
// by their trade. The token is matched against the project's own phase names
// (e.g. "3. Rough") so this works whatever the exact phase label is.
const STAGE_TOKEN: Record<string, string> = {
  Excavation: "pre", Demolition: "pre", "Portable toilet": "pre",
  Masonry: "rough", Framing: "rough", Insulation: "rough",
  Plumbing: "rough", Electrical: "rough", HVAC: "rough", Drywall: "rough",
  Roofing: "rough", Gutters: "rough", Windows: "rough", Tile: "rough",
  Painting: "finish", Flooring: "finish", Cabinets: "finish", Trim: "finish",
  "Interior Design": "finish", Appliances: "finish", "Water Systems": "finish", "Water Heater": "finish",
  Landscaping: "hardscape", Hardscaping: "hardscape", Driveway: "hardscape", Fencing: "hardscape", Pools: "hardscape",
};
const tileMoney = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(n >= 1e7 ? 0 : 1)}M`
    : n >= 1000 ? `$${Math.round(n / 1000)}k`
    : `$${Math.round(n)}`;
export type StageTile = { key: string; label: string; budget: number; actual: number };
const PHASE_ICON: Record<string, React.ReactNode> = {
  "Site prep": <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 20h18" /><path d="M4 20V9l6-3 6 3v11" /><path d="M9 20v-5h2v5" /><path d="m14 6 3-2 3 6-3 1z" /></svg>,
  "Rough": <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 21V8l8-4 8 4v13" /><path d="M8 21v-7h8v7" /><path d="M12 4v6M4 12h16" /></svg>,
  "Systems": <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3v6a3 3 0 0 0 3 3h6" /><path d="M18 21v-6a3 3 0 0 0-3-3H9" /><circle cx="6" cy="3" r="1.5" /><circle cx="18" cy="21" r="1.5" /></svg>,
  "Appliance": <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 7h6" /><circle cx="12" cy="14" r="3" /></svg>,
  "Finish": <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="3" width="14" height="6" rx="1" /><path d="M19 5h2v5H12v4" /><rect x="10.5" y="14" width="3" height="7" rx="1" /></svg>,
  "Outside": <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 7 11h3l-4 7h12l-4-7h3z" /><path d="M12 18v3" /></svg>,
};

// Filterable task table: state (open/closed), scope, project, trade, and
// person - so "what do Javier and I have, open and closed, latest first"
// is three dropdowns. A row click expands it in place with the link into
// the full task page.
export function TasksTable({ tasks, initialProject, initialDomain, initialState, initialView, initialParent, syncUrl = false, showTradeTiles = true, showLatePanels = false, compact = false, addTaskSlot, addOpen = false, domainOptions, savedFilters = false, filtersInSetup = false, showViews = true, startEmpty = false, stageTiles, avatars, todayIso }: {
  // Project page: the filter dropdowns live behind each saved slot's ⚙, not
  // on the page. Three slot buttons stay; setup picks the filters + a name.
  filtersInSetup?: boolean;
  // Hide the five quick views (Urgent / My tasks / Late / Stuck / Full list).
  showViews?: boolean;
  // Start with an empty list; it fills when a late-person tile or a saved
  // filter is clicked (project page).
  startEmpty?: boolean;
  tasks: TableTask[];
  initialProject?: string;
  initialDomain?: string;
  initialState?: "open" | "closed" | "all";
  initialView?: "all" | "mine" | "late" | "stuck" | "urgent";
  showLatePanels?: boolean;
  // Display name -> public photo URL; people without one keep the icon.
  avatars?: Record<string, string>;
  // Start filtered to this parent's subtasks (from ?parent= on the project page).
  initialParent?: string | null;
  syncUrl?: boolean;
  showTradeTiles?: boolean;
  compact?: boolean;
  addTaskSlot?: React.ReactNode;
  // Start with the add-task panel unfolded (e.g. ?assign= landed here).
  addOpen?: boolean;
  domainOptions?: string[];
  savedFilters?: boolean;
  stageTiles?: StageTile[];
  todayIso: string;
}) {
  // Stage mode: budget-bearing tiles from the project's own budget stages,
  // replacing the derived trade-phase tiles. Tasks map to a stage by trade.
  const stageMode = !!stageTiles && stageTiles.length > 0;
  const tradeStage = useMemo(() => {
    const map: Record<string, string> = {};
    if (!stageTiles) return map;
    const findKey = (token: string) =>
      stageTiles.find((s) => {
        const hay = `${s.key} ${s.label}`.toLowerCase();
        return hay.includes(token) || (token === "hardscape" && hay.includes("landscape"));
      })?.key;
    for (const [trade, token] of Object.entries(STAGE_TOKEN)) {
      const k = findKey(token);
      if (k) map[trade] = k;
    }
    return map;
  }, [stageTiles]);
  const stageOf = (trade: string | null) => (trade ? tradeStage[trade] ?? null : null);
  const router = useRouter();
  // compact mode: the table stays hidden until a view is picked.
  const [view, setView] = useState<"none" | "mine" | "late" | "stuck" | "urgent" | "all">(compact || startEmpty ? "none" : (initialView ?? "all"));
  const [state, setState] = useState<"open" | "closed" | "all">(initialState ?? "open");
  const [domain, setDomain] = useState(initialDomain ?? "construction");
  const [project, setProject] = useState(initialProject ?? "all");
  const [trade, setTrade] = useState("all");
  const [person, setPerson] = useState("all");
  const [priority, setPriority] = useState("all");
  const [phase, setPhase] = useState("all");
  const [sort, setSort] = useState<"due" | "updated">("due");
  const [open, setOpen] = useState<string | null>(null);
  // Free-text search: type "plum" and every plumbing task lists below.
  const [search, setSearch] = useState("");
  // Panels run four to a row. Two rows is the cap; the rest hide behind "…".
  const [allTiles, setAllTiles] = useState(false);
  // Subtask filter: show only the children of this parent (chip / ?parent=).
  const [parentOf, setParentOf] = useState<string | null>(initialParent ?? null);

  // Four personal saved filters, per browser.
  type Slot = { label: string; project: string; person: string; priority: string; phase: string; view: string } | null;
  const [slots, setSlots] = useState<Slot[]>([null, null, null, null]);
  // Add-task panel (the first tile on the project page) folds open here.
  const [showAdd, setShowAdd] = useState(addOpen);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("gb_task_slots");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) { const v = JSON.parse(raw); if (Array.isArray(v) && (v.length === 3 || v.length === 4)) setSlots([...v, null, null, null, null].slice(0, 4)); }
    } catch {}
  }, []);
  const persist = (next: Slot[]) => {
    setSlots(next);
    try { localStorage.setItem("gb_task_slots", JSON.stringify(next)); } catch {}
  };
  const autoLabel = () => {
    const parts: string[] = [];
    if (phase !== "all") parts.push(phase);
    if (person !== "all") parts.push(person.split(" ")[0]);
    if (priority !== "all") parts.push(priority);
    if (view === "mine") parts.push("Mine");
    if (view === "late") parts.push("Late");
    if (project !== "all") parts.push(project.split(" ")[0]);
    return parts.length ? parts.join(" · ") : "All open";
  };
  const saveSlot = (i: number) => {
    const label = typeof window !== "undefined" ? (window.prompt("Name this filter", autoLabel()) ?? "").trim() : "";
    if (!label) return;
    const next = [...slots];
    next[i] = { label, project, person, priority, phase, view };
    persist(next);
  };
  const applySlot = (sl: NonNullable<Slot>) => {
    setProject(sl.project); setPerson(sl.person); setPriority(sl.priority);
    setPhase(sl.phase); setView(sl.view as typeof view); setOpen(null);
  };
  const clearSlot = (i: number) => { const next = [...slots]; next[i] = null; persist(next); };
  // Setup mode: which slot is being configured, and its short name.
  const [setupSlot, setSetupSlot] = useState<number | null>(null);
  const [slotName, setSlotName] = useState("");
  const openSetup = (i: number) => {
    const sl = slots[i];
    if (sl) applySlot(sl);
    setSlotName(sl?.label ?? "");
    setSetupSlot(i);
  };
  const saveSetup = () => {
    if (setupSlot === null) return;
    const next = [...slots];
    next[setupSlot] = { label: slotName.trim() || autoLabel(), project, person, priority, phase, view: view === "none" ? "all" : view };
    persist(next);
    setSetupSlot(null);
  };

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
  const tradeNames = useMemo(
    () => [...new Set(tasks.map((t) => t.trade).filter((x): x is string => !!x))].sort(),
    [tasks]
  );

  // Phase/stage panels: open per bucket within the current project filter.
  const phaseStats = useMemo(() => {
    const m = new Map<string, { open: number; late: number }>();
    for (const t of tasks) {
      if (project !== "all" && (t.project ?? "No project") !== project) continue;
      const ph = stageMode ? stageOf(t.trade) : phaseOf(t.trade);
      if (!ph || t.state !== "open") continue;
      const s0 = m.get(ph) ?? { open: 0, late: 0 };
      s0.open += 1;
      if (t.target_date && t.target_date < todayIso) s0.late += 1;
      m.set(ph, s0);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, project, todayIso, stageMode, tradeStage]);

  // People with LATE open tasks — clickable panels that filter the list to
  // that person's overdue work. "Unassigned" is its own bucket.
  const latePeople = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tasks) {
      if (t.state === "open" && t.target_date && t.target_date < todayIso) {
        const who = t.assignee ?? "Unassigned";
        m.set(who, (m.get(who) ?? 0) + 1);
      }
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [tasks, todayIso]);
  // The trade to draw for a person with no photo: the one most of their
  // late tasks belong to.
  const lateTrade = useMemo(() => {
    const counts = new Map<string, Map<string, number>>();
    for (const t of tasks) {
      if (!(t.state === "open" && t.target_date && t.target_date < todayIso) || !t.trade) continue;
      const who = t.assignee ?? "Unassigned";
      const c = counts.get(who) ?? new Map<string, number>();
      c.set(t.trade, (c.get(t.trade) ?? 0) + 1);
      counts.set(who, c);
    }
    const best = new Map<string, string>();
    for (const [who, c] of counts) best.set(who, [...c.entries()].sort((a, b) => b[1] - a[1])[0][0]);
    return best;
  }, [tasks, todayIso]);

  const prioRank = (p: string | null) => (p === "High" ? 0 : p === "Medium" ? 1 : p === "Low" ? 2 : 3);
  // Every word typed has to appear somewhere on the task: its title, trade,
  // assignee, status or notes. "plum" finds the plumbing work.
  const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hits = (t: TableTask) => {
    if (terms.length === 0) return true;
    const hay = [t.action, t.trade, t.assignee, t.status, t.priority, t.project, t.notes, t.parent]
      .filter(Boolean).join(" ").toLowerCase();
    return terms.every((w) => hay.includes(w));
  };
  const shownAll = tasks
    .filter(
      (t) =>
        hits(t) &&
        (terms.length > 0 || state === "all" || t.state === state) &&
        (terms.length > 0 || true) &&
        (domain === "all" || t.domain === domain) &&
        (project === "all" || (t.project ?? "No project") === project) &&
        (trade === "all" || t.trade === trade) &&
        (person === "all" || (person === "__unassigned__" ? !t.assignee : t.assignee === person)) &&
        (priority === "all" || (t.priority ?? "No Priority") === priority) &&
        (terms.length > 0 || view !== "mine" || t.who === "you") &&
        (terms.length > 0 || view !== "late" || (t.state === "open" && !!t.target_date && t.target_date < todayIso)) &&
        // Stuck = open and not moving: overdue, waiting on someone, or parked.
        // Mirrors the homepage card's "stuck" count.
        (terms.length > 0 || view !== "stuck" || (t.state === "open" &&
          ((!!t.target_date && t.target_date < todayIso) || /pending/i.test(t.status) || t.status === "Parked"))) &&
        (terms.length > 0 || view !== "urgent" || t.state === "open") &&
        (parentOf === null || t.parent_id === parentOf) &&
        (phase === "all" || (stageMode ? stageOf(t.trade) : phaseOf(t.trade)) === phase)
    )
    .sort((a, b) =>
      view === "urgent"
        ? ((a.target_date ?? "9999").localeCompare(b.target_date ?? "9999") || (prioRank(a.priority) - prioRank(b.priority)))
        : view === "late" || view === "stuck"
          ? (a.target_date ?? "9999").localeCompare(b.target_date ?? "9999")
          : sort === "updated"
            ? (b.last_updated ?? "").localeCompare(a.last_updated ?? "")
            : (a.target_date ?? "9999").localeCompare(b.target_date ?? "9999")
    );
  // Urgent = the 10 nearest-due open tasks, line by line (the default view).
  // (When filtered to a parent's subtasks, show all of them — no urgent cap.)
  const shown = view === "urgent" && parentOf === null && terms.length === 0 ? shownAll.slice(0, 10) : shownAll;
  const parentTitle = parentOf ? (tasks.find((t) => t.id === parentOf)?.action ?? tasks.find((t) => t.parent_id === parentOf)?.parent ?? "this task") : null;
  const tableVisible = (!compact && !startEmpty) || view !== "none" || trade !== "all" || parentOf !== null || terms.length > 0;

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

  // The filter controls, used inline on list pages and inside a slot's
  // setup panel on the project page.
  const filterControls = (
    <div className="filterbar">
      {/* One project only (a project page): no project filter, no project column. */}
      {projects.length > 1 && (
        <select value={project} onChange={pick(setProject)}>
          <option value="all">All projects</option>
          {projects.map((p) => <option key={p}>{p}</option>)}
        </select>
      )}
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
        <option value="__unassigned__">Unassigned</option>
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
  );

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
              {projects.length > 1 && (
                <select value={project} onChange={(e) => { pick(setProject)(e); setView("all"); }}>
                  <option value="all">All projects</option>
                  {projects.map((p) => <option key={p}>{p}</option>)}
                </select>
              )}
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
              <select value={trade} onChange={(e) => { pick(setTrade)(e); setView("all"); }}>
                <option value="all">All trades</option>
                {tradeNames.map((tr) => <option key={tr}>{tr}</option>)}
              </select>
              <select value={sort} onChange={pick(setSort)}>
                <option value="due">By due (late first)</option>
                <option value="updated">By last update</option>
              </select>
            </div>
          </details>
        </div>
      )}

      {showLatePanels && (
        <div style={{ display: "grid", gap: 4 }}>
          <input
            className="input"
            type="search"
            list="task-search-terms"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setOpen(null); }}
            placeholder="Search tasks — a trade, a name, a word in the title"
            aria-label="Search tasks"
          />
          {/* Autocomplete: the trades and people actually on this project. */}
          <datalist id="task-search-terms">
            {[...tradeNames, ...people].map((v) => <option key={v} value={v} />)}
          </datalist>
          {terms.length > 0 && (
            <span className="muted small">
              {shown.length} match{shown.length === 1 ? "" : "es"} for &ldquo;{search.trim()}&rdquo;
              <button type="button" className="btn ghost small" style={{ marginLeft: 8, padding: "1px 8px" }}
                onClick={() => setSearch("")}>Clear</button>
            </span>
          )}
        </div>
      )}

      {showLatePanels && (latePeople.length > 0 || (!!addTaskSlot && !compact)) && (() => {
        // Eight tiles fill two rows; the add-task tile takes one of them.
        const capacity = 8 - (addTaskSlot && !compact ? 1 : 0);
        const overflowing = !allTiles && latePeople.length > capacity;
        const shownLate = overflowing ? latePeople.slice(0, capacity - 1) : latePeople;
        const hidden = latePeople.length - shownLate.length;
        return (
        <div className="phase-grid late-grid" style={{ marginBottom: 4 }}>
          {addTaskSlot && !compact && (
            <button type="button" className={showAdd ? "phase-tile late-tile on" : "phase-tile late-tile"} title={showAdd ? "Close" : "Add a task to this project"}
              onClick={() => setShowAdd((v) => !v)}>
              <span className="phase-icon" style={{ background: "#dcefe2", color: "var(--brand)", width: 26, height: 26, fontSize: 18, fontWeight: 700 }}>＋</span>
              <span className="phase-name">Add task</span>
              <span className="tradestat-late" style={{ color: "var(--brand)" }}>new</span>
            </button>
          )}
          {shownLate.map(([who, n]) => {
            const key = who === "Unassigned" ? "__unassigned__" : who;
            const on = view === "late" && person === key;
            // Short name for the tile: first word plus initial, full name on hover.
            const parts = who.split(/\s+/);
            const short = parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : who;
            return (
              <button key={who} type="button" className={on ? "phase-tile late-tile on" : "phase-tile late-tile"}
                title={on ? "Clear" : `${who} — show late tasks`}
                onClick={() => {
                  if (on) { setPerson("all"); setView("all"); } else { setPerson(key); setView("late"); }
                  setOpen(null);
                }}>
                {avatars?.[who] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatars[who]} alt="" className="phase-icon"
                    style={{ width: 26, height: 26, borderRadius: "50%", objectFit: "cover", padding: 0 }} />
                ) : (
                  <span className="phase-icon" style={{ background: "#fdecec", color: "#c0262d", width: 26, height: 26 }} title={lateTrade.get(who) ?? "No trade"}>
                    <span style={{ display: "inline-flex", transform: "scale(0.62)" }}><TradeIcon trade={lateTrade.get(who) ?? ""} /></span>
                  </span>
                )}
                <span className="phase-name">{short}</span>
                <span className="tradestat-late"><strong>{n}</strong> late</span>
              </button>
            );
          })}
          {hidden > 0 && (
            <button type="button" className="phase-tile late-tile" title={`Show ${hidden} more`}
              onClick={() => setAllTiles(true)}>
              <span className="phase-icon" style={{ background: "#eef1ea", color: "#555", width: 26, height: 26, fontSize: 16, fontWeight: 700 }}>…</span>
              <span className="phase-name">More</span>
              <span className="tradestat-late">{hidden} more</span>
            </button>
          )}
          {allTiles && latePeople.length > 7 && (
            <button type="button" className="phase-tile late-tile" title="Show fewer"
              onClick={() => setAllTiles(false)}>
              <span className="phase-icon" style={{ background: "#eef1ea", color: "#555", width: 26, height: 26, fontSize: 16, fontWeight: 700 }}>‹</span>
              <span className="phase-name">Fewer</span>
              <span className="tradestat-late">collapse</span>
            </button>
          )}
        </div>
        );
      })()}
      {showAdd && addTaskSlot && !compact && (
        <div className="card" style={{ padding: "10px 12px", marginBottom: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
            <strong className="small">New task</strong>
            <button type="button" className="btn ghost small" onClick={() => setShowAdd(false)}>Close</button>
          </div>
          <div style={{ marginTop: 8 }}>{addTaskSlot}</div>
        </div>
      )}

      {showViews && (
      <div className="btn-row" style={{ gap: 6 }}>
        <button type="button" className={view === "urgent" ? "btn small" : "btn ghost small"}
          onClick={() => { setView(view === "urgent" ? "none" : "urgent"); setOpen(null); }}>
          Urgent
        </button>
        <button type="button" className={view === "mine" ? "btn small" : "btn ghost small"}
          onClick={() => { setView(view === "mine" ? "none" : "mine"); setOpen(null); }}>
          My tasks
        </button>
        <button type="button" className={view === "late" ? "btn small" : "btn ghost small"}
          onClick={() => { setView(view === "late" ? "none" : "late"); setOpen(null); }}>
          Late tasks
        </button>
        <button type="button" className={view === "stuck" ? "btn small" : "btn ghost small"}
          onClick={() => { setView(view === "stuck" ? "none" : "stuck"); setOpen(null); }}>
          Stuck
        </button>
        <button type="button" className={view === "all" ? "btn small" : "btn ghost small"}
          onClick={() => { setView(view === "all" ? "none" : "all"); setOpen(null); }}>
          Full list
        </button>
      </div>
      )}

      {!compact && !filtersInSetup && filterControls}

      {showTradeTiles && stageMode && (
        <div className="phase-grid">
          {stageTiles!.map((s) => {
            const st = phaseStats.get(s.key) ?? { open: 0, late: 0 };
            const on = phase === s.key;
            const over = s.budget > 0 && s.actual > s.budget;
            const pct = s.budget > 0 ? Math.min(100, (s.actual / s.budget) * 100) : s.actual > 0 ? 100 : 0;
            return (
              <button key={s.key} type="button" className={on ? "phase-tile on" : "phase-tile"}
                onClick={() => { setPhase(on ? "all" : s.key); setView("all"); setOpen(null); }}>
                <span className="phase-name" style={{ fontSize: 12 }}>{s.label}</span>
                <span className="small" style={{ fontWeight: 700 }}>
                  <span style={{ color: over ? "#c0262d" : "#2f6b4f" }}>{tileMoney(s.actual)}</span>
                  <span className="muted" style={{ fontWeight: 400 }}> / {tileMoney(s.budget)}</span>
                </span>
                <span className="progressbar" style={{ width: "100%", background: "#eceee9" }}>
                  <span style={{ width: `${pct}%`, background: over ? "#c0262d" : "#2f6b4f", display: "inline-block", height: "100%" }} />
                </span>
                <span className="phase-nums">
                  <strong>{st.open}</strong> open
                  {st.late > 0 && <span className="tradestat-late"> · {st.late} late</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {showTradeTiles && !stageMode && (
        <div className="phase-grid">
          {PHASES.map((ph) => {
            const st = phaseStats.get(ph) ?? { open: 0, late: 0 };
            const on = phase === ph;
            return (
              <button key={ph} type="button" className={on ? "phase-tile on" : "phase-tile"}
                onClick={() => { setPhase(on ? "all" : ph); setView("all"); setOpen(null); }}>
                <span className="phase-icon">{PHASE_ICON[ph]}</span>
                <span className="phase-name">{ph}</span>
                <span className="phase-nums">
                  <strong>{st.open}</strong> open
                  {st.late > 0 && <span className="tradestat-late"> · {st.late} late</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {savedFilters && filtersInSetup && (
        <div style={{ display: "grid", gap: 8 }}>
          {/* Three filter buttons, each with its own setup. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6 }}>
            {slots.map((sl, i) => (
              <span key={i} style={{ display: "flex", alignItems: "stretch", minWidth: 0 }}>
                <button type="button"
                  className="btn ghost small"
                  style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0, opacity: sl ? 1 : 0.65, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: "4px 6px", fontSize: 11 }}
                  title={sl ? `Apply: ${sl.label}` : "Set up this filter"}
                  onClick={() => (sl ? (applySlot(sl), setSetupSlot(null)) : openSetup(i))}>
                  <span style={{ fontWeight: 700, marginRight: 4 }}>{i + 1}</span>{sl ? sl.label : "Filter"}
                </button>
                <button type="button" className="btn ghost small" title="Setup: choose filters and a short name"
                  aria-label={`Set up filter ${i + 1}`}
                  style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeft: 0, padding: "2px 6px", flex: "none" }}
                  onClick={() => (setupSlot === i ? setSetupSlot(null) : openSetup(i))}>
                  ⚙
                </button>
              </span>
            ))}
          </div>
          {setupSlot !== null && (
            <div className="card" style={{ display: "grid", gap: 8, padding: "10px 12px" }}>
              <div className="small" style={{ fontWeight: 700 }}>Filter {setupSlot + 1} · setup</div>
              {filterControls}
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="slot-name">Short name</label>
                <input id="slot-name" className="input" value={slotName} onChange={(e) => setSlotName(e.target.value)}
                  placeholder={autoLabel()} style={{ maxWidth: 260 }} />
              </div>
              <div className="btn-row">
                <button type="button" className="btn small" onClick={saveSetup}>Save filter {setupSlot + 1}</button>
                {slots[setupSlot] && <button type="button" className="btn ghost small" onClick={() => { clearSlot(setupSlot); setSetupSlot(null); }}>Clear</button>}
                <button type="button" className="btn ghost small" onClick={() => setSetupSlot(null)}>Close</button>
              </div>
            </div>
          )}
        </div>
      )}

      {savedFilters && !filtersInSetup && (
        <div className="slot-grid">
          {slots.map((sl, i) => (
            <div key={i} className="slot">
              {sl ? (
                <>
                  <button type="button" className="slot-apply" onClick={() => applySlot(sl)}>
                    <span className="slot-num">{i + 1}</span>
                    <span className="slot-label">{sl.label}</span>
                  </button>
                  <button type="button" className="slot-x" title="Clear" onClick={() => clearSlot(i)}>×</button>
                </>
              ) : (
                <button type="button" className="slot-empty" onClick={() => saveSlot(i)}>
                  <span className="slot-num">{i + 1}</span>
                  <span className="muted small">Save filter</span>
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {parentOf && (
        <div className="small" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, background: "#fdecec", color: "#c0262d", padding: "6px 10px", borderRadius: 8 }}>
          <span>Subtasks of <strong>{parentTitle}</strong> · {shown.length}</span>
          <button type="button" className="btn ghost small" onClick={() => { setParentOf(null); setOpen(null); }}>Show all tasks ✕</button>
        </div>
      )}

      {!tableVisible ? (
        startEmpty ? <p className="muted small" style={{ margin: 0 }}>Pick a person above, or a filter, to list tasks.</p> : null
      ) : shown.length === 0 ? (
        <p className="muted small" style={{ margin: 0 }}>Nothing matches these filters.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="tasktable">
            <thead>
              <tr>
                <th>Task</th>
                {projects.length > 1 && <th>Project</th>}
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
                    <td style={{ minWidth: 0 }}>
                      <strong style={{ fontWeight: 600 }}>{t.action}</strong>
                      {/* Subtask linkage: children say whose; parents get a chip that filters to their children. */}
                      {t.parent_id && parentOf !== t.parent_id && (
                        <div className="muted" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>↳ under {t.parent ?? "a parent task"}</div>
                      )}
                      {(t.open_children ?? 0) > 0 && (
                        <button type="button" className="extra-chip"
                          style={{ marginTop: 2, cursor: "pointer", border: "none", background: "#fdecec", color: "#c0262d", fontWeight: 600 }}
                          title="Show this task's open subtasks"
                          onClick={(e) => { e.stopPropagation(); setParentOf(t.id); setView("all"); setOpen(null); }}>
                          {t.open_children} open subtask{t.open_children === 1 ? "" : "s"} →
                        </button>
                      )}
                    </td>
                    {projects.length > 1 && <td className="muted">{t.project ?? "—"}</td>}
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
                          {/* Quick access: each lands on the task with that action ready. */}
                          <span className="btn-row" style={{ gap: 6, flexWrap: "wrap" }}>
                            <Link className="btn ghost small" href={`/my/task/${t.id}?do=comment`}>💬 Log comment</Link>
                            <Link className="btn ghost small" href={`/my/task/${t.id}?do=evidence`}>📷 Add evidence</Link>
                            <Link className="btn ghost small" href={`/my/task/${t.id}?do=stage`}>⇢ Change stage</Link>
                            <Link className="btn ghost small" href={`/my/task/${t.id}?do=tx`}>💵 Attach transaction</Link>
                            <Link className="btn small" href={`/my/task/${t.id}`}>Open task →</Link>
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
