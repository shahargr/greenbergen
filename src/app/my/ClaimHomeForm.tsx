"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { createHomeStart } from "./actions";
import { addPropertyPhoto } from "./project/[id]/actions";

// Claiming a home: a name, an address, and - optionally - the picture that
// will be its cover. The home is created first, then the photo goes from the
// browser straight to Storage under the new project and is recorded as its
// cover, the same path the album on its Setup tab uses.
export function ClaimHomeForm({
  buttonLabel = "Add home",
  namePlaceholder = "The Closter house",
  addressPlaceholder = "12 Maple Ave, Tenafly NJ",
  labels = true,
  cancelHref,
  style,
}: {
  buttonLabel?: string;
  namePlaceholder?: string;
  addressPlaceholder?: string;
  labels?: boolean;
  cancelHref?: string;
  style?: React.CSSProperties;
}) {
  const router = useRouter();
  const pick = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  function chosen(f: File | null | undefined) {
    if (preview) URL.revokeObjectURL(preview);
    setPhoto(f ?? null);
    setPreview(f ? URL.createObjectURL(f) : null);
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") ?? "").trim();
    const address = String(fd.get("address") ?? "").trim();
    if (!name || !address) { setErr("Name and address are both needed."); return; }
    setErr("");
    setBusy("Adding your home…");
    const create = new FormData();
    create.set("name", name); create.set("address", address); create.set("mode", "claim");
    const made = await createHomeStart(create);
    if (!made.ok) { setErr(made.error); setBusy(""); return; }
    if (photo) {
      setBusy("Uploading the photo…");
      const ext = (photo.name.match(/\.[a-z0-9]+$/i)?.[0] ?? ".jpg").toLowerCase();
      const path = `${made.projectId}/photos/${Date.now()}${ext}`;
      const supabase = createClient();
      const { error } = await supabase.storage.from("project-media").upload(path, photo, { contentType: photo.type || undefined });
      const r = error ? { ok: false as const, error: error.message }
        : await addPropertyPhoto(made.projectId, { path, name: photo.name || `photo${ext}`, mime: photo.type, size: photo.size });
      if (!r.ok) {
        // The home exists; only the picture did not land. Say so and go on -
        // the album on the Setup tab takes it from here.
        router.push(`/my/project/${made.projectId}?tab=setup&error=${encodeURIComponent(`Your home is in, but the photo did not upload: ${r.error}`)}#photos`);
        router.refresh();
        return;
      }
    }
    router.push("/my");
    router.refresh();
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 8, ...style }}>
      <div className="field" style={{ marginBottom: 0 }}>
        {labels && <label htmlFor="ch-name">What should we call it?</label>}
        <input id="ch-name" name="name" className="input" required autoComplete="off" placeholder={labels ? namePlaceholder : `What should we call it? e.g. ${namePlaceholder}`} />
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        {labels && <label htmlFor="ch-address">Address</label>}
        <input id="ch-address" name="address" className="input" required placeholder={labels ? addressPlaceholder : `Address — ${addressPlaceholder}`} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {preview
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={preview} alt="" style={{ width: 64, height: 48, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)" }} />
          : null}
        <button type="button" className="btn ghost small" disabled={!!busy} onClick={() => pick.current?.click()}>
          {photo ? "Change photo" : "＋ Add a cover photo"}
        </button>
        {photo
          ? <button type="button" className="linklike small muted" onClick={() => chosen(null)}>Remove</button>
          : <span className="muted small">Optional — it can be added later.</span>}
        <input ref={pick} type="file" accept="image/*" hidden onChange={(e) => { chosen(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      {err && <p className="error small" style={{ margin: 0 }}>{err}</p>}
      <div className="btn-row">
        <button className="btn" disabled={!!busy}>{busy || buttonLabel}</button>
        {cancelHref && <Link className="btn ghost" href={cancelHref}>Cancel</Link>}
      </div>
    </form>
  );
}
