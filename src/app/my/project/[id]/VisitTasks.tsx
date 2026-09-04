"use client";

import { useState } from "react";

export type VisitMember = { contactId: string; name: string; trade?: string | null };

// What you saw, turned into work. Each row is one task off this visit: what
// it is, and who has it. The rows post as task_what / task_who / task_attach
// (the index of every row that should carry this visit's photos), and the
// server creates them as children of the visit log.
export function VisitTasks({ members }: { members: VisitMember[] }) {
  const [rows, setRows] = useState<number[]>([]);
  const [seq, setSeq] = useState(0);

  const addRow = () => { setRows((r) => [...r, seq]); setSeq((n) => n + 1); };
  const dropRow = (i: number) => setRows((r) => r.filter((x) => x !== i));

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span className="small" style={{ fontWeight: 700 }}>
          Tasks from this visit{rows.length > 0 ? ` · ${rows.length}` : ""}
        </span>
        <button type="button" className="btn ghost small" onClick={addRow}>＋ Add task</button>
      </div>

      {rows.length === 0 && (
        <p className="muted small" style={{ margin: 0 }}>
          A note records what you saw. Add a task for anything that has to be done about it, and say who has it.
        </p>
      )}

      {rows.map((i) => (
        <div key={i} className="card" style={{ padding: "8px 10px", display: "grid", gap: 6, background: "#fafbfa" }}>
          {/* The row id travels with the row, so the evidence checkbox still
              matches its task after other rows are removed. */}
          <input type="hidden" name="task_row" value={String(i)} />
          <div className="form-2col">
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor={`vt-what-${i}`}>What has to be done</label>
              <input id={`vt-what-${i}`} name="task_what" className="input" required
                placeholder="Move the electric wire to the window" />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor={`vt-who-${i}`}>Who has it</label>
              <select id={`vt-who-${i}`} name="task_who" className="input" defaultValue="">
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.contactId} value={m.contactId}>
                    {m.name}{m.trade ? ` · ${m.trade}` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <label className="small" style={{ display: "inline-flex", alignItems: "center", gap: 6, margin: 0 }}>
              <input type="checkbox" name="task_attach" value={String(i)} defaultChecked />
              Attach this visit&apos;s evidence
            </label>
            <button type="button" className="btn ghost small" style={{ color: "#c0262d" }} onClick={() => dropRow(i)}>
              Remove
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
