"use client";

import Link from "next/link";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { VoiceRecorder } from "@/components/VoiceRecorder";
import { FileDrop } from "@/components/FileDrop";
import { createClient } from "@/lib/supabase/client";
import { createTask, attachTaskUploads, type TaskUpload } from "./actions";
import type { PayProject, PayMember } from "./LogPaymentForm";

// Create-and-assign, payment-screen style: project first (most recently
// active on top), assignee from that project's people, and photos plus a
// voice note attached as instructions.
export function AddTaskForm({
  projects,
  members,
  defaultAssignee,
}: {
  projects: PayProject[];
  members: PayMember[];
  // Preselects the assignee (e.g. from the People table's "create task" link).
  defaultAssignee?: string;
}) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [failed, setFailed] = useState("");
  const router = useRouter();
  // Logging work that's already finished (e.g. a project opened after the
  // fact): the task is created straight into a Completed state.
  const [done, setDone] = useState(false);

  const people = useMemo(
    () => members.filter((m) => m.projectId === projectId),
    [members, projectId]
  );

  // What each file is, for the record. A PDF used to be filed as "audio"
  // because the only question asked was "is it an image".
  const kindOf = (f: File) =>
    f.type.startsWith("image/") ? "photo" : f.type.startsWith("audio/") ? "audio" : f.type === "application/pdf" ? "document" : "other";

  // The files never ride inside the server action. Vercel rejects a request
  // body over 4.5 MB before any of our code runs - a phone photo and a voice
  // note together are enough - and the only thing the browser gets back is
  // "An unexpected response was received from the server". So: create the
  // task (small request), put the files straight into Storage from here,
  // then record and attach them by path.
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const files = fd.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
    fd.delete("photos");
    fd.delete("files");
    if (voiceBlob) {
      const ext = voiceBlob.type.includes("mp4") ? "m4a" : "webm";
      files.push(new File([voiceBlob], `instructions.${ext}`, { type: voiceBlob.type }));
    }
    const projectId = String(fd.get("project") ?? "");
    const title = String(fd.get("title") ?? "").trim();
    setBusy(true);
    setFailed("");
    setStage("Creating…");
    try {
      const made = await createTask(fd);
      if (!made.ok) { setFailed(made.error); setBusy(false); setStage(""); return; }

      const uploads: TaskUpload[] = [];
      const problems: string[] = [];
      if (files.length > 0) {
        const supabase = createClient();
        for (const [i, file] of files.entries()) {
          setStage(`Uploading ${i + 1} of ${files.length}…`);
          const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? (kindOf(file) === "photo" ? ".jpg" : ".m4a")).toLowerCase();
          const path = `${projectId}/actions/${made.id}/instructions-${Date.now()}-${i}${ext}`;
          const { error } = await supabase.storage
            .from("project-media")
            .upload(path, file, { contentType: file.type || undefined, upsert: true });
          if (error) { problems.push(`${file.name || "file"}: ${error.message}`); continue; }
          uploads.push({ path, name: file.name || `instructions${ext}`, mime: file.type, size: file.size, kind: kindOf(file) });
        }
        if (uploads.length > 0) {
          setStage("Attaching…");
          const att = await attachTaskUploads(made.id, projectId, title, uploads);
          problems.push(...att.failed);
        }
      }
      // The task exists either way; if something did not attach, say so on
      // the task page rather than leaving the form looking stuck.
      const q = problems.length
        ? `?error=${encodeURIComponent(`Task created, but not everything attached — ${problems.join("; ")}`)}`
        : "?saved=1";
      router.push(`/my/task/${made.id}${q}`);
    } catch (err) {
      setBusy(false);
      setStage("");
      setFailed(err instanceof Error ? err.message : "Something went wrong.");
    }
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
          <select id="nt-assign" name="assigned_to" className="input" defaultValue={defaultAssignee ?? ""}>
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
      <label className="small" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
        <input type="checkbox" name="done" checked={done} onChange={(e) => setDone(e.target.checked)} />
        <span>Already done — log it as completed</span>
      </label>
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="nt-date">{done ? "Completed on (optional)" : "Target date (optional)"}</label>
        <input id="nt-date" name="target_date" type="date" className="input" style={{ maxWidth: 220 }} />
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="nt-notes">Instructions (optional)</label>
        <textarea id="nt-notes" name="notes" className="input" rows={3} />
      </div>
      <div className="form-2col">
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Photos as instructions</label>
          <FileDrop name="photos" accept="image/*,application/pdf" label="Add photos / PDF" />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Or say it</label>
          <VoiceRecorder onReady={setVoiceBlob} />
        </div>
      </div>
      {failed && <p className="error small" style={{ margin: 0 }}>{failed}</p>}
      <div className="btn-row">
        <button className="btn" disabled={busy}>{busy ? (stage || "Creating…") : done ? "Log completed task" : "Create task"}</button>
        <Link className="btn ghost" href="/my">Cancel</Link>
      </div>
    </form>
  );
}
