"use client";

import { useEffect, useRef, useState } from "react";

// The one attachment control. Desktop: drag & drop or paste any number of
// files onto the zone. Everywhere: "Add files" (picker) or "Take photo".
//
// "Take photo" opens a LIVE preview from the camera (getUserMedia) with a
// Snap button, and stays open so several shots can be taken in a row. A file
// input's `capture` hint is ignored by desktop browsers — they just open the
// ordinary file picker — so the live preview is what makes the button work on
// a Mac. Devices without getUserMedia fall back to the native camera input.
//
// It works inside plain server-action forms: the files are mirrored into
// hidden <input type="file"> carriers (via DataTransfer), so a native submit
// posts them under the given field names — no client-side FormData needed.
// Files route by type: videos to `videoName`, PDFs to `docName` (when given),
// everything else to `name`.
export function FileDrop({
  name,
  accept = "image/*",
  videoName,
  docName,
  label = "Add files",
  hint,
  camera = true,
}: {
  name: string;
  accept?: string;
  videoName?: string;
  docName?: string;
  label?: string;
  hint?: string;
  camera?: boolean;
}) {
  const [staged, setStaged] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const [live, setLive] = useState(false);
  const [camErr, setCamErr] = useState("");
  const mainRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const preview = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);

  function put(ref: React.RefObject<HTMLInputElement | null>, list: File[]) {
    if (!ref.current) return;
    const dt = new DataTransfer();
    for (const f of list) dt.items.add(f);
    ref.current.files = dt.files;
  }
  function sync(files: File[]) {
    const vids = videoName ? files.filter((f) => f.type.startsWith("video/")) : [];
    const docs = docName ? files.filter((f) => f.type === "application/pdf") : [];
    put(mainRef, files.filter((f) => !vids.includes(f) && !docs.includes(f)));
    if (videoName) put(videoRef, vids);
    if (docName) put(docRef, docs);
  }
  function add(list: FileList | File[] | null | undefined) {
    const ok = Array.from(list ?? []).filter((f) => f.size > 0);
    if (!ok.length) return;
    setStaged((prev) => { const next = [...prev, ...ok]; sync(next); return next; });
  }
  function remove(i: number) {
    setStaged((prev) => { const next = prev.filter((_, j) => j !== i); sync(next); return next; });
  }

  function stopCamera() {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setLive(false);
  }
  useEffect(() => () => stopCamera(), []); // release the camera on unmount

  async function openCamera() {
    setCamErr("");
    const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (!md?.getUserMedia) { camRef.current?.click(); return; }
    try {
      // Rear camera where there is one; a laptop simply gives its only camera.
      const s = await md.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      stream.current = s;
      setLive(true);
      requestAnimationFrame(() => {
        if (preview.current) { preview.current.srcObject = s; void preview.current.play().catch(() => {}); }
      });
    } catch {
      setCamErr("No camera available, or permission was denied — attach a photo instead.");
      camRef.current?.click();
    }
  }
  function snap() {
    const v = preview.current;
    if (!v || !v.videoWidth) return;
    // Full frame, capped at 1280 wide so a site photo stays readable but small.
    const scale = Math.min(1, 1280 / v.videoWidth);
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, c.width, c.height);
    c.toBlob((blob) => {
      if (blob) add([new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" })]);
      // Camera stays open: a site visit is rarely one photo.
    }, "image/jpeg", 0.88);
  }

  return (
    <div
      tabIndex={0}
      onPaste={(e) => { const fs = Array.from(e.clipboardData?.files ?? []); if (fs.length) { e.preventDefault(); add(fs); } }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
      style={{
        border: `2px dashed ${over ? "var(--brand)" : "#cdd2cc"}`,
        background: over ? "#f0f6f2" : "#fafbfa",
        borderRadius: 10, padding: "10px 12px", display: "grid", gap: 8, outline: "none", minWidth: 0,
      }}
    >
      {/* Hidden carriers: what the form actually posts. */}
      <input ref={mainRef} type="file" name={name} multiple hidden />
      {videoName && <input ref={videoRef} type="file" name={videoName} multiple hidden />}
      {docName && <input ref={docRef} type="file" name={docName} multiple hidden />}
      {/* Pickers: feed the staged list, then reset so the same file can be re-picked. */}
      <input ref={pickRef} type="file" accept={accept} multiple hidden
        onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      {camera && (
        <input ref={camRef} type="file" accept="image/*" capture="environment" hidden
          onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button type="button" className="btn ghost small" onClick={() => pickRef.current?.click()}>📎 {label}</button>
        {camera && (
          <button type="button" className={live ? "btn small" : "btn ghost small"}
            onClick={() => (live ? stopCamera() : openCamera())}>
            📷 {live ? "Close camera" : "Take photo"}
          </button>
        )}
        <span className="muted small">{hint ?? "or drag & drop / paste here"}</span>
      </div>

      {live && (
        <div style={{ display: "grid", gap: 8, justifyItems: "start" }}>
          <video ref={preview} autoPlay playsInline muted
            style={{ width: "100%", maxWidth: 360, aspectRatio: "4 / 3", objectFit: "cover", borderRadius: 10, background: "#111" }} />
          <div className="btn-row">
            <button type="button" className="btn small" onClick={snap}>📸 Snap</button>
            <button type="button" className="btn ghost small" onClick={stopCamera}>Done</button>
          </div>
          <span className="muted small">Snap as many as you need — each one is added below.</span>
        </div>
      )}
      {camErr && <p className="error small" style={{ margin: 0 }}>{camErr}</p>}

      {staged.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {staged.map((f, i) => (
            <span key={`${f.name}-${i}`} className="extra-chip" style={{ display: "inline-flex", alignItems: "center", gap: 6, maxWidth: "100%" }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>
                {f.type.startsWith("image/") ? "🖼" : f.type.startsWith("video/") ? "🎬" : f.type === "application/pdf" ? "📄" : "📎"} {f.name || f.type || "file"}
              </span>
              <button type="button" aria-label={`Remove ${f.name}`} onClick={() => remove(i)}
                style={{ border: "none", background: "none", cursor: "pointer", fontWeight: 700, padding: 0 }}>×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
