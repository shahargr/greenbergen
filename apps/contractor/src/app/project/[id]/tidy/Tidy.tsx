"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@shared/supabase/client";
import { friendly } from "@shared/rpc";
import { shortDate } from "@shared/format";

// TIDY UP: ONE TASK AT A TIME.
//
// Shahar (2026-09-17): "the not filed under a trade is a good catch it all. i
// think having a data improvement process can help a ton... add an AI button
// that will start a process that takes tasks without trade or assignee, one
// by one to fix and sort. so it shows one task at a time, allowing to update
// it correctly."
//
// The queue comes from the database (portal_tidy_queue, migration 173): the
// open tasks on the job's family with no trade or no holder, late first,
// each with a GUESS - the trade whose word is in the task, or the trade of
// the person the task names - and the reason for the guess, so it can be
// trusted or ignored in one look. The screen shows one, offers the guess,
// and moves on. Save is portal_task_edit; nothing here writes a row itself.
type Task = {
  id: string; action: string; notes: string | null; status_note: string | null; status: string;
  priority: string | null; target_date: string | null; created_at: string; created_by: string | null;
  trade: string | null; project_id: string; project: string;
  assignee_id: string | null; assignee: string | null; parent_title: string | null; late: boolean;
  guess: string | null; why: string | null;
};
type Queue = { n: number; no_trade: number; no_holder: number; tasks: Task[] };
type CatTrade = { trade: string; stage: string | null; panel: string; on_job: boolean };
type Person = { contact_id: string; name: string | null; seat: string | null; me?: boolean };
type Crew = { project_id: string; people: Person[] };

const PRIORITIES = ["High", "Medium", "Low", "No Priority"];

export function Tidy({ projectId, projectName, back }: { projectId: string; projectName: string; back: string }) {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [cat, setCat] = useState<CatTrade[]>([]);
  const [crews, setCrews] = useState<Crew[]>([]);
  const [at, setAt] = useState(0);
  const [done, setDone] = useState(0);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // The form for the task in front of you.
  const [trade, setTrade] = useState("");
  const [holder, setHolder] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState("");
  const [applied, setApplied] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const c = createClient();
      const [q, t, p] = await Promise.all([
        c.rpc("portal_tidy_queue", { p_project: projectId }),
        c.rpc("portal_trade_catalogue", { p_project: projectId }),
        c.rpc("portal_compose_targets"),
      ]);
      if (!live) return;
      if (q.error) setErr(friendly(q.error.message));
      setQueue((q.data as Queue) ?? { n: 0, no_trade: 0, no_holder: 0, tasks: [] });
      if (Array.isArray(t.data)) setCat(t.data as CatTrade[]);
      if (Array.isArray(p.data)) setCrews(p.data as Crew[]);
    })();
    return () => { live = false; };
  }, [projectId]);

  const tasks = (queue?.tasks ?? []).filter((t) => !skipped.includes(t.id));
  const task = tasks[at] ?? null;

  // The form follows the task: the guess goes into the trade box, what the
  // task already has stays. Adjusted during render, never in an effect.
  if (task && applied !== task.id) {
    setApplied(task.id);
    setTrade(task.trade ?? task.guess ?? "");
    setHolder(task.assignee_id ?? "");
    setDue(task.target_date ?? "");
    setPriority(task.priority && task.priority !== "Missing" ? task.priority : "");
    setErr("");
  }

  const people = (crews.find((c) => c.project_id === (task?.project_id ?? projectId))
    ?? crews.find((c) => c.project_id === projectId))?.people ?? [];
  const onJob = cat.filter((t) => t.on_job);
  const offJob = cat.filter((t) => !t.on_job);

  async function save() {
    if (!task) return;
    setBusy(true); setErr("");
    const patch: Record<string, string | null> = {};
    if ((trade || null) !== task.trade) patch.trade = trade || null;
    if ((holder || null) !== task.assignee_id) patch.assignee = holder || null;
    if ((due || null) !== task.target_date) patch.target_date = due || null;
    if (priority && priority !== task.priority) patch.priority = priority;
    if (Object.keys(patch).length === 0) { setBusy(false); next(); return; }
    const { data, error } = await createClient().rpc("portal_task_edit", { p_action_id: task.id, p_patch: patch });
    setBusy(false);
    if (error) { setErr(friendly(error.message)); return; }
    if (!data?.ok) { setErr(data?.reason ?? "That was not saved."); return; }
    setDone((d) => d + 1);
    setSkipped((s) => [...s, task.id]);
  }

  async function callOff() {
    if (!task) return;
    const reason = window.prompt(`Call off "${task.action}"? Say why, in a few words.`);
    if (reason === null) return;
    setBusy(true); setErr("");
    const { data, error } = await createClient().rpc("portal_task_cancel", { p_action_id: task.id, p_reason: reason || "Not needed" });
    setBusy(false);
    if (error) { setErr(friendly(error.message)); return; }
    if (!data?.ok) { setErr(data?.reason ?? "That was not called off."); return; }
    setDone((d) => d + 1);
    setSkipped((s) => [...s, task.id]);
  }

  function next() { setAt((i) => Math.min(i + 1, Math.max(0, tasks.length - 1))); setSkipped((s) => task ? [...s, task.id] : s); }

  if (!queue) return <div className="card pad"><div className="small text-muted">Reading the pile…</div></div>;

  const total = queue.n;
  const left = tasks.length;

  if (!task) {
    return (
      <div className="card pad stack" style={{ gap: 10 }}>
        <div className="small" style={{ fontWeight: 800 }}>
          {total === 0 ? "Nothing to tidy." : left === 0 && done > 0 ? `Done — ${done} sorted.` : "That is the end of the pile."}
        </div>
        <p className="tiny text-muted" style={{ margin: 0 }}>
          {total === 0
            ? `Every open task on ${projectName} has a trade and a holder.`
            : "Skipped ones come back next time you open this."}
        </p>
        <Link href={back} className="btn btn-primary">Back to the job</Link>
      </div>
    );
  }

  const suggested = !!task.guess && !task.trade;
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="between" style={{ alignItems: "baseline" }}>
        <div className="divider-label" style={{ padding: 0 }}>
          {done + 1} of {total}{queue.no_trade > 0 ? ` · ${queue.no_trade} without a trade` : ""}{queue.no_holder > 0 ? ` · ${queue.no_holder} nobody holds` : ""}
        </div>
      </div>

      <div className="card pad stack tidy-card" style={{ gap: 10 }}>
        <div>
          <div className="tiny text-muted">
            {[task.project, task.parent_title ? `part of ${task.parent_title}` : null,
              task.created_by && !task.created_by.startsWith("system:") ? `opened by ${task.created_by}` : null,
              shortDate(task.created_at)].filter(Boolean).join(" · ")}
          </div>
          <div className="t" style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.25, marginTop: 2 }}>
            <Link href={`/task/${task.id}?back=${encodeURIComponent(`/project/${projectId}/tidy?back=${encodeURIComponent(back)}`)}`}
              style={{ color: "inherit", textDecoration: "none" }}>{task.action}</Link>
          </div>
          {(task.status_note || task.notes) && (
            <p className="small text-muted" style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>
              {(task.status_note || task.notes || "").slice(0, 400)}
            </p>
          )}
          <div className="tiny" style={{ marginTop: 4 }}>
            {task.late && <span className="tag tag-status" style={{ marginRight: 6 }}>late</span>}
            {task.target_date ? `Due ${shortDate(task.target_date)}` : "No date"}{task.status !== "Not Started" ? ` · ${task.status}` : ""}
          </div>
        </div>

        {suggested && (
          <div className="tidy-guess">
            Looks like <strong>{task.guess}</strong>{task.why ? <span className="text-muted"> — {task.why}</span> : null}.
            {trade !== task.guess && (
              <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }} onClick={() => setTrade(task.guess!)}>Use it</button>
            )}
          </div>
        )}

        <div className="nb-two">
          <label className="nb-fld">
            <span>Trade{!task.trade ? " · missing" : ""}</span>
            <select className="input" value={trade} onChange={(e) => setTrade(e.target.value)}>
              <option value="">No trade</option>
              {onJob.length > 0 && <optgroup label="On this job">{onJob.map((t) => <option key={t.trade} value={t.trade}>{t.trade}</option>)}</optgroup>}
              {offJob.length > 0 && <optgroup label="Elsewhere in the build">{offJob.map((t) => <option key={t.trade} value={t.trade}>{t.trade}</option>)}</optgroup>}
            </select>
          </label>
          <label className="nb-fld">
            <span>Who holds it{!task.assignee_id && !task.assignee ? " · missing" : ""}</span>
            <select className="input" value={holder} onChange={(e) => setHolder(e.target.value)}>
              <option value="">{task.assignee && !task.assignee_id ? `${task.assignee} (assistant)` : "Nobody"}</option>
              {people.map((p) => (
                <option key={p.contact_id} value={p.contact_id}>{p.name}{p.me ? " (me)" : ""}{p.seat ? ` · ${p.seat}` : ""}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="nb-two">
          <label className="nb-fld">
            <span>When</span>
            <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
          <label className="nb-fld">
            <span>Priority</span>
            <select className="input" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="">{task.priority && task.priority !== "Missing" ? task.priority : "Not set"}</option>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
        </div>

        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary" disabled={busy} style={{ flex: "2 1 auto" }}
            onClick={() => { void save(); }}>{busy ? "…" : "Save and next"}</button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={next}>Skip</button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { void callOff(); }}>Call it off</button>
        </div>
        {err && <p className="tiny" style={{ color: "var(--color-danger)", margin: 0 }}>{err}</p>}
      </div>

      <p className="tiny text-muted" style={{ margin: 0 }}>
        The guess is a word in the task matched against the trades, or the name of somebody with a contract. Nothing is written until you save.
      </p>
    </div>
  );
}
