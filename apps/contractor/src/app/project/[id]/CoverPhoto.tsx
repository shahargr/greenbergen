"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@shared/supabase/client";
import { friendly } from "@shared/rpc";

// THE FACE OF A JOB. Shahar (2026-09-11): "where can we edit projects &
// scope? This is where we need to allow an upload of an image." The board
// and this screen show a project's cover; without one the job wears the
// house's photo (migration 063), and until now the only place to choose one
// was the portal's Setup tab - and only on a property.
//
// One tap: the phone offers camera or library, the bytes go straight to
// Storage under <project>/photos/ (a server action would cap them at
// 4.5 MB), record_project_file writes the files row, and project_cover_set
// - the one write path, which refuses a check or a receipt - makes it the
// face. Whoever runs the site may do this (rank 50 and up).
export function CoverPhoto({ projectId, url, own, canEdit }: {
  projectId: string; url: string | null; own: boolean; canEdit: boolean;
}) {
  const router = useRouter();
  const pick = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  async function upload(list: FileList | null) {
    const file = Array.from(list ?? []).find((f) => f.size > 0);
    if (!file) return;
    setErr(""); setBusy("Uploading…");
    const supabase = createClient();
    const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? ".jpg").toLowerCase();
    const path = `${projectId}/photos/${Date.now()}${ext}`;
    const { error: upErr } = await supabase.storage.from("project-media")
      .upload(path, file, { contentType: file.type || undefined, upsert: false });
    if (upErr) { setBusy(""); setErr(`${file.name}: ${upErr.message}`); return; }

    const { data: rec, error: recErr } = await supabase.rpc("record_project_file", {
      p_project_id: projectId, p_path: path, p_file_name: file.name || `photo${ext}`,
      p_mime: file.type || null, p_size: file.size, p_caption: "Project photo", p_kind: "photo",
    });
    if (recErr) { setBusy(""); setErr(friendly(recErr.message)); return; }
    const fileId = (typeof rec === "string" ? rec : rec?.file_id ?? rec?.id ?? null) as string | null;
    if (!fileId) { setBusy(""); setErr("The photo was uploaded but not recorded."); return; }

    const { data, error } = await supabase.rpc("project_cover_set", { p_project: projectId, p_file_id: fileId });
    setBusy("");
    if (error) { setErr(friendly(error.message)); return; }
    if (!data?.ok) { setErr(data?.reason ?? "Could not set the photo."); return; }
    router.refresh();
  }

  const input = (
    <input ref={pick} type="file" accept="image/*" hidden
      onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
  );

  if (!url) {
    if (!canEdit) return null;
    return (
      <div className="stack" style={{ gap: 4 }}>
        <button type="button" className="cover-empty" disabled={!!busy} onClick={() => pick.current?.click()}>
          <span style={{ fontSize: 22 }} aria-hidden>📷</span>
          <strong>{busy || "Add a photo of this project"}</strong>
          <span className="tiny text-muted">It becomes the face on the board.</span>
        </button>
        {err && <p className="tiny" style={{ color: "var(--color-danger)", margin: 0 }}>{err}</p>}
        {input}
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 4 }}>
      <div style={{ position: "relative" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="shot" src={url} alt=""
          style={{ width: "100%", height: 150, objectFit: "cover", borderRadius: "var(--radius-tile)", display: "block" }} />
        {canEdit && (
          <button type="button" className="cover-change" disabled={!!busy} onClick={() => pick.current?.click()}>
            {busy || (own ? "Change photo" : "Add this project's photo")}
          </button>
        )}
      </div>
      {canEdit && !own && !busy && (
        <p className="tiny text-muted" style={{ margin: 0 }}>Showing the house&apos;s photo until this project has one of its own.</p>
      )}
      {err && <p className="tiny" style={{ color: "var(--color-danger)", margin: 0 }}>{err}</p>}
      {input}
    </div>
  );
}
