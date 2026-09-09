"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@shared/supabase/client";
import { friendly } from "@shared/rpc";

// The picture of the house, on the home row.
//
// Nothing new was needed in the database for this: homeowner_photo_add takes
// ANY project the member is on and files the photo through
// record_project_file, and a home is a project. The one thing it did not do
// was hand the picture back on the homes list - homeowner_me does that now.
//
// It uploads on pick, like the job photo slots: one tap, no Save button to
// forget. The optimistic preview is shown immediately so the row does not
// sit blank while a phone photo goes up over cell data.
export function HomePhoto({ projectId, url, name }: { projectId: string; url: string | null; name: string }) {
  const router = useRouter();
  const pick = useRef<HTMLInputElement>(null);
  const [shown, setShown] = useState<string | null>(url);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function upload(file: File | null | undefined) {
    if (!file) return;
    setErr("");
    const preview = URL.createObjectURL(file);
    setShown(preview);
    setBusy(true);
    const supabase = createClient();
    const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? ".jpg").toLowerCase();
    const path = `${projectId}/photos/${Date.now()}-home${ext}`;
    const { error: upErr } = await supabase.storage.from("project-media").upload(path, file, { contentType: file.type || undefined });
    if (upErr) { setShown(url); setBusy(false); setErr(upErr.message); return; }
    // p_key null: a home has no package, so there is no photo slot to fill.
    const { data, error } = await supabase.rpc("homeowner_photo_add", {
      p_project: projectId, p_path: path, p_key: null,
      p_file_name: file.name || `home${ext}`, p_mime: file.type || "image/jpeg", p_size: file.size,
    });
    setBusy(false);
    if (error || !data?.ok) { setShown(url); setErr(friendly(data?.reason ?? error?.message)); return; }
    router.refresh();
  }

  return (
    <>
      <button type="button" className="pic-btn" onClick={() => pick.current?.click()}
              aria-label={shown ? `Change the photo of ${name}` : `Add a photo of ${name}`}
              style={{ padding: 0, border: 0, background: "none", cursor: "pointer", opacity: busy ? 0.6 : 1 }}>
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="pic" src={shown} alt="" />
        ) : (
          <span className="pic empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" />
            </svg>
          </span>
        )}
      </button>
      <input ref={pick} type="file" accept="image/*" hidden
             onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
      {err && <span className="tiny" style={{ color: "var(--color-danger)" }}>{err}</span>}
    </>
  );
}
