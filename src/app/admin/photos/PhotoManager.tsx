"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { setProjectPhoto } from "./actions";

type Row = {
  project_name: string;
  public_slug: string;
  hero_photo_url: string | null;
};

function slugExt(name: string) {
  const m = name.toLowerCase().match(/\.(jpe?g|png|webp|gif|avif)$/);
  return m ? m[0] : ".jpg";
}

export function PhotoManager({ rows }: { rows: Row[] }) {
  const [state, setState] = useState<Record<string, string>>({});
  const [urls, setUrls] = useState<Record<string, string | null>>(
    Object.fromEntries(rows.map((r) => [r.public_slug, r.hero_photo_url])),
  );

  async function upload(slug: string, file: File) {
    setState((s) => ({ ...s, [slug]: "Uploading..." }));
    const supabase = createClient();
    const path = `heroes/${slug}-${Date.now()}${slugExt(file.name)}`;

    const { error } = await supabase.storage
      .from("public-media")
      .upload(path, file, { upsert: true, contentType: file.type || undefined });
    if (error) {
      setState((s) => ({ ...s, [slug]: `Upload failed: ${error.message}` }));
      return;
    }

    const { data } = supabase.storage.from("public-media").getPublicUrl(path);
    const res = await setProjectPhoto(slug, data.publicUrl);
    if (res?.error) {
      setState((s) => ({ ...s, [slug]: res.error }));
      return;
    }
    setUrls((u) => ({ ...u, [slug]: data.publicUrl }));
    setState((s) => ({ ...s, [slug]: "Saved — live on the site." }));
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {rows.map((r) => (
        <div key={r.public_slug} className="card panel-item" style={{ borderTop: "none" }}>
          <span className="thumb" style={{ width: 64, height: 64 }}>
            {urls[r.public_slug] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={urls[r.public_slug]!} alt="" />
            ) : (
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 10.5 12 3l9 7.5" />
                <path d="M5 9.5V21h14V9.5" />
              </svg>
            )}
          </span>
          <div style={{ flex: 1 }}>
            <strong>{r.project_name}</strong>
            <div style={{ marginTop: 6 }}>
              <input
                type="file"
                accept="image/*"
                className="small"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload(r.public_slug, f);
                }}
              />
            </div>
            {state[r.public_slug] && (
              <div className={`small ${state[r.public_slug].startsWith("Saved") ? "muted" : "error"}`}>
                {state[r.public_slug]}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
