"use client";

import { useState } from "react";
import { sendMessage } from "./actions";

export type Target = {
  project_id: string;
  project_name: string;
  people: { contact_id: string; name: string; seat: string | null }[];
};

// Write to someone you work with. The project comes first because it is what
// decides who you may reach — pick it, and the list below is the people on it.
export function ComposeMessage({ targets }: { targets: Target[] }) {
  const [projectId, setProjectId] = useState(targets[0]?.project_id ?? "");
  const project = targets.find((t) => t.project_id === projectId) ?? targets[0];
  const people = project?.people ?? [];

  if (targets.length === 0) {
    return (
      <p className="muted small" style={{ margin: 0 }}>
        You are not on a project with anyone else yet, so there is nobody to write to.
      </p>
    );
  }

  return (
    <form action={sendMessage} style={{ display: "grid", gap: 8 }}>
      <div className="form-2col">
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="cm-project">About which project</label>
          <select id="cm-project" name="project" className="input" value={projectId}
            onChange={(e) => setProjectId(e.target.value)}>
            {targets.map((t) => (
              <option key={t.project_id} value={t.project_id}>{t.project_name}</option>
            ))}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="cm-to">To</label>
          <select id="cm-to" name="to" className="input" required defaultValue="">
            <option value="" disabled>Choose someone</option>
            {people.map((p) => (
              <option key={p.contact_id} value={p.contact_id}>
                {p.name}{p.seat ? ` · ${p.seat}` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {people.length === 0 && (
        <p className="muted small" style={{ margin: 0 }}>
          Nobody else is on {project?.project_name}. Invite someone, and they appear here.
        </p>
      )}

      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="cm-body">Message</label>
        <textarea id="cm-body" name="body" className="input" rows={4} required
          placeholder="What you need them to know." />
      </div>

      <div className="btn-row" style={{ alignItems: "center", gap: 10 }}>
        <button className="btn small" disabled={people.length === 0}>Send</button>
        <span className="muted small">Goes straight to their inbox here — no email, no text.</span>
      </div>
    </form>
  );
}
