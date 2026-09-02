"use client";

import { useMemo, useState } from "react";
import { VoiceRecorder } from "@/components/VoiceRecorder";
import { createTask } from "./actions";
import type { PayProject, PayMember } from "./LogPaymentForm";

// Create-and-assign, payment-screen style: project first (most recently
// active on top), assignee from that project's people, and photos plus a
// voice note attached as instructions.
export function AddTaskForm({
  projects,
  members,
}: {
  projects: PayProject[];
  members: PayMember[];
}) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);

  const people = useMemo(
    () => members.filter((m) => m.projectId === projectId),
    [members, projectId]
  );

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (voiceBlob) {
      const ext = voiceBlob.type.includes("mp4") ? "m4a" : "webm";
      fd.append("files", new File([voiceBlob], `instructions.${ext}`, { type: voiceBlob.type }));
    }
    setBusy(true);
    await createTask(fd);
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 10, maxWidth: 480 }}>
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="nt-project">Project</label>
        <select id="nt-project" name="project" className="input" required
          value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="nt-title">Task</label>
        <input id="nt-title" name="title" className="input" required autoComplete="off"
          placeholder="What needs to happen?" />
      </div>
      <div className="form-2col">
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="nt-assign">Assign to</label>
          <select id="nt-assign" name="assigned_to" className="input" defaultValue="">
            <option value="">Unassigned</option>
            {people.map((m) => <option key={m.contactId} value={m.contactId}>{m.name}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="nt-priority">Priority</label>
          <select id="nt-priority" name="priority" className="input" defaultValue="Medium">
            {["High", "Medium", "Low", "No Priority"].map((p) => <option key={p}>{p}</option>)}
          </select>
        </div>
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="nt-date">Target date (optional)</label>
        <input id="nt-date" name="target_date" type="date" className="input" style={{ maxWidth: 220 }} />
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="nt-notes">Instructions (optional)</label>
        <textarea id="nt-notes" name="notes" className="input" rows={3} />
      </div>
      <div className="form-2col">
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Photos as instructions</label>
          <input type="file" name="photos" accept="image/*" capture="environment" multiple className="small" />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Or say it</label>
          <VoiceRecorder onReady={setVoiceBlob} />
        </div>
      </div>
      <div>
        <button className="btn" disabled={busy}>{busy ? "Creating..." : "Create task"}</button>
      </div>
    </form>
  );
}
