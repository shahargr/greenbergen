"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { shrink } from "@/lib/shrink";
import { setLandingHero } from "./actions";

// THE PHOTOGRAPH AT THE TOP OF THE HOMEOWNER LANDING PAGE.
//
// Shahar (2026-09-11): "1st 1/3 of page should be an image, and not text.
// image of couple in front of their house smiling as if they have completed a
// great project."
//
// Same road as a package photo: the browser writes straight to public-media
// (superadmin may, by policy), then the address is recorded on config through
// landing_hero_set, which refuses an address that is not one of ours. Until a
// photograph is uploaded the landing draws the house instead, so the page is
// never broken waiting for it.
export function LandingPhoto({ url }: { url: string | null }) {
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
    const path = `landing/hero-${Date.now().toString(36)}${ext}`;
    const { error } = await supabase.storage.from("public-media").upload(path, blob, { upsert: true, contentType: type });
    if (error) { setBusy(false); setNote(`Upload failed: ${error.message}`); return; }
    const publicUrl = supabase.storage.from("public-media").getPublicUrl(path).data.publicUrl;
    const res = await setLandingHero(publicUrl);
    setBusy(false);
    if (res?.error) { setNote(res.error); return; }
    setCurrent(publicUrl);
    setNote("Saved — on the landing page within five minutes (the public-copy cache).");
  }

  async function remove() {
    setBusy(true); setNote("Removing…");
    const res = await setLandingHero("");
    setBusy(false);
    if (res?.error) { setNote(res.error); return; }
    setCurrent(null);
    setNote("Removed. The landing page draws the house again.");
  }

  return (
    <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
      {current
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={current} alt="" style={{ width: 176, height: 108, objectFit: "cover", borderRadius: 10 }} />
        : <div className="muted small" style={{ width: 176, height: 108, borderRadius: 10, border: "1.5px dashed #ccc", display: "grid", placeItems: "center" }}>no photo</div>}
      <div style={{ display: "grid", gap: 6 }}>
        <span className="muted small">
          A couple in front of their house, pleased with what just got finished. It fills the top
          third of the homeowner landing page, cropped to the middle — so leave room around the
          faces and keep them away from the edges. Landscape, and the wider the better.
        </span>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn" disabled={busy} onClick={() => input.current?.click()}>
            {current ? "Replace photo" : "Upload photo"}
          </button>
          {current && <button type="button" className="btn ghost" disabled={busy} onClick={() => void remove()}>Remove</button>}
          {note && <span className="small muted">{note}</span>}
        </div>
        <input ref={input} type="file" accept="image/*" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
      </div>
    </div>
  );
}
