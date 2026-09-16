"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "../supabase/client";
import { Evidence, type Attached } from "../Evidence";
import { callFin } from "./call";

// Evidence on a payment already in the ledger (Shahar, 2026-09-11: "where
// the transaction shows, add option to add photo / evidence as in other
// places"). The files go under payments/<transaction>, where the ledger
// finds them, and are linked to the contract so a bounded payee sees them.
//
// INLINE, THE SAME ROW AS EVERYWHERE ELSE. Shahar (2026-09-16): "the add
// photo/evidence, you are again not following the request made before about
// all areas where photo/evidence can be uploaded." The first cut was a grey
// text link that opened a sheet with an Attach button at the bottom: the
// same three ways in, but hidden behind two taps and a different shape from
// every other place proof goes. Now the row opens in place to the proof row
// itself - drop / attach / voice at a desk, photo / file / voice on a phone
// - each file attaching the moment it lands, and a line for a note, saved
// when you leave the box. Nothing to press afterwards.
export function TxEvidenceButton({ txId, contractId, projectId, label }: {
  txId: string; contractId: string; projectId: string; label: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<string[]>([]);
  // The payment's note as it is now, read when the row opens, so the box
  // starts with it and a blind save can never wipe what was there.
  const [note, setNote] = useState<string | null>(null);

  async function show() {
    setErr("");
    if (open) { setOpen(false); return; }
    const { data } = await createClient().rpc("portal_transaction_detail", { p_tx: txId });
    setNote(typeof data?.notes === "string" ? data.notes : "");
    setOpen(true);
  }

  // Evidence hands back the whole list each time; attach only what is new.
  async function attach(files: Attached[]) {
    const fresh = files.filter((f) => !done.includes(f.id));
    if (fresh.length === 0) return;
    setBusy(true); setErr("");
    for (const f of fresh) {
      const r = await callFin("fin_evidence_attach", { p_file_id: f.id, p_stage: null, p_contract: contractId, p_role: null });
      if (!r.ok) { setBusy(false); setErr(r.reason); return; }
      setDone((d) => [...d, f.id]);
    }
    setBusy(false);
    router.refresh();
  }

  async function saveNote(text: string) {
    const next = text.trim();
    if (next === (note ?? "").trim()) return;
    const r = await callFin("portal_transaction_edit", { p_id: txId, p_patch: { notes: next } });
    if (!r.ok) { setErr(r.reason); return; }
    setErr("");
    router.refresh();
  }

  return (
    <div className="stack" style={{ gap: 6, minWidth: 0 }}>
      <button type="button" className="btn btn-ghost small" style={{ padding: "0 6px", minHeight: 28, alignSelf: "flex-start" }}
        aria-expanded={open} onClick={() => { void show(); }}>
        {open ? "Close" : "Add photo / evidence"}
      </button>
      {open && note !== null && (
        <div className="stack" style={{ gap: 8 }}>
          <Evidence projectId={projectId} folder={`payments/${txId}`} caption={`Payment: ${label}`}
            accept="image/*,application/pdf,audio/*,video/*" onChange={(files) => { void attach(files); }} />
          <input className="input" defaultValue={note ?? ""} placeholder="A note on this payment — saved when you leave the box"
            aria-label={`Note on ${label}`} onBlur={(e) => void saveNote(e.target.value)} />
          {busy && <p className="tiny text-muted" style={{ margin: 0 }}>Attaching…</p>}
          {err && <p className="tiny" style={{ color: "var(--color-danger)", margin: 0 }}>{err}</p>}
        </div>
      )}
    </div>
  );
}
