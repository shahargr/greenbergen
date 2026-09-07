"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@shared/supabase/client";
import { friendly } from "@shared/rpc";
import { Notice } from "@shared/ui";

// "Done" never fires on one tap. The button opens a sheet: an optional
// comment, a voice memo or a photo / file, then Save or Cancel. The
// attachment goes to project-media under the job's id (record_project_file),
// and homeowner_task_close gets the note and the file id together.
type Rec = { blob: Blob; url: string; seconds: number };

export function TaskDone({ projectId, actionId, title, onDone }: { projectId: string; actionId: string; title: string; onDone?: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [rec, setRec] = useState<Rec | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const fileIn = useRef<HTMLInputElement>(null);
  const camIn = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (rec) URL.revokeObjectURL(rec.url); }, [rec]);

  async function startRec() {
    setErr("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunks.current = [];
      mr.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: mr.mimeType || "audio/webm" });
        setRec({ blob, url: URL.createObjectURL(blob), seconds: Math.round((Date.now() - startedAt.current) / 1000) });
        setRecording(false);
      };
      recorder.current = mr;
      startedAt.current = Date.now();
      mr.start();
      setRecording(true);
      setFile(null);
    } catch {
      setErr("The microphone isn't available. Type a note or attach a photo instead.");
    }
  }
  function stopRec() { recorder.current?.stop(); }

  function reset() { setNote(""); setFile(null); setRec(null); setErr(""); setBusy(""); }
  function cancel() { if (recording) stopRec(); reset(); setOpen(false); }

  async function save() {
    setErr(""); setBusy("Saving…");
    const supabase = createClient();
    let fileId: string | null = null;
    const attach = file ?? (rec ? new File([rec.blob], `voice-memo.${rec.blob.type.includes("mp4") ? "m4a" : "webm"}`, { type: rec.blob.type }) : null);
    if (attach) {
      setBusy(rec && !file ? "Uploading the voice memo…" : "Uploading…");
      const ext = (attach.name.match(/\.[a-z0-9]+$/i)?.[0] ?? "").toLowerCase();
      const path = `${projectId}/tasks/${Date.now()}-${actionId.slice(0, 8)}${ext}`;
      const { error: upErr } = await supabase.storage.from("project-media").upload(path, attach, { contentType: attach.type || undefined });
      if (upErr) { setBusy(""); setErr(`Upload failed: ${upErr.message}. Nothing was marked done.`); return; }
      const isAudio = attach.type.startsWith("audio/");
      const { data: rec2, error: recErr } = await supabase.rpc("record_project_file", {
        p_project_id: projectId, p_path: path, p_file_name: attach.name, p_mime: attach.type || (isAudio ? "audio/webm" : "application/octet-stream"),
        p_size: attach.size, p_caption: `Done: ${title}${note.trim() ? ` - ${note.trim()}` : ""}`, p_kind: isAudio ? "audio" : attach.type.startsWith("image/") ? "photo" : "document",
      });
      if (recErr) { setBusy(""); setErr(`${friendly(recErr.message)}. Nothing was marked done.`); return; }
      fileId = (typeof rec2 === "string" ? rec2 : rec2?.file_id ?? rec2?.id ?? null) as string | null;
    }
    setBusy("Marking done…");
    const { data, error } = await supabase.rpc("homeowner_task_close", { p_project: projectId, p_action_id: actionId, p_note: note.trim() || null, p_file_id: fileId });
    if (error || !data?.ok) { setBusy(""); setErr(friendly(data?.reason ?? error?.message)); return; }
    reset(); setOpen(false);
    onDone?.();
    router.refresh();
  }

  return (
    <>
      <button type="button" className="btn btn-secondary" style={{ minHeight: 40 }} onClick={() => setOpen(true)}>Done</button>
      {open && (
        <div className="sheet-back" role="dialog" aria-modal="true" aria-label="Mark as done" onClick={(e) => { if (e.target === e.currentTarget && !busy) cancel(); }}>
          <div className="sheet">
            <div className="sheet-head"><div className="title">Mark as done</div></div>
            <div className="body" style={{ gap: 12 }}>
              <div className="small text-muted" style={{ margin: 0 }}>{title}</div>
              <label className="field">
                <span className="field-label">Comment <span className="text-muted">(optional)</span></span>
                <textarea className="input" rows={2} placeholder="What happened, in a line." value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
              </label>

              <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                {!recording && !rec && <button type="button" className="btn btn-secondary" onClick={() => void startRec()}><MicIcon /> Voice memo</button>}
                {recording && <button type="button" className="btn btn-status" onClick={stopRec}><span className="bars" style={{ height: 16 }}><span /><span /><span /><span /></span> Stop</button>}
                <button type="button" className="btn btn-secondary" onClick={() => camIn.current?.click()} disabled={recording}><CameraIcon /> Photo</button>
                <button type="button" className="btn btn-ghost" onClick={() => fileIn.current?.click()} disabled={recording}>Attach a file</button>
              </div>
              {rec && (
                <div className="row card pad" style={{ gap: 10, flexDirection: "row", alignItems: "center", padding: "10px 14px" }}>
                  <audio controls src={rec.url} style={{ flex: 1, height: 36 }} />
                  <span className="small text-muted">{rec.seconds}s</span>
                  <button type="button" className="btn btn-ghost" onClick={() => setRec(null)}>Remove</button>
                </div>
              )}
              {file && (
                <div className="row card pad" style={{ gap: 10, flexDirection: "row", alignItems: "center", padding: "10px 14px" }}>
                  <span className="grow small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</span>
                  <button type="button" className="btn btn-ghost" onClick={() => setFile(null)}>Remove</button>
                </div>
              )}
              <input ref={camIn} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); setRec(null); } e.target.value = ""; }} />
              <input ref={fileIn} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) { setFile(f); setRec(null); } e.target.value = ""; }} />

              {err && <Notice kind="error">{err}</Notice>}
              <div className="row" style={{ marginTop: 4 }}>
                <button type="button" className={`btn btn-primary grow ${busy ? "busy" : ""}`} onClick={() => void save()} disabled={!!busy || recording}>
                  {busy ? <><span className="spin" /> {busy}</> : "Save"}
                </button>
                <button type="button" className="btn btn-ghost" onClick={cancel} disabled={!!busy}>Cancel</button>
              </div>
              <p className="tiny text-muted" style={{ margin: 0 }}>Nothing changes until you tap Save. The comment and attachment go on the task and, when a contractor is on the job, onto the timeline.</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const MicIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
);
const CameraIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
);
