"use client";

import Link from "next/link";
import { useState } from "react";
import { saveTask } from "./actions";

export type Subtask = {
  id: string;
  action: string | null;
  status: string;
  priority: string | null;
  target_date: string | null;
  notes: string | null;
};

const OPEN_STATUSES = ["Not Started", "In Progress", "Pending on Others", "Parked"];
const PRIORITIES = ["No Priority", "Low", "Medium", "High"];

// A subtask, edited where you found it. Read-only until unlocked, same
// contract as the main editor: the form is a convenience and the server
// re-checks every field against the subtask's own permissions on save.
export function SubtaskRow({ task, parentId }: { task: Subtask; parentId: string }) {
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!unlocked) {
    return (
      <div className="small" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto auto", gap: 10, alignItems: "center", borderTop: "1px solid #f0f1ee", paddingTop: 8, minWidth: 0 }}>
        <Link href={`/my/task/${task.id}`} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, textDecoration: "none", color: "inherit" }}>
          {task.action ?? "(untitled)"} →
        </Link>
        <span className="muted" style={{ whiteSpace: "nowrap" }}>
          {task.status}{task.target_date ? ` · ${task.target_date}` : ""}
        </span>
        <button type="button" className="btn ghost small" style={{ padding: "2px 8px" }} onClick={() => setUnlocked(true)}>
          ✏️ Edit
        </button>
      </div>
    );
  }

  return (
    <form
      action={saveTask.bind(null, task.id)}
      onSubmit={() => setBusy(true)}
      style={{ display: "grid", gap: 8, borderTop: "1px solid #f0f1ee", paddingTop: 8, minWidth: 0 }}
    >
      <input type="hidden" name="back" value={`/my/task/${parentId}`} />
      <div className="field" style={{ marginBottom: 0 }}>
        <label>Subtask</label>
        <input name="title" className="input" defaultValue={task.action ?? ""} required />
      </div>
      <div className="form-2col">
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Status</label>
          <select name="status" className="input" defaultValue={task.status}>
            {(OPEN_STATUSES.includes(task.status) ? OPEN_STATUSES : [task.status, ...OPEN_STATUSES]).map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Priority</label>
          <select name="priority" className="input" defaultValue={task.priority ?? "No Priority"}>
            {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
          </select>
        </div>
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>Target date</label>
        <input name="target_date" type="date" className="input" defaultValue={task.target_date ?? ""} style={{ maxWidth: 220 }} />
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>Notes</label>
        <textarea name="notes" className="input" rows={4} defaultValue={task.notes ?? ""} />
      </div>
      <div className="btn-row" style={{ alignItems: "center" }}>
        <button className="btn small" disabled={busy}>{busy ? "Saving…" : "Save subtask"}</button>
        <button type="button" className="btn ghost small" onClick={() => setUnlocked(false)}>Cancel</button>
        <Link href={`/my/task/${task.id}`} className="small muted">Open it in full →</Link>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Closing a subtask happens on its own page, where evidence rules apply.
      </p>
    </form>
  );
}
