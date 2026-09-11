"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@shared/supabase/client";
import { friendly } from "@shared/rpc";
import { Notice, StatusHero } from "@shared/ui";
import { Sheet } from "@shared/finance/Sheet";
import { JoinForm } from "@/app/join/JoinForm";

// "TELL ME WHAT YOU WOULD LIKE TO DO IN THE HOUSE" (Shahar, 2026-09-11).
//
// The front door's second way in: say it, don't type it. The recorder
// opens first, before any account exists, and the recording stays in the
// browser until it has somewhere to live - a file has to belong to a home
// the member is on (storage keys on it; rulebook 71 keeps the anonymous
// surface read-only). So after the recording: who you are (the same three
// fields as checkout, or Google), which house (your homes, or the address,
// which becomes your home through create_home_asset), and then the
// recording is filed under it and a quote request goes to a person with
// the recording attached - the same task homeowner_quote_request has
// always written. Nothing is charged, nothing is promised yet.
//
// Google leaves the page, so the recording is stashed (base64, session
// storage) before the hop and picked up again on /ask?voice=1.
type Step = "record" | "join" | "home" | "done";
type Home = { project_id: string; address: string | null; name: string | null };
const STASH = "gb_voice_ask";
const ELSEWHERE = "__elsewhere__";
const CODE = "general_contractor";

export function VoiceAsk({ signedIn, autoOpen = false, resume = false }: { signedIn: boolean; autoOpen?: boolean; resume?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(autoOpen);
  const [step, setStep] = useState<Step>("record");
  const [authed, setAuthed] = useState(signedIn);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string>("");
  const [secs, setSecs] = useState(0);
  const [recording, setRecording] = useState(false);
  const [homes, setHomes] = useState<Home[] | null>(null);
  const [pick, setPick] = useState<string>(ELSEWHERE);
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<BlobPart[]>([]);
  const started = useRef(0);

  // Back from Google: the recording waits in session storage.
  useEffect(() => {
    if (!resume) return;
    // Deferred a tick: the stash is an external store, read once after mount.
    const t = setTimeout(() => {
      try {
        const raw = sessionStorage.getItem(STASH);
        if (!raw) return;
        const { b64, type, secs: s } = JSON.parse(raw) as { b64: string; type: string; secs: number };
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const b = new Blob([bytes], { type });
        setBlob(b); setUrl(URL.createObjectURL(b)); setSecs(s ?? 0);
        setOpen(true); setStep(signedIn ? "home" : "join");
        sessionStorage.removeItem(STASH);
      } catch { /* nothing stashed, or storage blocked */ }
    }, 0);
    return () => clearTimeout(t);
  }, [resume, signedIn]);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setSecs(Math.floor((Date.now() - started.current) / 1000)), 250);
    return () => clearInterval(t);
  }, [recording]);
  useEffect(() => () => { try { rec.current?.stream.getTracks().forEach((t) => t.stop()); } catch { /* gone */ } }, []);

  // Once signed in, the homes on file decide the next question.
  useEffect(() => {
    if (step !== "home" || homes !== null) return;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase.rpc("homeowner_me");
      const list: Home[] = Array.isArray(data?.homes) ? data.homes.filter((h: Home) => !!h.address?.trim()) : [];
      setHomes(list);
      if (list.length > 0) setPick(list[0]!.address!);
    })();
  }, [step, homes]);

  async function startRec() {
    setErr("");
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setErr("This browser can't record audio. Start with a package instead, or call us.");
      return;
    }
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { setErr("No microphone. Allow it in your browser settings and try again."); return; }
    const mr = new MediaRecorder(stream);
    chunks.current = [];
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunks.current.push(e.data); };
    mr.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const type = mr.mimeType || "audio/webm";
      const b = new Blob(chunks.current, { type });
      chunks.current = [];
      if (b.size === 0) return;
      setBlob(b); setUrl(URL.createObjectURL(b));
    };
    rec.current = mr; started.current = Date.now(); setSecs(0); setRecording(true); mr.start();
  }
  function stopRec() { setRecording(false); try { rec.current?.stop(); } catch { /* already */ } rec.current = null; }

  function stash() {
    if (!blob) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const b64 = String(reader.result).split(",")[1] ?? "";
        sessionStorage.setItem(STASH, JSON.stringify({ b64, type: blob.type, secs }));
      } catch { /* too big or blocked: they can record again */ }
    };
    reader.readAsDataURL(blob);
  }

  async function send() {
    if (!blob) { setErr("Record it first."); return; }
    const chosen = homes && homes.length > 0 && pick !== ELSEWHERE ? homes.find((h) => h.address === pick) ?? null : null;
    const addr = chosen?.address ?? address.trim();
    if (!chosen && addr.length < 6) { setErr("Which house? The street address is enough."); return; }
    setBusy("Filing it…"); setErr("");
    const supabase = createClient();
    let project = chosen?.project_id ?? null;
    if (!project) {
      // The address becomes their home - the governed path, create_home_asset.
      const { data: added, error: addErr } = await supabase.rpc("homeowner_home_add", { p_address: addr, p_name: null });
      if (addErr) { setBusy(""); setErr(friendly(addErr.message)); return; }
      if (added && added.ok === false) { setBusy(""); setErr(friendly(added.reason)); return; }
      project = (added?.project_id ?? added?.home_id ?? added?.id ?? null) as string | null;
      if (!project) {
        const { data: me } = await supabase.rpc("homeowner_me");
        const list: Home[] = Array.isArray(me?.homes) ? me.homes : [];
        project = list.find((h) => (h.address ?? "").trim().toLowerCase() === addr.toLowerCase())?.project_id ?? list[0]?.project_id ?? null;
      }
      if (!project) { setBusy(""); setErr("The home was added but not found again. Try once more."); return; }
    }
    const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
    const path = `${project}/notes/voice-ask-${Date.now()}.${ext}`;
    setBusy("Saving the recording…");
    const { error: upErr } = await supabase.storage.from("project-media").upload(path, blob, { contentType: blob.type || undefined });
    if (upErr) { setBusy(""); setErr(`The recording did not upload: ${upErr.message}`); return; }
    const { data: fid, error: recErr } = await supabase.rpc("record_project_file", {
      p_project_id: project, p_path: path, p_file_name: `voice-note.${ext}`, p_mime: blob.type || null, p_size: blob.size,
      p_caption: "What I would like to do in the house (voice note from the front door)", p_kind: "audio",
    });
    if (recErr) { setBusy(""); setErr(friendly(recErr.message)); return; }
    const fileId = (typeof fid === "string" ? fid : fid?.file_id ?? fid?.id ?? null) as string | null;
    setBusy("Sending it to a person…");
    const { data, error } = await supabase.rpc("homeowner_quote_request", {
      p_code: CODE,
      p_note: `Voice note from the front door (${secs}s): "what I would like to do in the house". Listen to the recording attached to this task.`,
      p_address: addr || null, p_reach: "email", p_phone: null, p_file_ids: fileId ? [fileId] : null,
    });
    setBusy("");
    if (error) { setErr(friendly(error.message)); return; }
    if (data && data.ok === false) { setErr(friendly(data.reason)); return; }
    setStep("done");
    router.refresh();
  }

  const mm = `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;

  return (
    <>
      <button type="button" className="btn btn-ghost btn-block" style={{ gap: 8 }} onClick={() => { setOpen(true); setErr(""); }}>
        <MicIcon /> Tell me what you would like to do in the house
      </button>

      {open && (
        <Sheet title={step === "done" ? "Sent" : "What would you like to do in the house?"} onClose={() => { if (recording) stopRec(); setOpen(false); }}>
          {step === "record" && (
            <div className="stack" style={{ gap: 12 }}>
              <p className="small text-muted" style={{ margin: 0 }}>
                Say it the way you would to a neighbour: the room, what bothers you, what you have in mind. A person listens and comes back to you. Nothing is charged.
              </p>
              {!blob && !recording && (
                <button type="button" className="btn btn-primary btn-block" onClick={() => void startRec()}><MicIcon /> Start recording</button>
              )}
              {recording && (
                <button type="button" className="btn btn-status btn-block" onClick={stopRec}><span className="rec-dot" aria-hidden /> Stop · {mm}</button>
              )}
              {blob && !recording && (
                <>
                  <audio controls src={url} style={{ width: "100%" }} />
                  <div className="row" style={{ gap: 8 }}>
                    <button type="button" className="btn btn-ghost small" onClick={() => { setBlob(null); setUrl(""); setSecs(0); }}>Record again</button>
                    <button type="button" className="btn btn-primary grow" onClick={() => setStep(authed ? "home" : "join")}>Continue</button>
                  </div>
                </>
              )}
              {err && <Notice kind="error">{err}</Notice>}
            </div>
          )}

          {step === "join" && (
            <JoinForm
              refId={null}
              prefillName=""
              next="/ask?voice=1"
              embed={{
                title: "So a person can answer you.",
                lead: "Your name, email and phone. Already a member? The same email signs you in.",
                onBeforeGoogle: stash,
                onDone: () => { setAuthed(true); setStep("home"); },
                onMember: () => { setAuthed(true); setStep("home"); },
              }}
            />
          )}

          {step === "home" && (
            <div className="stack" style={{ gap: 12 }}>
              {url && <audio controls src={url} style={{ width: "100%" }} />}
              {homes === null ? (
                <p className="small text-muted" style={{ margin: 0 }}>One moment…</p>
              ) : homes.length > 0 ? (
                <label className="field">
                  <span className="field-label">Which house?</span>
                  <select className="input" value={pick} onChange={(e) => setPick(e.target.value)}>
                    {homes.map((h) => <option key={h.project_id} value={h.address!}>{h.name && h.name !== h.address ? `${h.name} — ${h.address}` : h.address}</option>)}
                    <option value={ELSEWHERE}>Somewhere else…</option>
                  </select>
                </label>
              ) : null}
              {(homes !== null && (homes.length === 0 || pick === ELSEWHERE)) && (
                <label className="field">
                  <span className="field-label">Which house? The address</span>
                  <input className="input" autoComplete="street-address" placeholder="14 Elm St, Teaneck" value={address} onChange={(e) => setAddress(e.target.value)} />
                  <p className="hint">It becomes your home on Green Bergen; the recording is filed under it.</p>
                </label>
              )}
              {err && <Notice kind="error">{err}</Notice>}
              <button type="button" className="btn btn-primary btn-block" disabled={!!busy || homes === null} onClick={() => void send()}>{busy || "Send it to a person"}</button>
            </div>
          )}

          {step === "done" && (
            <div className="stack" style={{ gap: 12 }}>
              <StatusHero kicker="Sent" title="A person has it.">
                We&apos;ll listen and come back to you by email within a couple of days with a clear next step. Nothing is charged, nothing is promised yet.
              </StatusHero>
              <button type="button" className="btn btn-primary btn-block" onClick={() => router.push("/project")}>See my home</button>
            </div>
          )}
        </Sheet>
      )}
    </>
  );
}

const MicIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" />
  </svg>
);
