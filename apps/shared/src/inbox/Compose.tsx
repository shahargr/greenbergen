"use client";

import { useState } from "react";
import { messageSend } from "./actions";
import type { Target } from "./data";

// Write to someone you work with. The project comes first because it is what
// decides who you may reach - pick it, and the list below is the people on
// it. The database checks that again on the way in.
export function Compose({ targets, base }: { targets: Target[]; base: string }) {
  const [projectId, setProjectId] = useState(targets[0]?.project_id ?? "");
  const project = targets.find((t) => t.project_id === projectId) ?? targets[0];
  const people = project?.people ?? [];

  if (targets.length === 0) {
    return (
      <p className="small text-muted" style={{ margin: 0 }}>
        You are not on a project with anyone else yet, so there is nobody to write to.
      </p>
    );
  }

  return (
    <form action={messageSend} className="stack" style={{ gap: 10 }}>
      <input type="hidden" name="base" value={base} />
      <label className="field" style={{ marginBottom: 0 }}>
        <span className="field-label">About</span>
        <select name="project" className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          {targets.map((t) => <option key={t.project_id} value={t.project_id}>{t.project_name}</option>)}
        </select>
      </label>
      <label className="field" style={{ marginBottom: 0 }}>
        <span className="field-label">To</span>
        <select name="to" className="input" key={projectId}>
          {people.map((p) => (
            <option key={p.contact_id} value={p.contact_id}>{p.name}{p.seat ? ` · ${p.seat}` : ""}</option>
          ))}
        </select>
      </label>
      <textarea name="body" className="input" rows={3} placeholder="What do you need to say?" required />
      <button className="btn btn-primary btn-block">Send</button>
    </form>
  );
}
