"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// In-app voice recorder (MediaRecorder). Records, previews, and hands the
// audio Blob to the parent - which ships it to Supabase Storage while the
// database records it as a file linked to the task.
export function VoiceRecorder({ onReady }: { onReady: (blob: Blob | null) => void }) {
  const [state, setState] = useState<"idle" | "recording" | "done" | "unsupported">("idle");
  const [seconds, setSeconds] = useState(0);
  const [url, setUrl] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  // WHICH MICROPHONE. Shahar (2026-09-12): "you already mentioned that you
  // will get the opportunity to select microphone when working on a computer
  // with more than one microphone. you failed to do this across all screens?"
  // He was right. The apps share useMicrophones for this; the portal does not
  // compile apps/ (see CLAUDE.md), so it keeps the same rule here. The browser
  // picks the system default otherwise - on a Mac usually the built-in one
  // even with a USB mic plugged in - and never says which it chose.
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState("");
  const readMics = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices?.enumerateDevices();
      const ins = (all ?? []).filter((d) => d.kind === "audioinput");
      setMics(ins);
      setMicId((cur) => (cur && ins.some((d) => d.deviceId === cur) ? cur : ins[0]?.deviceId ?? ""));
    } catch { /* no permission yet: the system default is used */ }
  }, []);
  useEffect(() => { void readMics(); }, [readMics]);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function start() {
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setState("unsupported");
      onReady(null);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: micId ? { deviceId: { exact: micId } } : true,
      });
      // The first grant is what unlocks the device labels.
      void readMics();
      const mime = MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        setUrl(URL.createObjectURL(blob));
        setState("done");
        onReady(blob);
      };
      recRef.current = rec;
      rec.start();
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      setState("recording");
    } catch {
      setState("unsupported");
      onReady(null);
    }
  }

  function stop() {
    if (timerRef.current) clearInterval(timerRef.current);
    recRef.current?.stop();
  }

  function reset() {
    setUrl(null);
    setSeconds(0);
    setState("idle");
    onReady(null);
  }

  if (state === "unsupported") {
    return (
      <p className="error small" style={{ margin: 0 }}>
        Recording is not available here (no microphone access) — pick a photo
        or write the reason instead.
      </p>
    );
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {state === "idle" && (
        <div>
          <button type="button" className="btn ghost" onClick={start}>🎙 Record voice</button>
        </div>
      )}
      {mics.length > 1 && state !== "recording" && (
        <label className="btn-row" style={{ alignItems: "center", gap: 8, marginBottom: 6 }}>
          <span className="muted small" style={{ flex: "none" }}>Microphone</span>
          <select className="input" value={micId} onChange={(e) => setMicId(e.target.value)} style={{ maxWidth: 260 }}>
            {mics.map((d, n) => <option key={d.deviceId || n} value={d.deviceId}>{d.label || `Microphone ${n + 1}`}</option>)}
          </select>
        </label>
      )}
      {state === "recording" && (
        <div className="btn-row">
          <span className="small" style={{ color: "#a03a2b", fontWeight: 700 }}>
            ● Recording… {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
          </span>
          <button type="button" className="btn" onClick={stop}>■ Stop</button>
        </div>
      )}
      {state === "done" && url && (
        <div style={{ display: "grid", gap: 8 }}>
          <audio controls src={url} style={{ width: "100%" }} />
          <div>
            <button type="button" className="btn ghost" onClick={reset}>Record again</button>
          </div>
        </div>
      )}
    </div>
  );
}
