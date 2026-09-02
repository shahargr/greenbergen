"use client";

import { useState } from "react";
import { VoiceRecorder } from "@/components/VoiceRecorder";
import { createJob } from "./actions";

// Start-a-project with three ways to describe the work: a name, optional
// text, and an optional voice note recorded in place. The property it
// belongs to is always an explicit choice, pre-set to the last one worked on.
export function StartProjectForm({
  homes,
  defaultParent,
  error,
}: {
  homes: { id: string; name: string; address: string | null }[];
  defaultParent: string;
  error?: string;
}) {
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    if (voiceBlob) {
      const ext = voiceBlob.type.includes("mp4") ? "m4a" : "webm";
      fd.append("audio", new File([voiceBlob], `project-description.${ext}`, { type: voiceBlob.type }));
    }
    setBusy(true);
    await createJob(fd);
  }

  return (
    <>
      {error && <p className="error small">{error}</p>}
      <form onSubmit={submit} style={{ display: "grid", gap: 10, maxWidth: 440 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="pj-parent">Which property is this for?</label>
          <select id="pj-parent" name="parent" className="input" defaultValue={defaultParent} required>
            {homes.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}{h.address && h.address !== h.name ? ` — ${h.address}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="pj-name">What are we doing?</label>
          <input id="pj-name" name="name" className="input" required autoComplete="off" placeholder="e.g. Kitchen remodel, new pool, generator" />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="pj-desc">Tell us more (optional)</label>
          <textarea id="pj-desc" name="description" className="input" rows={3} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Or just say it (optional)</label>
          <VoiceRecorder onReady={setVoiceBlob} />
        </div>
        <div>
          <button className="btn" disabled={busy}>{busy ? "Creating..." : "Create project"}</button>
        </div>
      </form>
    </>
  );
}
