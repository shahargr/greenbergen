"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { addPropertyPhoto, chooseCoverPhoto, removePropertyPhoto } from "./actions";

export type PropertyPhoto = { id: string; url: string; name: string | null; takenAt: string; cover: boolean };

const HouseGlyph = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M10 21v-6h4v6" />
  </svg>
);

// The project's album: every photo it has, the cover marked, any one of
// them a click away from becoming the cover. A property's album is the
// house; a job's is its own face on the board (without one it wears the
// house's photo - migration 063). Bytes go straight from the browser to
// Storage under <project>/photos/ - a server action only records them -
// because Vercel caps what an action may carry at 4.5 MB.
export function PropertyPhotos({ projectId, photos, canEdit, canRemove = canEdit, isHome = true }: {
  projectId: string; photos: PropertyPhoto[]; canEdit: boolean; canRemove?: boolean; isHome?: boolean;
}) {
  const router = useRouter();
  const pick = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const open = openIdx === null ? null : photos[openIdx] ?? null;

  const step = useCallback((d: number) => {
    setOpenIdx((i) => (i === null || photos.length === 0 ? null : (i + d + photos.length) % photos.length));
  }, [photos.length]);

  useEffect(() => {
    if (openIdx === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenIdx(null);
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openIdx, step]);

  async function upload(list: FileList | null) {
    const files = Array.from(list ?? []).filter((f) => f.size > 0);
    if (!files.length) return;
    setErr("");
    const supabase = createClient();
    let added = 0;
    for (const [i, file] of files.entries()) {
      setBusy(files.length > 1 ? `Uploading ${i + 1} of ${files.length}…` : "Uploading…");
      const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? ".jpg").toLowerCase();
      const path = `${projectId}/photos/${Date.now()}-${i}${ext}`;
      const { error } = await supabase.storage.from("project-media").upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (error) { setErr(`${file.name}: ${error.message}`); break; }
      const r = await addPropertyPhoto(projectId, { path, name: file.name || `photo${ext}`, mime: file.type, size: file.size });
      if (!r.ok) { setErr(`${file.name}: ${r.error}`); break; }
      added += 1;
    }
    setBusy("");
    if (added > 0) router.refresh();
  }

  async function makeCover(id: string) {
    setErr(""); setBusy("Saving…");
    const r = await chooseCoverPhoto(projectId, id);
    if (!r.ok) setErr(r.error);
    setBusy("");
    router.refresh();
  }

  async function remove(id: string) {
    if (!window.confirm(isHome ? "Remove this photo from the property?" : "Remove this photo from the project?")) return;
    setErr(""); setBusy("Removing…");
    const r = await removePropertyPhoto(projectId, id);
    if (!r.ok) setErr(r.error);
    setBusy("");
    setOpenIdx(null);
    router.refresh();
  }

  return (
    <div id="photos" className="card" style={{ display: "grid", gap: 10, scrollMarginTop: 80 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2 className="section-title" style={{ margin: 0 }}>Photos{photos.length > 0 ? ` · ${photos.length}` : ""}</h2>
        {canEdit && (
          <button type="button" className="btn small" disabled={!!busy} onClick={() => pick.current?.click()}>
            {busy || "＋ Add photos"}
          </button>
        )}
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        {canEdit
          ? isHome
            ? "The cover shows on your home page next to this property's open projects. Yours only — not the public showcase picture."
            : "The cover is this project's face on the board and on your home page. Until it has one, it shows the house's photo."
          : isHome ? "This property's photos, as its owner keeps them." : "This project's photos."}
      </p>

      {photos.length === 0 ? (
        canEdit ? (
          <button type="button" className="album-empty" disabled={!!busy} onClick={() => pick.current?.click()}>
            <HouseGlyph />
            <strong style={{ color: "var(--ink)" }}>Add photos</strong>
            <span className="small">The first one becomes the cover. You can pick another later.</span>
          </button>
        ) : (
          <div className="album-empty"><HouseGlyph /><span className="small">No photos yet.</span></div>
        )
      ) : (
        <div className="album">
          {photos.map((p, i) => (
            <div key={p.id} className={p.cover ? "album-tile cover" : "album-tile"}>
              <button type="button" className="album-open" onClick={() => setOpenIdx(i)} aria-label={p.cover ? "Open the cover photo" : "Open photo"}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={p.name ?? ""} loading="lazy" />
              </button>
              {p.cover && <span className="album-badge">Cover</span>}
              {canEdit && (
                <div className="album-actions">
                  {!p.cover && <button type="button" disabled={!!busy} onClick={() => makeCover(p.id)}>Set as cover</button>}
                  {canRemove && <button type="button" disabled={!!busy} onClick={() => remove(p.id)} aria-label="Remove photo">Remove</button>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {err && <p className="error small" style={{ margin: 0 }}>{err}</p>}
      <input ref={pick} type="file" accept="image/*" multiple hidden onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />

      {open && (
        <div className="lightbox" onClick={() => setOpenIdx(null)} role="dialog" aria-modal="true">
          {photos.length > 1 && (
            <button type="button" className="lightbox-nav" aria-label="Previous" style={{ left: 10 }}
              onClick={(e) => { e.stopPropagation(); step(-1); }}>‹</button>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={open.url} alt={open.name ?? "Photo"} onClick={(e) => e.stopPropagation()} />
          {photos.length > 1 && (
            <button type="button" className="lightbox-nav" aria-label="Next" style={{ right: 10 }}
              onClick={(e) => { e.stopPropagation(); step(1); }}>›</button>
          )}
          <button type="button" className="lightbox-close" aria-label="Close" onClick={() => setOpenIdx(null)}>×</button>
          <div className="lightbox-tools" onClick={(e) => e.stopPropagation()}>
            {open.cover
              ? <span className="lightbox-caption" style={{ position: "static", transform: "none" }}>✓ Cover photo</span>
              : canEdit && <button type="button" className="btn small" disabled={!!busy} onClick={() => makeCover(open.id)}>Set as cover</button>}
            {canRemove && (
              <button type="button" className="btn small" disabled={!!busy} style={{ background: "transparent", color: "#fff", borderColor: "#fff" }} onClick={() => remove(open.id)}>Remove</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
