"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@shared/supabase/client";
import { friendly } from "@shared/rpc";

// Attaching proof to one scope line. Upload first, then record the file, then
// link it - in that order, so a files row never points at an object that is
// not there yet.
//
// portal_scope_evidence_attach lets ANY active member of the project do this,
// deliberately: rulebook 14 needs the contractor who did the work to be able
// to attach the photo, not only the owner who wrote the scope.

const ROLES = [
  { key: "before", label: "Before" },
  { key: "progress", label: "In progress" },
  { key: "after", label: "Done" },
] as const;

const kindOf = (mime: string, name: string) =>
  mime.startsWith("image/") ? "photo"
  : mime.startsWith("video/") ? "video"
  : mime.startsWith("audio/") ? "audio"
  : mime === "application/pdf" || /\.pdf$/i.test(name) ? "document"
  : "other";

export function AddEvidence({ projectId, scopeItemId }: { projectId: string; scopeItemId: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [role, setRole] = useState<string>("after");
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
      const path = `${projectId}/scope/${scopeItemId}/${Date.now()}-${i}${ext}`;

      const { error: upErr } = await supabase.storage
        .from("project-media")
        .upload(path, file, { contentType: file.type || undefined });
      if (upErr) { setBusy(""); setErr(`${file.name} did not upload: ${upErr.message}`); return; }

      const { data: rec, error: recErr } = await supabase.rpc("record_project_file", {
        p_project_id: projectId, p_path: path, p_file_name: file.name || `evidence${ext}`,
        p_mime: file.type || null, p_size: file.size,
        p_caption: "Scope evidence", p_kind: kindOf(file.type, file.name),
      });
      if (recErr) { setBusy(""); setErr(friendly(recErr.message)); return; }

      // record_project_file answers with the id, sometimes wrapped.
      const fileId = (typeof rec === "string" ? rec : rec?.file_id ?? rec?.id ?? null) as string | null;
      if (!fileId) { setBusy(""); setErr("That file was uploaded but not recorded."); return; }

      const { error: linkErr } = await supabase.rpc("portal_scope_evidence_attach", {
        p_file_id: fileId, p_scope_item: scopeItemId, p_role: role,
      });
      if (linkErr) { setBusy(""); setErr(friendly(linkErr.message)); return; }
    }

    setBusy("");
    if (input.current) input.current.value = "";
    router.refresh();
  }

  return (
    <div className="stack" style={{ gap: 8, marginTop: 8 }}>
      <div className="seg" role="group" aria-label="What this shows">
        {ROLES.map((r) => (
          <label className="seg-opt" key={r.key}>
            <input type="radio" name={`role-${scopeItemId}`} value={r.key}
              checked={role === r.key} onChange={() => setRole(r.key)} />
            {r.label}
          </label>
        ))}
      </div>
      <input ref={input} type="file" multiple accept="image/*,video/*,application/pdf"
        disabled={!!busy} onChange={(e) => void attach(e.target.files)} className="small" />
      {busy && <p className="tiny text-muted" style={{ margin: 0 }}>{busy}</p>}
      {err && <p className="hint error" style={{ margin: 0 }}>{err}</p>}
    </div>
  );
}
