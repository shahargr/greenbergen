"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { setProjectPhoto, savePublicPage } from "./actions";

export type AdminRow = {
  project_name: string;
  public_slug: string;
  hero_photo_url: string | null;
  headline: string;
  body: string;
  scope_note: string;
  garage_note: string;
  total_sqft: string;
  built_year: string;
};

function fileExt(name: string) {
  const m = name.toLowerCase().match(/\.(jpe?g|png|webp|gif|avif|pdf)$/);
  return m ? m[0] : ".jpg";
}

function filePath(prefix: string, file: File) {
  // Derives from the file itself (mtime + size): new file = new URL
  // (cache-busting), same file re-picked overwrites in place.
  return `${prefix}-${file.lastModified.toString(36)}${file.size.toString(36)}${fileExt(file.name)}`;
}

export function PhotoManager({ rows }: { rows: AdminRow[] }) {
  const [filter, setFilter] = useState("");
  const [status, setStatus] = useState<Record<string, string>>({});
  const [heroes, setHeroes] = useState<Record<string, string | null>>(
    Object.fromEntries(rows.map((r) => [r.public_slug, r.hero_photo_url])),
  );
  const [form, setForm] = useState<Record<string, AdminRow>>(
    Object.fromEntries(rows.map((r) => [r.public_slug, { ...r }])),
  );

  function note(slug: string, text: string) {
    setStatus((s) => ({ ...s, [slug]: text }));
  }

  function edit(slug: string, field: keyof AdminRow, value: string) {
    setForm((f) => ({ ...f, [slug]: { ...f[slug], [field]: value } }));
  }

  async function uploadHero(slug: string, file: File) {
    note(slug, "Uploading photo...");
    const supabase = createClient();
    const path = `heroes/${filePath(slug, file)}`;
    const { error } = await supabase.storage
      .from("public-media")
      .upload(path, file, { upsert: true, contentType: file.type || undefined });
    if (error) return note(slug, `Upload failed: ${error.message}`);

    const { data } = supabase.storage.from("public-media").getPublicUrl(path);
    const res = await setProjectPhoto(slug, data.publicUrl);
    if (res?.error) return note(slug, res.error);
    setHeroes((h) => ({ ...h, [slug]: data.publicUrl }));
    note(slug, "Photo saved — live on the site.");
  }

  async function uploadGallery(slug: string, kind: string, files: FileList) {
    const supabase = createClient();
    let done = 0;
    for (const file of Array.from(files)) {
      note(slug, `Uploading ${done + 1} of ${files.length}...`);
      const path = `gallery/${slug}/${filePath(kind, file)}`;
      const { error } = await supabase.storage
        .from("public-media")
        .upload(path, file, { upsert: true, contentType: file.type || undefined });
      if (error) return note(slug, `Upload failed on ${file.name}: ${error.message}`);
      done += 1;
    }
    note(slug, `${done} file${done > 1 ? "s" : ""} added — live on the project page.`);
  }

  async function save(slug: string) {
    note(slug, "Saving...");
    const f = form[slug];
    const res = await savePublicPage(slug, {
      headline: f.headline,
      body: f.body,
      scope_note: f.scope_note,
      garage_note: f.garage_note,
      total_sqft: f.total_sqft,
      built_year: f.built_year,
    });
    note(slug, res?.error ?? "Saved — live on the site.");
  }

  const visible = rows.filter((r) =>
    r.project_name.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <input
        className="input"
        placeholder="Filter projects..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        style={{ maxWidth: 320 }}
      />
      {visible.map((r) => {
        const f = form[r.public_slug];
        return (
          <div key={r.public_slug} className="card" style={{ padding: "18px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <span className="thumb" style={{ width: 56, height: 56 }}>
                {heroes[r.public_slug] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={heroes[r.public_slug]!} alt="" />
                ) : (
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 10.5 12 3l9 7.5" />
                    <path d="M5 9.5V21h14V9.5" />
                  </svg>
                )}
              </span>
              <strong style={{ fontSize: 16 }}>{r.project_name}</strong>
            </div>

            <div className="field">
              <label>Hero photo</label>
              <input type="file" accept="image/*" className="small"
                onChange={(e) => { const file = e.target.files?.[0]; if (file) uploadHero(r.public_slug, file); }} />
            </div>

            <div className="field">
              <label>Add plan / photo to the gallery</label>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <select className="input" style={{ width: 140 }} id={`kind-${r.public_slug}`} defaultValue="photo">
                  <option value="elevation">Elevation</option>
                  <option value="floorplan">Floor plan</option>
                  <option value="photo">Photo</option>
                </select>
                <input type="file" accept="image/*" multiple className="small"
                  onChange={(e) => {
                    const files = e.target.files;
                    const kind = (document.getElementById(`kind-${r.public_slug}`) as HTMLSelectElement)?.value ?? "photo";
                    if (files && files.length > 0) uploadGallery(r.public_slug, kind, files);
                  }} />
              </div>
            </div>

            <div className="field">
              {/* This OVERRIDES the page headline ("About <project>"). */}
              <label>Headline — overrides &ldquo;About {r.project_name}&rdquo; on the public page (empty = template)</label>
              <input className="input" value={f.headline}
                onChange={(e) => edit(r.public_slug, "headline", e.target.value)} />
            </div>
            <div className="field">
              <label>About text (empty = template)</label>
              <textarea className="input" rows={4} value={f.body}
                onChange={(e) => edit(r.public_slug, "body", e.target.value)} />
            </div>
            <div className="form-2col">
              <div className="field">
                <label>Garage setup (e.g. 2-car attached)</label>
                <input className="input" value={f.garage_note}
                  onChange={(e) => edit(r.public_slug, "garage_note", e.target.value)} />
              </div>
              <div className="field">
                <label>Built area (sq ft)</label>
                <input className="input" inputMode="numeric" value={f.total_sqft}
                  onChange={(e) => edit(r.public_slug, "total_sqft", e.target.value)} />
              </div>
            </div>
            <div className="field" style={{ maxWidth: 200 }}>
              <label>Built (year)</label>
              <input className="input" inputMode="numeric" value={f.built_year}
                onChange={(e) => edit(r.public_slug, "built_year", e.target.value)} />
            </div>
            <div className="field">
              <label>Scope line (your own words)</label>
              <input className="input" value={f.scope_note}
                onChange={(e) => edit(r.public_slug, "scope_note", e.target.value)} />
            </div>

            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <button className="btn" onClick={() => save(r.public_slug)}>Save</button>
              {status[r.public_slug] && (
                <span className={`small ${status[r.public_slug].includes("failed") || status[r.public_slug].includes("Could not") ? "error" : "muted"}`}>
                  {status[r.public_slug]}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
