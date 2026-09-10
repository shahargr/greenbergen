"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { setPackagePhoto } from "../actions";

// THE PHOTOGRAPH OF THE WORK, uploaded from here. Admin > Photos only takes
// house photos for public project pages, so a package photo had nowhere to
// go but a pasted address (Shahar sent two photographs and there was no
// button). Same path as the hero uploader: the browser writes straight to
// public-media (superadmin may, by policy), then the address is recorded
// on the package through admin_package_save.
//
// RESIZED BEFORE IT LEAVES THE BROWSER. The landing page draws this on a
// phone; a 3 MB original there is the slowest thing on the screen (see the
// weekly site speed task). Long edge 1600 px, JPEG at 0.82 - a few hundred
// kilobytes for a photograph this size. If the browser cannot decode the
// file (some HEIC), the original goes up as it is rather than nothing.
const LONG_EDGE = 1600;

async function shrink(file: File): Promise<{ blob: Blob; ext: string; type: string }> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, LONG_EDGE / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.82));
    if (!blob) throw new Error("no blob");
    return { blob, ext: ".jpg", type: "image/jpeg" };
  } catch {
    const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? ".jpg").toLowerCase();
    return { blob: file, ext, type: file.type || "image/jpeg" };
  }
}

export function PackagePhoto({ code, url }: { code: string; url: string | null }) {
  const input = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState<string | null>(url);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setBusy(true); setNote("Shrinking…");
    const { blob, ext, type } = await shrink(file);
    setNote(`Uploading ${Math.round(blob.size / 1024)} KB…`);
    const supabase = createClient();
    // A new name per upload, so a replaced photo is a new URL and no cache
    // anywhere keeps showing the old one.
    const path = `packages/${code}-${Date.now().toString(36)}${ext}`;
    const { error } = await supabase.storage.from("public-media").upload(path, blob, { upsert: true, contentType: type });
    if (error) { setBusy(false); setNote(`Upload failed: ${error.message}`); return; }
    const publicUrl = supabase.storage.from("public-media").getPublicUrl(path).data.publicUrl;
    const res = await setPackagePhoto(code, publicUrl);
    setBusy(false);
    if (res?.error) { setNote(res.error); return; }
    setCurrent(publicUrl);
    setNote("Saved — on the landing page within five minutes (the catalogue cache).");
  }

  async function remove() {
    setBusy(true); setNote("Removing…");
    const res = await setPackagePhoto(code, "");
    setBusy(false);
    if (res?.error) { setNote(res.error); return; }
    setCurrent(null);
    setNote("Removed. The landing page draws the illustration again.");
  }

  return (
    <div style={{ gridColumn: "span 6", display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
      {current
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={current} alt="" style={{ width: 128, height: 96, objectFit: "cover", borderRadius: 10 }} />
        : <div className="muted small" style={{ width: 128, height: 96, borderRadius: 10, border: "1.5px dashed #ccc", display: "grid", placeItems: "center" }}>no photo</div>}
      <div style={{ display: "grid", gap: 6 }}>
        <span className="muted small">Photo of the work - a professional at it, in a house. Shown large on the homeowner landing page when the package is featured.</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn" disabled={busy} onClick={() => input.current?.click()}>{current ? "Replace photo" : "Upload photo"}</button>
          {current && <button type="button" className="btn ghost" disabled={busy} onClick={() => void remove()}>Remove</button>}
          {note && <span className="small muted">{note}</span>}
        </div>
        <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
      </div>
    </div>
  );
}
