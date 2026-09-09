"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "./supabase/client";
import { friendly } from "./rpc";
import { Notice } from "./ui";

// THE UPDATE SHEET, for every door.
//
// Shahar, on this exact sheet: "a great way to update tasks." It lived in the
// homeowner app as TaskDone; it is here now so the expert app, the homeowner
// app and the inbox rows all open the same one - a task looks the same
// wherever you meet it.
//
// "Update" never fires on one tap, and it is not the same word as "done".
// Most of what a person has to say about an open task is the middle of the
// story - I called the town, here are the photos the inspector wanted, still
// waiting on a part - and closing the task used to be the price of being
// heard. So the sheet posts an ENTRY: a comment, a voice memo, as many photos
// or files as they like, and then either
//   Post update    - the task stays open
//   Mark complete  - the same entry, and the task closes
// Attachments upload to project-media under the job, are recorded through
// record_project_file, and go to homeowner_task_update together - which only
// asks that you hold a seat on the project, so it serves every door.
type Attach = { id: string; file: File; kind: "file" | "audio"; url: string; seconds?: number };

let seq = 0;
const nextId = () => `a${++seq}`;

export function TaskSheet({
  projectId, actionId, title, onDone, trigger, completeFirst = false,
}: {
  projectId: string; actionId: string; title: string; onDone?: () => void;
  // What opens it. Default is the plain Update button; a row can pass its
  // own (a small "Complete" button that opens the sheet with closing in mind).
  trigger?: ReactNode;
  completeFirst?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [items, setItems] = useState<Attach[]>([]);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const fileIn = useRef<HTMLInputElement>(null);
  const camIn = useRef<HTMLInputElement>(null);

  // Revoke every preview the sheet made, once, when it goes away.
  useEffect(() => () => { for (const i of items) URL.revokeObjectURL(i.url); }, [items]);

  function add(files: FileList | null | undefined, kind: Attach["kind"] = "file") {
    if (!files?.length) return;
    setErr("");
    setItems((prev) => [...prev, ...Array.from(files).map((file) => ({ id: nextId(), file, kind, url: URL.createObjectURL(file) }))]);
  }
  function drop(id: string) {
    setItems((prev) => {
      const gone = prev.find((i) => i.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return prev.filter((i) => i.id !== id);
    });
  }

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
        const seconds = Math.round((Date.now() - startedAt.current) / 1000);
        const file = new File([blob], `voice-memo-${seconds}s.${blob.type.includes("mp4") ? "m4a" : "webm"}`, { type: blob.type });
        setItems((prev) => [...prev, { id: nextId(), file, kind: "audio", url: URL.createObjectURL(blob), seconds }]);
        setRecording(false);
      };
      recorder.current = mr;
      startedAt.current = Date.now();
      mr.start();
      setRecording(true);
    } catch {
      setErr("The microphone isn't available. Type a note or attach a photo instead.");
    }
  }
  function stopRec() { recorder.current?.stop(); }

  function reset() { setNote(""); setItems([]); setErr(""); setBusy(""); }
  function cancel() { if (recording) stopRec(); reset(); setOpen(false); }

  // Upload everything first, then one call carries the note, the file ids and
  // whether this entry also finishes the task.
  async function post(complete: boolean) {
    if (!complete && !note.trim() && items.length === 0) { setErr("Write a line or attach something first."); return; }
    setErr(""); setBusy(complete ? "Saving…" : "Posting…");
    const supabase = createClient();
    const ids: string[] = [];
    for (let n = 0; n < items.length; n++) {
      const it = items[n]!;
      setBusy(items.length === 1 ? "Uploading…" : `Uploading ${n + 1} of ${items.length}…`);
      const { path, ext } = storagePath(projectId, actionId, it.file.name);
      const { error: upErr } = await supabase.storage.from("project-media").upload(path, it.file, { contentType: it.file.type || undefined });
      if (upErr) { setBusy(""); setErr(`${it.file.name} didn't upload: ${upErr.message}. Nothing was posted.`); return; }
      const isAudio = it.kind === "audio" || it.file.type.startsWith("audio/");
      const { data: rec, error: recErr } = await supabase.rpc("record_project_file", {
        p_project_id: projectId, p_path: path, p_file_name: it.file.name || `attachment${ext}`,
        p_mime: it.file.type || (isAudio ? "audio/webm" : "application/octet-stream"), p_size: it.file.size,
        p_caption: `${complete ? "Done" : "Update"}: ${title}${note.trim() ? ` - ${note.trim()}` : ""}`,
        p_kind: isAudio ? "audio" : it.file.type.startsWith("image/") ? "photo" : "document",
      });
      if (recErr) { setBusy(""); setErr(`${friendly(recErr.message)}. Nothing was posted.`); return; }
      const id = (typeof rec === "string" ? rec : rec?.file_id ?? rec?.id ?? null) as string | null;
      if (id) ids.push(id);
    }
    setBusy(complete ? "Marking complete…" : "Posting the update…");
    const { data, error } = await supabase.rpc("homeowner_task_update", {
      p_project: projectId, p_action_id: actionId, p_note: note.trim() || null,
      p_file_ids: ids.length ? ids : null, p_complete: complete,
    });
    if (error || !data?.ok) { setBusy(""); setErr(friendly(data?.reason ?? error?.message)); return; }
    reset(); setOpen(false);
    if (complete) onDone?.();
    router.refresh();
  }

  const photos = items.filter((i) => i.file.type.startsWith("image/"));
  return (
    <>
      <span onClick={() => setOpen(true)} style={{ display: "contents" }}>
        {trigger ?? <button type="button" className="btn btn-secondary small">Update</button>}
      </span>
      {open && (
        <div className="sheet-back" role="dialog" aria-modal="true" aria-label="Update this task" onClick={(e) => { if (e.target === e.currentTarget && !busy) cancel(); }}>
          <div className="sheet">
            <div className="sheet-head"><div className="title">{completeFirst ? "Mark complete" : "Update, or flag as complete"}</div></div>
            <div className="body" style={{ gap: 12 }}>
              <div className="small text-muted" style={{ margin: 0 }}>{title}</div>
              <label className="field">
                <span className="field-label">Comment <span className="text-muted">(optional)</span></span>
                <textarea className="input" rows={2} placeholder="What happened, in a line." value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
              </label>

              <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                {!recording && <button type="button" className="btn btn-secondary" onClick={() => void startRec()}><MicIcon /> Voice memo</button>}
                {recording && <button type="button" className="btn btn-status" onClick={stopRec}><span className="rec-dot" aria-hidden /> Stop</button>}
                <button type="button" className="btn btn-secondary" onClick={() => camIn.current?.click()} disabled={recording}><CameraIcon /> Photo</button>
                <button type="button" className="btn btn-ghost" onClick={() => fileIn.current?.click()} disabled={recording}>Attach files</button>
              </div>

              {items.length > 0 && (
                <div className="stack" style={{ gap: 6 }}>
                  <div className="tiny text-muted">{items.length} attached{photos.length > 1 ? ` · ${photos.length} photos` : ""}</div>
                  {items.map((i) => (
                    <div key={i.id} className="row card pad" style={{ gap: 10, flexDirection: "row", alignItems: "center", padding: "8px 12px" }}>
                      {i.kind === "audio" ? (
                        <><audio controls src={i.url} style={{ flex: 1, height: 34 }} /><span className="small text-muted">{i.seconds}s</span></>
                      ) : (
                        <>
                          {i.file.type.startsWith("image/") && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={i.url} alt="" style={{ width: 34, height: 34, objectFit: "cover", borderRadius: 8 }} />
                          )}
                          <span className="grow small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.file.name}</span>
                        </>
                      )}
                      <button type="button" className="btn btn-ghost" onClick={() => drop(i.id)} disabled={!!busy}>Remove</button>
                    </div>
                  ))}
                </div>
              )}
              <input ref={camIn} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
              <input ref={fileIn} type="file" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />

              {err && <Notice kind="error">{err}</Notice>}
              <div className="stack" style={{ gap: 8, marginTop: 4 }}>
                {completeFirst ? (
                  <>
                    <button type="button" className={`btn btn-primary btn-block ${busy ? "busy" : ""}`} onClick={() => void post(true)} disabled={!!busy || recording}>
                      {busy ? <><span className="spin" /> {busy}</> : "Mark complete"}
                    </button>
                    <div className="row">
                      <button type="button" className="btn btn-secondary grow" onClick={() => void post(false)} disabled={!!busy || recording}>Just post the update</button>
                      <button type="button" className="btn btn-ghost" onClick={cancel} disabled={!!busy}>Cancel</button>
                    </div>
                  </>
                ) : (
                  <>
                    <button type="button" className={`btn btn-primary btn-block ${busy ? "busy" : ""}`} onClick={() => void post(false)} disabled={!!busy || recording}>
                      {busy ? <><span className="spin" /> {busy}</> : "Post update"}
                    </button>
                    <div className="row">
                      <button type="button" className="btn btn-secondary grow" onClick={() => void post(true)} disabled={!!busy || recording}>Mark complete</button>
                      <button type="button" className="btn btn-ghost" onClick={cancel} disabled={!!busy}>Cancel</button>
                    </div>
                  </>
                )}
              </div>
              <p className="tiny text-muted" style={{ margin: 0 }}>Nothing changes until you tap one. An update keeps the task open; Mark complete closes it. Either way the comment and attachments go on the task and, when a contractor is on the job, onto the timeline.</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Module-level so the render-purity lint leaves the clock alone.
const storagePath = (projectId: string, actionId: string, fileName: string) => {
  const ext = (fileName.match(/\.[a-z0-9]+$/i)?.[0] ?? "").toLowerCase();
  return { path: `${projectId}/tasks/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${actionId.slice(0, 8)}${ext}`, ext };
};

const MicIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
);
const CameraIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
);
