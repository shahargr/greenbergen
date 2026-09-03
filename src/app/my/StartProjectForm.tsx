"use client";

import Link from "next/link";

import { useState } from "react";
import { VoiceRecorder } from "@/components/VoiceRecorder";
import { FilePick } from "@/components/FilePick";
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
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    if (voiceBlob) {
      const ext = voiceBlob.type.includes("mp4") ? "m4a" : "webm";
      fd.append("audio", new File([voiceBlob], `project-description.${ext}`, { type: voiceBlob.type }));
    }
    // Total upload size guard - the server rejects huge bodies without a
    // useful error, so say it here first.
    let totalMb = 0;
    for (const [, v] of fd.entries()) if (v instanceof File) totalMb += v.size / (1024 * 1024);
    if (totalMb > 45) {
      setFailed(`Attachments total ${Math.round(totalMb)}MB — keep under 45MB, or add the rest from the project page after creating.`);
      return;
    }
    setBusy(true);
    setFailed("");
    try {
      await createJob(fd);
    } catch (err) {
      if (err && typeof err === "object" && "digest" in err && String(err.digest).startsWith("NEXT_REDIRECT")) throw err;
      setBusy(false);
      setFailed(err instanceof Error ? err.message : "Creating failed — try fewer or smaller files.");
    }
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
          <label>Common jobs — tap one, or type your own below</label>
          <div className="btn-row" style={{ gap: 6, flexWrap: "wrap" }}>
            {["Install appliance", "Unclog toilet", "Water heater", "Emergency power", "Generator for emergency", "Water leak"].map((j) => (
              <button
                key={j}
                type="button"
                className={name === j ? "btn small" : "btn ghost small"}
                onClick={() => setName(j)}
              >
                {j}
              </button>
            ))}
          </div>
        </div>
        <div className="featured-jobs">
          {[
            {
              name: "Emergency generator",
              icon: (
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2.5" y="8" width="19" height="10" rx="2" />
                  <path d="M6 8V6.5A1.5 1.5 0 0 1 7.5 5h9A1.5 1.5 0 0 1 18 6.5V8" />
                  <path d="m12.5 10-2.4 3.4h3l-2.4 3.4" />
                  <path d="M5.5 21v-3M18.5 21v-3" />
                </svg>
              ),
            },
            {
              name: "EV charger installation",
              icon: (
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="5" y="3" width="10" height="18" rx="2" />
                  <rect x="7.5" y="6" width="5" height="4" rx="0.8" />
                  <path d="m10.6 12-2 3h2.6l-2 3" />
                  <path d="M15 8h2.5a2 2 0 0 1 2 2v7a1.75 1.75 0 1 1-3.5 0v-2.5" />
                </svg>
              ),
            },
            {
              name: "Water heater replacement",
              icon: (
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="7" y="2.5" width="10" height="16" rx="3.5" />
                  <path d="M10 21.5v-3M14 21.5v-3" />
                  <path d="M12 7c-1.1 1.5-2 2.4-2 3.6a2 2 0 0 0 4 0c0-1.2-.9-2.1-2-3.6z" />
                </svg>
              ),
            },
          ].map((j) => (
            <button
              key={j.name}
              type="button"
              className={name === j.name ? "featured-job on" : "featured-job"}
              onClick={() => setName(j.name)}
            >
              <span className="featured-job-icon">{j.icon}</span>
              <span className="featured-job-name">{j.name}</span>
            </button>
          ))}
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="pj-name">What are we doing?</label>
          <input id="pj-name" name="name" className="input" required autoComplete="off"
            value={name} onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Kitchen remodel, new pool, generator" />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="pj-desc">Tell us more (optional)</label>
          <textarea id="pj-desc" name="description" className="input" rows={3} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Photos, plans &amp; documents (optional)</label>
          <div className="btn-row" style={{ alignItems: "flex-start" }}>
            <FilePick name="photos" label="🖼 Add photo" accept="image/*" />
            <FilePick name="photos" label="📷 Take photo" accept="image/*" capture="environment" multiple={false} />
            <FilePick name="docs" label="📄 PDF / plans" accept="application/pdf" />
          </div>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Or just say it (optional)</label>
          <VoiceRecorder onReady={setVoiceBlob} />
        </div>
        {failed && <p className="error small" style={{ margin: 0 }}>{failed}</p>}
        {busy && (
          <p className="muted small" style={{ margin: 0 }}>
            Uploading your files and creating the project — on cellular this
            can take a minute. You&apos;ll land back home when it&apos;s done.
          </p>
        )}
        <div className="btn-row">
          <button className="btn" disabled={busy}>{busy ? "Creating…" : "Create & close"}</button>
          <Link className="btn ghost" href="/my">Cancel</Link>
        </div>
      </form>
    </>
  );
}
