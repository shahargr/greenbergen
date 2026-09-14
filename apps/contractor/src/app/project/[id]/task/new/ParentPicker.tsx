"use client";

import { useMemo, useState } from "react";

// PART OF WHICH TASK.
//
// Shahar (2026-09-14): "part of is important, but will be very hard to find
// with hundreds of tasks open, unless you can enable a search window."
//
// He is right: 55 Walnut has 129 open, and a select with 129 options is a
// list you scroll past, not a list you choose from. So the box above the
// select filters it - type "lvl", get the three tasks with LVL in them - and
// the count says how much of the list you are looking at.
//
// The whole list ships to the browser rather than going back for a search:
// it is an id and a sentence per task, a few kilobytes at this size, and a
// round trip per keystroke on a phone on a building site is worse than the
// bytes.
// `defaultParent` is set when the screen was opened from inside a task ("Add
// a step under this one"). Arriving with the answer already filled in is the
// whole point of that route - having to find the task again in a list of a
// hundred and twenty-nine would undo it.
export function ParentPicker({ tasks, defaultParent = null }: {
  tasks: { id: string; label: string }[];
  defaultParent?: string | null;
}) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState(defaultParent ?? "");

  const found = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return tasks;
    return tasks.filter((t) => t.label.toLowerCase().includes(needle));
  }, [q, tasks]);

  // A task filtered out of view is still the one you chose, so it stays in
  // the list - otherwise typing after choosing would silently unpick it.
  const options = useMemo(() => {
    if (!picked || found.some((t) => t.id === picked)) return found;
    const kept = tasks.find((t) => t.id === picked);
    return kept ? [kept, ...found] : found;
  }, [found, picked, tasks]);

  if (tasks.length === 0) return null;

  return (
    <div className="field">
      <span className="field-label">Part of <span className="text-muted">(optional)</span></span>
      <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)}
        placeholder={`Search ${tasks.length} open tasks`} aria-label="Search open tasks"
        autoComplete="off" style={{ marginBottom: 6 }} />
      <select className="input" name="parent" value={picked} onChange={(e) => setPicked(e.target.value)}
        size={options.length > 8 ? 6 : undefined}>
        <option value="">Not part of anything</option>
        {options.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
      </select>
      <span className="hint">
        {q.trim()
          ? `${found.length} of ${tasks.length} ${found.length === 1 ? "task matches" : "tasks match"}.`
          : "Makes this a step under another task — it has to close before its parent can."}
      </span>
    </div>
  );
}
