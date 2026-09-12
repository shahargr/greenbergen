"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "./supabase/client";
import { friendly } from "./rpc";
import { useMicrophones } from "./useMicrophones";
import { MicPicker } from "./MicPicker";

// EVIDENCE, the way the scope screen does it: upload the file, record it with
// record_project_file, then hand the id up. In that order, so a files row
// never points at an object that is not there yet.
//
// The difference here is the microphone. record_project_file has classified
// 'audio' since it was written and user_entitlement.cap_voice already gates
// it per plan - the entitlement existed, the button did not. A person in a
// basement can say "the stack is boxed in behind this wall" in four seconds;
// typing it takes a minute and usually does not happen.
//
// It uploads as it goes and reports ids through onChange, so the form it sits
// in only has to submit them. Nothing here decides who may attach what: the
// database checks that the file belongs to the project before it links it.
export type Attached = { id: string; name: string; kind: string; preview?: string; mic?: string };

const kindOf = (mime: string, name: string) =>
  mime.startsWith("image/") ? "photo"
  : mime.startsWith("video/") ? "video"
  : mime.startsWith("audio/") ? "audio"
  : mime === "application/pdf" || /\.pdf$/i.test(name) ? "document"
  : "other";

const ICON: Record<string, string> = { photo: "🖼", video: "🎬", audio: "🎙", document: "📄", other: "📎" };



export function Evidence({
  projectId, caption = "Evidence", onChange, accept = "image/*,video/*,application/pdf", folder = "notes",
}: {
  projectId: string;
  caption?: string;
  onChange: (files: Attached[]) => void;
  accept?: string;
  // Where under the project the files land. "notes" by default; a payment
  // uploads under payments/<transaction id>, the folder the ledger reads.
  folder?: string;
}) {
  const pick = useRef<HTMLInputElement>(null);
  // The camera, as its own button (Shahar: "same comment, photo, upload,
  // voice memo" everywhere). On a phone it opens the camera; on a desktop
  // it is a second file picker limited to images.
  const cam = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Attached[]>([]);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  // Recording state. The recorder and its chunks are refs, not state: they
  // are machinery, and re-rendering on every audio chunk would be absurd.
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<BlobPart[]>([]);
  const started = useRef<number>(0);
  const [recording, setRecording] = useState(false);
  const [secs, setSecs] = useState(0);

  // Which microphone, remembered, and always named (useMicrophones).
  const { mics, micId, setMicId, constraint, micName, read: readMics } = useMicrophones();

  // A CAMERA BUTTON ONLY WHERE THERE IS A CAMERA. Shahar: "the take a photo
  // button opens up on my mac at attach file option, not the camera." It
  // does: capture="environment" is a hint phones honour and desktops ignore,
  // so on a laptop the two buttons did exactly the same thing under two
  // different names. This shows it only on a device that actually has a rear
  // camera to open - a coarse pointer with no hover, which is a phone or a
  // tablet.
  const [handheld, setHandheld] = useState(false);
  useEffect(() => {
    setHandheld(window.matchMedia?.("(pointer: coarse) and (hover: none)")?.matches ?? false);
  }, []);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setSecs(Math.floor((Date.now() - started.current) / 1000)), 250);
    return () => clearInterval(t);
  }, [recording]);

  // Stop the microphone if this unmounts mid-recording. A page that leaves a
  // recording light on is a page nobody trusts twice.
  useEffect(() => () => {
    try { rec.current?.stream.getTracks().forEach((t) => t.stop()); } catch { /* already gone */ }
  }, []);

  function publish(next: Attached[]) { setItems(next); onChange(next); }

  async function store(file: Blob, name: string, mime: string): Promise<Attached | null> {
    const supabase = createClient();
    const ext = (name.match(/\.[a-z0-9]+$/i)?.[0] ?? "").toLowerCase();
    const path = `${projectId}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    const { error: upErr } = await supabase.storage.from("project-media").upload(path, file, { contentType: mime || undefined });
    if (upErr) { setErr(`${name} did not upload: ${upErr.message}`); return null; }
    const kind = kindOf(mime, name);
    const { data, error } = await supabase.rpc("record_project_file", {
      p_project_id: projectId, p_path: path, p_file_name: name,
      p_mime: mime || null, p_size: (file as File).size ?? file.size, p_caption: caption, p_kind: kind,
    });
    if (error) { setErr(friendly(error.message)); return null; }
    // record_project_file answers with the id, sometimes wrapped.
    const id = (typeof data === "string" ? data : data?.file_id ?? data?.id ?? null) as string | null;
    if (!id) { setErr("That file was uploaded but not recorded."); return null; }
    // A photo and a recording both keep a local url: one to look at, one to
    // play back before it is posted.
    return {
      id, name, kind,
      preview: kind === "photo" || kind === "audio" ? URL.createObjectURL(file) : undefined,
    };
  }

  async function attach(files: FileList | null) {
    const picked = [...(files ?? [])].filter((f) => f.size > 0);
    if (picked.length === 0) return;
    setErr("");
    const out: Attached[] = [];
    for (let i = 0; i < picked.length; i++) {
      setBusy(picked.length === 1 ? "Uploading…" : `Uploading ${i + 1} of ${picked.length}…`);
      const got = await store(picked[i]!, picked[i]!.name, picked[i]!.type);
      if (!got) { setBusy(""); return; }
      out.push(got);
    }
    setBusy("");
    if (pick.current) pick.current.value = "";
    publish([...items, ...out]);
  }

  async function startRec() {
    setErr("");
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setErr("This browser can't record audio. You can still attach a file.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: constraint });
      // The first grant is what unlocks the device LABELS, so read them again.
      void readMics();
    } catch {
      // Denied, or no microphone. Both are the person's business, not an error.
      setErr("No microphone. Allow it in your browser settings, or attach a file instead.");
      return;
    }
    // Let the browser choose: Safari gives mp4, Chrome webm, and both are
    // fine in a storage bucket. Naming a codec it does not have throws.
    const mr = new MediaRecorder(stream);
    chunks.current = [];
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunks.current.push(e.data); };
    mr.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const type = mr.mimeType || "audio/webm";
      const blob = new Blob(chunks.current, { type });
      chunks.current = [];
      if (blob.size === 0) return;
      setBusy("Saving the recording…");
      const ext = type.includes("mp4") ? ".m4a" : type.includes("ogg") ? ".ogg" : ".webm";
      const got = await store(blob, `voice-note${ext}`, type);
      setBusy("");
      // Say which microphone it came off, so "did it use the USB one" is a
      // question the screen answers instead of one you have to ask.
      if (got) publish([...items, { ...got, mic: micName }]);
    };
    rec.current = mr;
    started.current = Date.now();
    setSecs(0);
    setRecording(true);
    mr.start();
  }

  function stopRec() {
    setRecording(false);
    try { rec.current?.stop(); } catch { /* already stopped */ }
    rec.current = null;
  }

  function remove(id: string) {
    // It stays in the project's files - it was really uploaded, and losing
    // it silently would be worse than an unused row. It simply stops riding
    // along with this note.
    publish(items.filter((i) => i.id !== id));
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      {items.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          {items.map((i) => (
            // A RECORDING PLAYS RIGHT HERE (Shahar: "i cannot play it back
            // after closing the record option to see what is there"). It was a
            // filename and nothing else, so there was no way to know whether
            // the microphone had heard you until the note was posted.
            i.kind === "audio" ? (
              <div className="stack" key={i.id} style={{ gap: 4 }}>
                <div className="row" style={{ gap: 10, alignItems: "center" }}>
                  <audio className="grow" src={i.preview} controls preload="metadata" style={{ height: 34, minWidth: 0 }} />
                  <button type="button" className="btn btn-ghost small" onClick={() => remove(i.id)}>Remove</button>
                </div>
                {i.mic && <span className="tiny text-muted">Recorded on {i.mic}.</span>}
              </div>
            ) : (
              <div className="row" key={i.id} style={{ gap: 10, alignItems: "center" }}>
                {i.preview
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={i.preview} alt="" style={{ width: 40, height: 40, borderRadius: 8, objectFit: "cover", flex: "none" }} />
                  : <span aria-hidden style={{ width: 40, height: 40, borderRadius: 8, background: "var(--color-soft-2)", display: "grid", placeItems: "center", flex: "none" }}>{ICON[i.kind] ?? "📎"}</span>}
                <span className="grow small" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.name}</span>
                <button type="button" className="btn btn-ghost small" onClick={() => remove(i.id)}>Remove</button>
              </div>
            )
          ))}
        </div>
      )}

      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        {/* Only where there IS a camera to open: on a laptop this button and
            the next one did the same thing under two names. */}
        {handheld && (
          <button type="button" className="btn btn-ghost small" disabled={!!busy || recording}
                  onClick={() => cam.current?.click()}>
            Take a photo
          </button>
        )}
        <button type="button" className="btn btn-ghost small" disabled={!!busy || recording}
                onClick={() => pick.current?.click()}>
          Attach photo / file
        </button>
        {recording ? (
          <button type="button" className="btn btn-primary small" onClick={stopRec}>
            <span className="rec-dot" aria-hidden /> Stop · {String(Math.floor(secs / 60)).padStart(2, "0")}:{String(secs % 60).padStart(2, "0")}
          </button>
        ) : (
          <button type="button" className="btn btn-ghost small" disabled={!!busy} onClick={() => void startRec()}>
            Record a voice note
          </button>
        )}
      </div>

      <MicPicker mics={mics} micId={micId} setMicId={setMicId} micName={micName} recording={recording} />

      <input ref={pick} type="file" multiple accept={accept} hidden
             onChange={(e) => void attach(e.target.files)} />
      <input ref={cam} type="file" multiple accept="image/*" capture="environment" hidden
             onChange={(e) => { void attach(e.target.files); e.target.value = ""; }} />

      {busy && <p className="tiny text-muted" style={{ margin: 0 }}>{busy}</p>}
      {err && <p className="tiny" style={{ color: "var(--color-danger)", margin: 0 }}>{err}</p>}
    </div>
  );
}
