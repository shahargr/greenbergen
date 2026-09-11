"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EvidenceSheet } from "./StageActions";
import { callFin } from "./call";

// Evidence on a payment already in the ledger (Shahar, 2026-09-11: "where
// the transaction shows, add option to add photo / evidence as in other
// places"). The files go under payments/<transaction>, where the ledger
// finds them, and are linked to the contract so a bounded payee sees them.
export function TxEvidenceButton({ txId, contractId, projectId, label }: { txId: string; contractId: string; projectId: string; label: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <>
      <button type="button" className="btn btn-ghost small" style={{ padding: "0 6px", minHeight: 28 }} onClick={() => { setOpen(true); setErr(""); }}>Add photo / evidence</button>
      {open && (
        <EvidenceSheet projectId={projectId} title={`Evidence for ${label}`} folder={`payments/${txId}`} caption={`Payment: ${label}`} busy={busy} err={err}
          onClose={() => setOpen(false)}
          onSubmit={async (files) => {
            setBusy(true); setErr("");
            for (const f of files) {
              const r = await callFin("fin_evidence_attach", { p_file_id: f.id, p_stage: null, p_contract: contractId, p_role: null });
              if (!r.ok) { setBusy(false); setErr(r.reason); return; }
            }
            setBusy(false); setOpen(false); router.refresh();
          }} />
      )}
    </>
  );
}
