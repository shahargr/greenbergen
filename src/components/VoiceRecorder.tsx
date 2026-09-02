"use client";

import { useRef, useState } from "react";

// In-app voice recorder (MediaRecorder). Records, previews, and hands the
// audio Blob to the parent - which ships it to Supabase Storage while the
// database records it as a file linked to the task.
export function VoiceRecorder({ onReady }: { onReady: (blob: Blob | null) => void }) {
  const [state, setState] = useState<"idle" | "recording" | "done" | "unsupported">("idle");
  const [seconds, setSeconds] = useState(0);
  const [url, setUrl] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function start() {
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setState("unsupported");
      onReady(null);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
