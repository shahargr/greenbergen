"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@shared/supabase/client";
import { friendly } from "@shared/rpc";

// ONE PAPER, UPLOADED.
//
// This screen used to tell the truth about what was on file and then say
// "email them to us and we'll put them on file for you" - which is why the
// four gaps never closed. They close here now.
//
// The file goes into the `credentials` bucket under the contractor's own
// contact id, which is exactly what the storage policy lets them write and
// nothing more. Then contractor_document_upload (migration 104) records it:
// a contact_credentials row for the document itself, plus the
// insurance_certificates row or the companies flag that contractor_readiness
// actually reads - and the inbox message that was standing in for the gap
// closes itself on the way out.
export type PaperKey = "licence" | "liability" | "workers_comp" | "w9";

export function PaperUpload({
  contactId, paper, wantsExpiry = false, wantsNumber = false, accept = "image/*,application/pdf",
}: {
  contactId: string;
  paper: PaperKey;
  // A certificate has a date it runs out; an expired one is not on file.
  wantsExpiry?: boolean;
  // A licence is a number AND a picture of the licence.
  wantsNumber?: boolean;
  accept?: string;
}) {
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [num, setNum] = useState("");
  const [issuer, setIssuer] = useState("");
  const [exp, setExp] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const f = file.current?.files?.[0];
    if (!f || f.size === 0) { setErr("Pick the document first."); return; }
    if (wantsNumber && !num.trim()) { setErr("Type the number as it appears on the licence."); return; }
    setErr(""); setBusy("Uploading…");

    const supabase = createClient();
    const ext = (f.name.match(/\.[a-z0-9]+$/i)?.[0] ?? "").toLowerCase();
    const path = `${contactId}/${paper}-${Date.now()}${ext}`;
    const { error: up } = await supabase.storage.from("credentials")
      .upload(path, f, { contentType: f.type || undefined });
    if (up) { setBusy(""); setErr(`That did not upload: ${up.message}`); return; }

    setBusy("Filing it…");
    const { data, error } = await supabase.rpc("contractor_document_upload", {
      p: {
        key: paper, bucket: "credentials", path, file_name: f.name,
        number: num.trim() || null, issuer: issuer.trim() || null, expires_on: exp || null,
      },
    });
    setBusy("");
    if (error) { setErr(friendly(error.message)); return; }
    if (data?.ok === false) { setErr(data.reason ?? "That was not accepted."); return; }
    router.refresh();
  }

  return (
    <form className="stack" style={{ gap: 8, marginTop: 10 }} onSubmit={(e) => void submit(e)}>
      {wantsNumber && (
        <div className="row" style={{ gap: 8 }}>
          <input className="input grow" value={num} onChange={(e) => setNum(e.target.value)}
                 placeholder="Licence number" aria-label="Licence number" />
          <input className="input grow" value={issuer} onChange={(e) => setIssuer(e.target.value)}
                 placeholder="Who issued it" aria-label="Who issued it" />
        </div>
      )}
      {wantsExpiry && (
        <label className="field">
          <span className="field-label">The date it runs out</span>
          <input className="input" type="date" value={exp} onChange={(e) => setExp(e.target.value)} />
        </label>
      )}

      <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-secondary small" disabled={!!busy}
                onClick={() => file.current?.click()}>
          {name ? "Choose another" : "Choose the file"}
        </button>
        <span className="small text-muted grow" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {name || "A photo or a PDF is fine."}
        </span>
      </div>
      <input ref={file} type="file" accept={accept} hidden
             onChange={(e) => { setName(e.target.files?.[0]?.name ?? ""); setErr(""); }} />

      <button className="btn btn-primary btn-block" disabled={!!busy || !name}>
        {busy || "Put it on file"}
      </button>
      {err && <p className="tiny" style={{ color: "var(--color-danger)", margin: 0 }}>{err}</p>}
    </form>
  );
}
