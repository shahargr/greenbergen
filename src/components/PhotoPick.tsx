"use client";

import { useEffect, useRef, useState } from "react";

// A single-photo control: "Add photo" with two icons — attach (picker) or
// camera. The camera button opens a LIVE preview from the device camera
// (getUserMedia) with a Snap button — desktop browsers ignore a file input's
// `capture` hint and just open the picker, so this is what makes the camera
// actually work on a Mac. Phones without getUserMedia fall back to the native
// camera input. The chosen file is mirrored into a hidden carrier input so a
// plain server-action form posts it under `name`.
export function PhotoPick({ name, label = "Add photo" }: { name: string; label?: string }) {
  const carrier = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLInputElement>(null);
  const cam = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [err, setErr] = useState("");

  function take(f: File | null | undefined) {
    if (!f) return;
    const dt = new DataTransfer();
    dt.items.add(f);
    if (carrier.current) carrier.current.files = dt.files;
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(URL.createObjectURL(f));
  }
  function clear() {
    if (carrier.current) carrier.current.value = "";
    if (preview) URL.revokeObjectURL(preview);
    setFile(null);
    setPreview(null);
  }
  function stopCamera() {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setLive(false);
  }
  useEffect(() => () => stopCamera(), []); // release the camera on unmount

  async function openCamera() {
    setErr("");
    const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (!md?.getUserMedia) {
      // No live camera API (older phones): use the native camera input.
      cam.current?.click();
      return;
    }
    try {
      const s = await md.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 640 } }, audio: false });
      stream.current = s;
      setLive(true);
      // The <video> mounts on the next render; attach the stream then.
      requestAnimationFrame(() => {
        if (video.current) { video.current.srcObject = s; void video.current.play().catch(() => {}); }
      });
    } catch {
      setErr("Camera not available or permission denied — attach a photo instead.");
      cam.current?.click();
    }
  }
  function snap() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    // Square crop from the centre, capped at 640px.
    const side = Math.min(v.videoWidth, v.videoHeight);
    const size = Math.min(640, side);
    const c = document.createElement("canvas");
    c.width = size; c.height = size;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const sx = (v.videoWidth - side) / 2, sy = (v.videoHeight - side) / 2;
    // Mirror so the saved photo matches the mirrored preview.
    ctx.translate(size, 0); ctx.scale(-1, 1);
    ctx.drawImage(v, sx, sy, side, side, 0, 0, size, size);
    c.toBlob((blob) => {
      if (blob) take(new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" }));
      stopCamera();
    }, "image/jpeg", 0.88);
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <input ref={carrier} type="file" name={name} hidden />
        <input ref={pick} type="file" accept="image/*" hidden onChange={(e) => { take(e.target.files?.[0]); e.target.value = ""; }} />
        <input ref={cam} type="file" accept="image/*" capture="user" hidden onChange={(e) => { take(e.target.files?.[0]); e.target.value = ""; }} />
        <span className="small" style={{ fontWeight: 600 }}>{label}</span>
        <button type="button" className="btn ghost small" onClick={() => pick.current?.click()} title="Attach a photo" aria-label="Attach a photo">📎</button>
        <button type="button" className={live ? "btn small" : "btn ghost small"} onClick={() => (live ? stopCamera() : openCamera())} title={live ? "Close camera" : "Take a photo"} aria-label={live ? "Close camera" : "Take a photo"}>📷</button>
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover", border: "1px solid #e7e9e4" }} />
        )}
        {file && (
          <span className="muted small" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {file.name}
            <button type="button" onClick={clear} aria-label="Remove photo" style={{ border: "none", background: "none", cursor: "pointer", fontWeight: 700, padding: 0 }}>×</button>
          </span>
        )}
      </div>

      {live && (
        <div style={{ display: "grid", gap: 8, justifyItems: "start" }}>
          <video ref={video} autoPlay playsInline muted
            style={{ width: 240, height: 240, objectFit: "cover", borderRadius: 12, background: "#111", transform: "scaleX(-1)" }} />
          <div className="btn-row">
            <button type="button" className="btn small" onClick={snap}>📸 Snap</button>
            <button type="button" className="btn ghost small" onClick={stopCamera}>Cancel</button>
          </div>
        </div>
      )}
      {err && <p className="error small" style={{ margin: 0 }}>{err}</p>}
    </div>
  );
}
