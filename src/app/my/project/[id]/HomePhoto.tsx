"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { setCoverPhoto, clearCoverPhoto } from "./actions";

// The home's own photo, set by its owner. The bytes go straight from the
// browser to Storage under <project>/cover/ - never through a server action,
// which Vercel caps at 4.5 MB - and the action then records the file and
// points the project at it.
export function HomePhoto({ projectId, currentUrl }: { projectId: string; currentUrl: string | null }) {
  const router = useRouter();
  const pick = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  async function chosen(file: File | null | undefined) {
    if (!file) return;
    setErr("");
    setBusy("Uploading…");
    try {
      const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? ".jpg").toLowerCase();
      const path = `${projectId}/cover/cover-${Date.now()}${ext}`;
      const supabase = createClient();
      const { error } = await supabase.storage.from("project-media").upload(path, file, { contentType: file.type || undefined, upsert: true });
      if (error) { setErr(error.message); setBusy(""); return; }
      setBusy("Saving…");
      const r = await setCoverPhoto(projectId, { path, name: file.name || `cover${ext}`, mime: file.type, size: file.size });
      if (!r.ok) { setErr(r.error); setBusy(""); return; }
      setBusy("");
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
      setBusy("");
    }
  }
  async function remove() {
    setErr(""); setBusy("Removing…");
    const r = await clearCoverPhoto(projectId);
    if (!r.ok) setErr(r.error);
    setBusy("");
    router.refresh();
  }

  return (
    <div className="card" style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2 className="section-title" style={{ margin: 0 }}>Home photo</h2>
        <span className="btn-row" style={{ gap: 6 }}>
          <button type="button" className="btn small" disabled={!!busy} onClick={() => pick.current?.click()}>
            {busy || (currentUrl ? "Change photo" : "Add photo")}
          </button>
          {currentUrl && !busy && (
            <button type="button" className="btn ghost small" onClick={remove}>Remove</button>
          )}
        </span>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Shows on your home page next to this property&apos;s open projects. Yours only — it is not the public showcase picture.
      </p>
      {currentUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={currentUrl} alt="" style={{ width: "100%", maxWidth: 360, aspectRatio: "4 / 3", objectFit: "cover", borderRadius: 10, border: "1px solid #e7e9e4" }} />
      )}
      {err && <p className="error small" style={{ margin: 0 }}>{err}</p>}
      <input ref={pick} type="file" accept="image/*" hidden onChange={(e) => { chosen(e.target.files?.[0]); e.target.value = ""; }} />
    </div>
  );
}
