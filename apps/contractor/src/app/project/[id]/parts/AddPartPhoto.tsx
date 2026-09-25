"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@shared/supabase/client";
import { friendly } from "@shared/rpc";

// THE PHOTOGRAPH OF IT INSTALLED. Shahar named it as one of the six things
// every trade hands over, and it is the one that cannot be reconstructed
// later: a serial number can be read off the plate whenever somebody climbs
// up to it, but "this is how it was left on the day" exists only if it was
// taken on the day.
//
// Upload, record, link - in that order, so a files row never points at an
// object that is not there yet.
const kindOf = (mime: string, name: string) =>
  mime.startsWith("image/") ? "photo"
  : mime === "application/pdf" || /\.pdf$/i.test(name) ? "document"
  : "other";

export function AddPartPhoto({ projectId, partId, label }: {
  projectId: string; partId: string; label: string;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  async function attach(files: FileList | null) {
    const picked = [...(files ?? [])].filter((f) => f.size > 0);
    if (picked.length === 0) return;

    setErr("");
    const supabase = createClient();
    for (let i = 0; i < picked.length; i++) {
      const file = picked[i]!;
      setBusy(picked.length === 1 ? "Uploading…" : `Uploading ${i + 1} of ${picked.length}…`);

      const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? "").toLowerCase();
      const path = `${projectId}/parts/${partId}/${Date.now()}-${i}${ext}`;

      const { error: upErr } = await supabase.storage
        .from("project-media")
        .upload(path, file, { contentType: file.type || undefined });
      if (upErr) { setBusy(""); setErr(`${file.name} did not upload: ${upErr.message}`); return; }

      const { data: rec, error: recErr } = await supabase.rpc("record_project_file", {
        p_project_id: projectId, p_path: path, p_file_name: file.name || `part${ext}`,
        p_mime: file.type || null, p_size: file.size,
        p_caption: `${label} — installed`, p_kind: kindOf(file.type, file.name),
      });
      if (recErr) { setBusy(""); setErr(friendly(recErr.message)); return; }

      const fileId = (typeof rec === "string" ? rec : rec?.file_id ?? rec?.id ?? null) as string | null;
      if (!fileId) { setBusy(""); setErr("That file was uploaded but not recorded."); return; }

      const { error: linkErr } = await supabase.rpc("portal_part_photo_attach", {
        p_file_id: fileId, p_asset: partId,
      });
      if (linkErr) { setBusy(""); setErr(friendly(linkErr.message)); return; }
    }

    setBusy("");
    if (input.current) input.current.value = "";
    router.refresh();
  }

  return (
    <div className="stack" style={{ gap: 6, marginTop: 6 }}>
      <input ref={input} type="file" multiple accept="image/*,application/pdf"
        disabled={!!busy} onChange={(e) => void attach(e.target.files)} className="small" />
      {busy && <p className="tiny text-muted" style={{ margin: 0 }}>{busy}</p>}
      {err && <p className="hint error" style={{ margin: 0 }}>{err}</p>}
    </div>
  );
}
