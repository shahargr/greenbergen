"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@shared/supabase/client";
import { useMicrophones } from "@shared/useMicrophones";
import { MicPicker } from "@shared/MicPicker";
import { friendly } from "@shared/rpc";
import { clock } from "@shared/format";
import type { Message } from "@/lib/booking";
import { Notice } from "@shared/ui";

// Composer - attachment tray, input, photo / mic / send. A message goes out
// as: upload (if any) -> record_project_file -> homeowner_message_send. An
// unsent bubble stays on screen with Retry.

type Pending = { id: string; body: string; file?: File; preview?: string; kind?: "photo" | "audio"; state: "sending" | "failed"; error?: string };

export function Timeline({ projectId, messages, urls, counterpart, canSend }: { projectId: string; messages: Message[]; urls: Record<string, string>; counterpart: string | null; canSend: boolean }) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [attach, setAttach] = useState<{ file: File; preview: string; kind: "photo" | "audio" } | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [rec, setRec] = useState<"idle" | "recording" | "unsupported">("idle");
  const [secs, setSecs] = useState(0);
  const recRef = useRef<MediaRecorder | null>(null);
  // Which microphone, remembered and named - the same picker every recorder
  // in the system now has (useMicrophones).
  const { mics, micId, setMicId, constraint, micName, read: readMics } = useMicrophones();
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const cam = useRef<HTMLInputElement>(null);
  const lib = useRef<HTMLInputElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages.length, pending.length]);

  function pick(f: File | null | undefined) {
    if (!f) return;
    if (attach) URL.revokeObjectURL(attach.preview);
    setAttach({ file: f, preview: URL.createObjectURL(f), kind: f.type.startsWith("audio/") ? "audio" : "photo" });
  }

  async function startRec() {
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) { setRec("unsupported"); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: constraint });
      // The first grant is what unlocks the device labels.
      void readMics();
      const mime = MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => { if (e.data.size > 0) chunks.current.push(e.data); };
      r.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: r.mimeType || "audio/webm" });
        const ext = /mp4/.test(blob.type) ? "m4a" : "webm";
        const file = new File([blob], `voice-note.${ext}`, { type: blob.type });
        pick(file);
        setRec("idle");
      };
      recRef.current = r;
      r.start();
      setSecs(0);
      timer.current = setInterval(() => setSecs((s) => s + 1), 1000);
      setRec("recording");
    } catch { setRec("unsupported"); }
  }
  function stopRec(cancel = false) {
    if (timer.current) clearInterval(timer.current);
    if (cancel) { recRef.current!.onstop = () => recRef.current?.stream.getTracks().forEach((t) => t.stop()); }
    recRef.current?.stop();
    if (cancel) setRec("idle");
  }

  async function send(p?: Pending) {
    const body = p ? p.body : draft.trim();
    const file = p ? p.file : attach?.file;
    const kind = p ? p.kind : attach?.kind;
    if (!body && !file) return;
    const item: Pending = p ?? { id: newId(), body, file, preview: attach?.preview, kind, state: "sending" };
    setPending((q) => [...q.filter((x) => x.id !== item.id), { ...item, state: "sending", error: undefined }]);
    if (!p) { setDraft(""); setAttach(null); }
    const supabase = createClient();
    let fileId: string | null = null;
    if (file) {
      const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? (kind === "audio" ? ".webm" : ".jpg")).toLowerCase();
      const path = `${projectId}/timeline/${item.id}${ext}`;
      const { error: upErr } = await supabase.storage.from("project-media").upload(path, file, { contentType: file.type || undefined, upsert: true });
      if (upErr) { setPending((q) => q.map((x) => (x.id === item.id ? { ...x, state: "failed", error: upErr.message } : x))); return; }
      const { data, error } = await supabase.rpc("record_project_file", {
        p_project_id: projectId, p_path: path, p_file_name: file.name, p_mime: file.type || null, p_size: file.size,
        p_caption: kind === "audio" ? "Voice note" : body || "Photo from the timeline", p_kind: kind === "audio" ? "audio" : "photo",
      });
      if (error) { setPending((q) => q.map((x) => (x.id === item.id ? { ...x, state: "failed", error: friendly(error.message) } : x))); return; }
      fileId = data as string;
    }
    const { data: res, error: sendErr } = await supabase.rpc("homeowner_message_send", { p_project: projectId, p_body: body || null, p_file_id: fileId });
    if (sendErr || !res?.ok) { setPending((q) => q.map((x) => (x.id === item.id ? { ...x, state: "failed", error: friendly(res?.reason ?? sendErr?.message) } : x))); return; }
    setPending((q) => q.filter((x) => x.id !== item.id));
    router.refresh();
  }

  return (
    <>
      <div className="body" style={{ paddingBottom: 8 }}>
        {messages.length === 0 && pending.length === 0 && (
          <p className="small text-muted center" style={{ margin: "24px 0" }}>
            {canSend ? `Nothing yet — say hi${counterpart ? ` to ${counterpart}` : ""}. Everything here stays, for both of you.` : "The timeline opens once a contractor accepts. Until then your photos wait in the folder."}
          </p>
        )}
        <div className="thread">
          {messages.map((m) => (
            <div key={m.id} className={`bubble ${m.system ? "sys" : m.mine ? "me" : ""}`}>
              {m.file && m.file.kind === "photo" && urls[m.file.path] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={urls[m.file.path]} alt="" />
              )}
              {m.file && m.file.kind === "audio" && urls[m.file.path] && <audio controls preload="none" src={urls[m.file.path]} />}
              {m.body && m.body !== "(photo)" && <div>{m.body}</div>}
              {!m.system && <span className="who">{clock(m.sent_at)} · {m.mine ? "you" : m.who}{m.file ? ` · ${m.file.kind === "audio" ? "voice note" : "1 photo · lands in the folder too"}` : ""}</span>}
            </div>
          ))}
          {pending.map((p) => (
            <div key={p.id} className={`bubble me ${p.state === "failed" ? "unsent" : ""}`} style={p.state === "sending" ? { opacity: 0.6 } : undefined}>
              {p.preview && p.kind === "photo" && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.preview} alt="" />
              )}
              {p.kind === "audio" && <div className="small">Voice note</div>}
              {p.body && <div>{p.body}</div>}
              <span className="who">
                {p.state === "sending" ? "Sending…" : <><strong>Not sent</strong> · {p.error ?? "no connection"} · <button type="button" className="btn btn-ghost" style={{ padding: 0, minHeight: 0, fontSize: 11 }} onClick={() => void send(p)}>Retry</button></>}
              </span>
            </div>
          ))}
          <div ref={endRef} />
        </div>
      </div>

      {canSend && (
        <>
          {attach && (
            <div className="tray">
              {attach.kind === "photo" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={attach.preview} alt="" />
              ) : <span className="tag tag-accent">Voice note · {fmt(secs)}</span>}
              <span>{attach.kind === "photo" ? "1 photo attached · lands in the folder too" : "Ready to send"}</span>
              <button type="button" className="btn btn-ghost" style={{ marginLeft: "auto" }} onClick={() => { URL.revokeObjectURL(attach.preview); setAttach(null); }}>Remove</button>
            </div>
          )}
          {rec === "recording" ? (
            <div className="rec">
              <div className="row"><div className="bars">{Array.from({ length: 14 }).map((_, i) => <span key={i} />)}</div><strong className="mono">{fmt(secs)}</strong></div>
              <p className="small text-muted" style={{ margin: 0 }}>Recording. Voice notes stay on the timeline like everything else.</p>
              <MicPicker mics={mics} micId={micId} setMicId={setMicId} micName={micName} recording />
              <div className="row">
                <button type="button" className="btn btn-secondary" onClick={() => stopRec(true)}>Cancel</button>
                <button type="button" className="btn btn-primary" onClick={() => stopRec(false)}>Stop &amp; attach</button>
              </div>
            </div>
          ) : (
            <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(); }}>
              <button type="button" className="btn btn-secondary btn-icon" aria-label="Attach a photo" onClick={() => (typeof navigator !== "undefined" && /Mobi|Android/i.test(navigator.userAgent) ? cam : lib).current?.click()}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
              </button>
              <textarea className="input grow" rows={1} placeholder={`Message ${counterpart ?? ""}`.trim() + "…"} value={draft} onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
              {draft.trim() || attach ? (
                <button className="btn btn-primary btn-icon" aria-label="Send">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                </button>
              ) : (
                <button type="button" className="btn btn-secondary btn-icon" aria-label="Record a voice note" onClick={() => void startRec()}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
                </button>
              )}
              <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
              <input ref={lib} type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
            </form>
          )}
          {rec === "unsupported" && <div style={{ padding: "0 20px 12px" }}><Notice kind="error">No microphone here — send a photo or a line of text instead.</Notice></div>}
        </>
      )}
    </>
  );
}

const newId = () => `${Date.now()}`;
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
