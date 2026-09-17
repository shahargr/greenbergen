"use client";

import { useEffect, useRef, useState } from "react";
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
//
// THREE BUTTONS, THE SAME THREE EVERYWHERE. Shahar (2026-09-17): "the 3
// buttons should be: Camera, File/Image (attach/drop), Voice, where every
// file created get an option to add a description." They used to change with
// the device - drop / attach / voice at a desk, photo / file / voice on a
// phone - which made the same box read differently on the two screens he
// moves between all day. Now it is one row whichever hand it is in. The
// camera on a phone is the camera; at a desk it is the webcam, opened in a
// small panel right here (a capture= hint is ignored by desktops, which is
// how "take a photo" once opened a file picker on his Mac). The file button
// is also the drop target - drop anywhere on the box and it lights up.
export type Attached = { id: string; name: string; kind: string; preview?: string; mic?: string; caption?: string };

// A file taken before there is a job to file it under (the To-do sheet, with
// "Decide tonight" still selected). Held in the browser with its preview and
// uploaded the moment a job is chosen - see `pending` below.
type Held = { key: string; blob: Blob; name: string; mime: string; kind: string; preview?: string };

const kindOf = (mime: string, name: string) =>
  mime.startsWith("image/") ? "photo"
  : mime.startsWith("video/") ? "video"
  : mime.startsWith("audio/") ? "audio"
  : mime === "application/pdf" || /\.pdf$/i.test(name) ? "document"
  : "other";

const ICON: Record<string, string> = { photo: "🖼", video: "🎬", audio: "🎙", document: "📄", other: "📎" };

// The three ways proof arrives, as one stroke each. Same hand as the rest of
// the line art: currentColor, no fill.
const g = { width: 17, height: 17, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

const CameraGlyph = () => (
  <svg {...g}><path d="M3 8h3l2-3h8l2 3h3v11H3z" /><circle cx="12" cy="13" r="3.6" /></svg>
);
const PaperclipGlyph = () => (
  <svg {...g}><path d="M20 11l-8.5 8.5a5 5 0 0 1-7-7L13 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 6" /></svg>
);
const MicGlyph = () => (
  <svg {...g}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" /></svg>
);

export function Evidence({
  projectId, caption = "Evidence", onChange, onHeld, accept = "image/*,video/*,application/pdf", folder = "notes",
}: {
  /** The job the files belong to. Null means "not yet": files are held in
   *  the browser and uploaded once a job arrives (record_project_file needs
   *  one, and so does the storage policy). */
  projectId: string | null;
  caption?: string;
  onChange: (files: Attached[]) => void;
  /** How many files are waiting for a job, so the form around this can say so. */
  onHeld?: (n: number) => void;
  accept?: string;
  // Where under the project the files land. "notes" by default; a payment
  // uploads under payments/<transaction id>, the folder the ledger reads.
  folder?: string;
}) {
  const pick = useRef<HTMLInputElement>(null);
  // The phone's camera: a file input with capture="environment", which a
  // phone opens as the camera and a desktop ignores. Desktops get the webcam
  // panel below instead.
  const cam = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Attached[]>([]);
  const [held, setHeld] = useState<Held[]>([]);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  // Recording state. The recorder and its chunks are refs, not state: they
  // are machinery, and re-rendering on every audio chunk would be absurd.
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<BlobPart[]>([]);
  const started = useRef<number>(0);
  const [recording, setRecording] = useState(false);
  const [secs, setSecs] = useState(0);

  // The webcam, at a desk: a live view and one button to take the frame.
  const video = useRef<HTMLVideoElement>(null);
  const camStream = useRef<MediaStream | null>(null);
  const [camOpen, setCamOpen] = useState(false);

  // Which microphone, remembered, and always named (useMicrophones).
  const { mics, micId, setMicId, constraint, micName, read: readMics } = useMicrophones();

  // PHONE OR DESK. A coarse pointer with no hover is a phone or a tablet,
  // whose camera the file input opens; anything else gets the webcam panel
  // and a drop target that actually means something.
  const [handheld, setHandheld] = useState(false);
  useEffect(() => {
    setHandheld(window.matchMedia?.("(pointer: coarse) and (hover: none)")?.matches ?? false);
  }, []);

  // DROP IT STRAIGHT ON (Shahar, 2026-09-15: "allow to drop an image here").
  // At a desk the file is already under the cursor - a drawing, a quote, a
  // photograph somebody emailed - and making you go through a file picker to
  // find what you are already holding is a step for nothing. `over` is a
  // counter rather than a flag because dragging across a child element fires
  // leave-then-enter, and a boolean flickers. The whole box is the target;
  // the file button is where it is announced.
  const [over, setOver] = useState(0);
  const dropping = over > 0 && !handheld;

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setSecs(Math.floor((Date.now() - started.current) / 1000)), 250);
    return () => clearInterval(t);
  }, [recording]);

  // Stop the microphone and the camera if this unmounts mid-use. A page that
  // leaves a recording light on is a page nobody trusts twice.
  useEffect(() => () => {
    try { rec.current?.stream.getTracks().forEach((t) => t.stop()); } catch { /* already gone */ }
    try { camStream.current?.getTracks().forEach((t) => t.stop()); } catch { /* already gone */ }
  }, []);

  function publish(next: Attached[]) { setItems(next); onChange(next); }

  async function store(file: Blob, name: string, mime: string, project: string): Promise<Attached | null> {
    const supabase = createClient();
    const ext = (name.match(/\.[a-z0-9]+$/i)?.[0] ?? "").toLowerCase();
    const path = `${project}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    const { error: upErr } = await supabase.storage.from("project-media").upload(path, file, { contentType: mime || undefined });
    if (upErr) { setErr(`${name} did not upload: ${upErr.message}`); return null; }
    const kind = kindOf(mime, name);
    const { data, error } = await supabase.rpc("record_project_file", {
      p_project_id: project, p_path: path, p_file_name: name,
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

  // One thing arriving, from any of the three buttons or a drop. With a job
  // it goes up now; without one it is held, with its preview, until there is
  // a job to put it under.
  async function take(blobs: { blob: Blob; name: string; mime: string; mic?: string }[]) {
    if (blobs.length === 0) return;
    setErr("");
    if (!projectId) {
      const more: Held[] = blobs.map((b) => {
        const kind = kindOf(b.mime, b.name);
        return {
          key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          blob: b.blob, name: b.name, mime: b.mime, kind,
          preview: kind === "photo" || kind === "audio" ? URL.createObjectURL(b.blob) : undefined,
        };
      });
      const next = [...held, ...more];
      setHeld(next); onHeld?.(next.length);
      return;
    }
    const out: Attached[] = [];
    for (let i = 0; i < blobs.length; i++) {
      setBusy(blobs.length === 1 ? "Uploading…" : `Uploading ${i + 1} of ${blobs.length}…`);
      const got = await store(blobs[i]!.blob, blobs[i]!.name, blobs[i]!.mime, projectId);
      if (!got) { setBusy(""); return; }
      out.push(blobs[i]!.mic ? { ...got, mic: blobs[i]!.mic } : got);
    }
    setBusy("");
    publish([...items, ...out]);
  }

  function attach(files: FileList | null) {
    const picked = [...(files ?? [])].filter((f) => f.size > 0);
    if (pick.current) pick.current.value = "";
    void take(picked.map((f) => ({ blob: f, name: f.name, mime: f.type })));
  }

  // THE JOB ARRIVED: send up what was held. Runs once per change of job, and
  // only while something waits. A file held under "Decide tonight" and then
  // filed under 55 Walnut goes where the note goes, which is the point.
  const flushing = useRef(false);
  useEffect(() => {
    if (!projectId || held.length === 0 || flushing.current) return;
    flushing.current = true;
    void (async () => {
      const out: Attached[] = [];
      for (let i = 0; i < held.length; i++) {
        setBusy(held.length === 1 ? "Uploading…" : `Uploading ${i + 1} of ${held.length}…`);
        const h = held[i]!;
        const got = await store(h.blob, h.name, h.mime, projectId);
        if (!got) break;
        out.push(got);
      }
      setBusy("");
      setHeld([]); onHeld?.(0);
      if (out.length) publish([...items, ...out]);
      flushing.current = false;
    })();
    // items/publish are deliberately not dependencies: this reacts to the job
    // and to what is held, and reads the current list when it runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, held]);

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
    mr.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const type = mr.mimeType || "audio/webm";
      const blob = new Blob(chunks.current, { type });
      chunks.current = [];
      if (blob.size === 0) return;
      const ext = type.includes("mp4") ? ".m4a" : type.includes("ogg") ? ".ogg" : ".webm";
      // Say which microphone it came off, so "did it use the USB one" is a
      // question the screen answers instead of one you have to ask.
      void take([{ blob, name: `voice-note${ext}`, mime: type, mic: micName }]);
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

  // THE WEBCAM, at a desk. A phone never comes here - its button opens the
  // camera app through the file input. No camera, or no permission, and the
  // button falls back to an image picker rather than to nothing.
  async function openCam() {
    setErr("");
    if (handheld) { cam.current?.click(); return; }
    if (!navigator.mediaDevices?.getUserMedia) { cam.current?.click(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      camStream.current = stream;
      setCamOpen(true);
      // The element mounts on the next render; attach the stream then.
      requestAnimationFrame(() => { if (video.current) { video.current.srcObject = stream; void video.current.play().catch(() => {}); } });
    } catch {
      setErr("No camera here — pick an image instead.");
      cam.current?.click();
    }
  }

  function closeCam() {
    try { camStream.current?.getTracks().forEach((t) => t.stop()); } catch { /* already gone */ }
    camStream.current = null;
    setCamOpen(false);
  }

  function snap() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d")?.drawImage(v, 0, 0);
    c.toBlob((blob) => {
      closeCam();
      if (!blob) { setErr("That frame did not come out. Try again."); return; }
      const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
      void take([{ blob, name: `photo-${stamp}.jpg`, mime: "image/jpeg" }]);
    }, "image/jpeg", 0.9);
  }

  function remove(id: string) {
    // It stays in the project's files - it was really uploaded, and losing
    // it silently would be worse than an unused row. It simply stops riding
    // along with this note.
    publish(items.filter((i) => i.id !== id));
  }

  function drop(key: string) {
    const next = held.filter((h) => h.key !== key);
    setHeld(next); onHeld?.(next.length);
  }

  // WHAT THIS FILE IS. Shahar (2026-09-14): "when uploading files, need to
  // have a line of description added optionally."
  //
  // Typed after the upload, saved when the box loses focus - the bytes are
  // already gone by the time anybody has words for them, and a description
  // is not worth a Save button of its own. If the write fails the text stays
  // on screen and says so, rather than vanishing as though it took.
  async function describe(id: string, caption: string) {
    const at = items.find((i) => i.id === id);
    if (!at || (at.caption ?? "") === caption) return;
    publish(items.map((i) => (i.id === id ? { ...i, caption } : i)));
    const supabase = createClient();
    const { data, error } = await supabase.rpc("portal_file_caption", { p_file_id: id, p_caption: caption || null });
    if (error) setErr(friendly(error.message, "That description did not save."));
    else if (data?.ok === false) setErr(data.reason ?? "That description did not save.");
    else setErr("");
  }

  const quiet = !!busy || recording || camOpen;

  return (
    <div className={`stack${dropping ? " dropping" : ""}`} style={{ gap: 8 }}
      onDragEnter={handheld ? undefined : (e) => { e.preventDefault(); setOver((n) => n + 1); }}
      onDragOver={handheld ? undefined : (e) => { e.preventDefault(); }}
      onDragLeave={handheld ? undefined : () => setOver((n) => Math.max(0, n - 1))}
      onDrop={handheld ? undefined : (e) => {
        e.preventDefault(); setOver(0);
        if (e.dataTransfer?.files?.length) attach(e.dataTransfer.files);
      }}>
      {/* ONE ATTACHMENT, ONE BLOCK. Shahar (2026-09-14): "fix the file name
          added and buttons so they are aligned left and all fit the width.
          its ok if the file description line is added below each file
          added." So: the thumbnail, the name and Remove on one line that
          cannot outgrow its column, then anything that belongs to that file
          underneath it - the player for a recording, the description for
          anything. */}
      {(items.length > 0 || held.length > 0) && (
        <div className="stack" style={{ gap: 8 }}>
          {items.map((i) => (
            <div className="attached" key={i.id}>
              <div className="attached-head">
                {i.preview && i.kind === "photo"
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img className="attached-thumb" src={i.preview} alt="" />
                  : <span className="attached-thumb glyph" aria-hidden>{ICON[i.kind] ?? "📎"}</span>}
                <span className="attached-name">{i.name}</span>
                <button type="button" className="btn btn-ghost small" onClick={() => remove(i.id)}>Remove</button>
              </div>

              {/* A RECORDING PLAYS RIGHT HERE (Shahar: "i cannot play it back
                  after closing the record option to see what is there"). It
                  was a filename and nothing else, so there was no way to know
                  whether the microphone had heard you until it was posted. */}
              {i.kind === "audio" && (
                <audio src={i.preview} controls preload="metadata" style={{ width: "100%", height: 34 }} />
              )}
              {i.mic && <span className="tiny text-muted">Recorded on {i.mic}.</span>}

              <input className="input attached-note" defaultValue={i.caption ?? ""}
                aria-label={`Description for ${i.name}`}
                placeholder="What this is — optional"
                onBlur={(e) => void describe(i.id, e.target.value.trim())} />
            </div>
          ))}

          {/* HELD, NOT YET FILED: the same block, with a tag saying why it
              has no description box yet - the description is written to the
              files row, and there is no row until there is a job. */}
          {held.map((h) => (
            <div className="attached held" key={h.key}>
              <div className="attached-head">
                {h.preview && h.kind === "photo"
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img className="attached-thumb" src={h.preview} alt="" />
                  : <span className="attached-thumb glyph" aria-hidden>{ICON[h.kind] ?? "📎"}</span>}
                <span className="attached-name">{h.name}</span>
                <span className="tag tag-outline" style={{ whiteSpace: "nowrap" }}>waiting for a job</span>
                <button type="button" className="btn btn-ghost small" onClick={() => drop(h.key)}>Remove</button>
              </div>
              {h.kind === "audio" && (
                <audio src={h.preview} controls preload="metadata" style={{ width: "100%", height: 34 }} />
              )}
            </div>
          ))}
        </div>
      )}

      {/* THE WEBCAM PANEL: the live view, take it or close it. Only ever
          open at a desk; a phone's camera is the camera app. */}
      {camOpen && (
        <div className="cam-panel">
          <video ref={video} autoPlay playsInline muted />
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn btn-primary grow" onClick={snap}>Take the photo</button>
            <button type="button" className="btn btn-ghost" onClick={closeCam}>Close</button>
          </div>
        </div>
      )}

      {/* THE PROOF, MADE VISIBLE. Shahar (2026-09-14): "make the attach photo
          / file, and record a voice note more visible. maybe add icons next
          to both." They were ghost buttons - grey text in a row of grey text
          - on a screen whose whole point is that you are standing on site
          holding a phone. Bordered, with a glyph, side by side.

          THREE ACROSS, ALWAYS, AND THE SAME THREE (Shahar, 2026-09-16: "The
          three icons for adding evidence must fit one line"; 2026-09-17:
          "Camera, File/Image (attach/drop), Voice"). */}
      <div className="proof-row three">
        <button type="button" className="proof-btn" disabled={quiet} onClick={() => void openCam()}>
          <CameraGlyph />
          <span>Camera</span>
        </button>
        <button type="button" className={`proof-btn${dropping ? " drop-on" : ""}`} disabled={quiet}
                onClick={() => pick.current?.click()}>
          <PaperclipGlyph />
          <span>{dropping ? "Let go" : "File / image"}</span>
        </button>
        {recording ? (
          <button type="button" className="proof-btn recording" onClick={stopRec}>
            <span className="rec-dot" aria-hidden />
            <span>{String(Math.floor(secs / 60)).padStart(2, "0")}:{String(secs % 60).padStart(2, "0")}</span>
          </button>
        ) : (
          <button type="button" className="proof-btn" disabled={!!busy || camOpen} onClick={() => void startRec()}>
            <MicGlyph />
            <span>Voice</span>
          </button>
        )}
      </div>
      {!handheld && !dropping && (
        <p className="tiny text-muted" style={{ margin: "-2px 0 0" }}>
          Or drop a file anywhere on this box. Each one gets a line to say what it is.
        </p>
      )}

      <MicPicker mics={mics} micId={micId} setMicId={setMicId} micName={micName} recording={recording} />

      <input ref={pick} type="file" multiple accept={accept} hidden
             onChange={(e) => attach(e.target.files)} />
      <input ref={cam} type="file" multiple accept="image/*" capture="environment" hidden
             onChange={(e) => { attach(e.target.files); e.target.value = ""; }} />

      {busy && <p className="tiny text-muted" style={{ margin: 0 }}>{busy}</p>}
      {err && <p className="tiny" style={{ color: "var(--color-danger)", margin: 0 }}>{err}</p>}
    </div>
  );
}
