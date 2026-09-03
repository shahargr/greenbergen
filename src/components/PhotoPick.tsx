"use client";

import { useRef, useState } from "react";

// A single-photo control: "Add photo" with two icons — attach (picker) or
// camera (front camera, for a selfie) — and a round preview of the choice.
// The file is mirrored into a hidden carrier input so a plain server-action
// form posts it under `name`.
export function PhotoPick({ name, label = "Add photo" }: { name: string; label?: string }) {
  const carrier = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLInputElement>(null);
  const cam = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  function take(list: FileList | null) {
    const f = list?.[0];
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

  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <input ref={carrier} type="file" name={name} hidden />
      <input ref={pick} type="file" accept="image/*" hidden onChange={(e) => { take(e.target.files); e.target.value = ""; }} />
      <input ref={cam} type="file" accept="image/*" capture="user" hidden onChange={(e) => { take(e.target.files); e.target.value = ""; }} />
      <span className="small" style={{ fontWeight: 600 }}>{label}</span>
      <button type="button" className="btn ghost small" onClick={() => pick.current?.click()} title="Attach a photo" aria-label="Attach a photo">📎</button>
      <button type="button" className="btn ghost small" onClick={() => cam.current?.click()} title="Take a photo" aria-label="Take a photo">📷</button>
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
  );
}
