"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Evidence, type Attached } from "../Evidence";
import { Sheet } from "./Sheet";
import { callFin } from "./call";
import type { FinChange } from "./types";

// THE ADDITION. "I need $750 more - there was rock where the second sump
// pit goes." A contractor asks; the owner decides. Or the owner writes down
// an extra they agreed on site, approved in the same act. Either way it is
// a change order: a contract under the contract, a scope line, the
// evidence (photo, receipt, voice note), one milestone once approved.
export function ChangeOrderButton({ contractId, contractTitle, projectId, mayRecord }: {
  contractId: string; contractTitle: string; projectId: string; mayRecord: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [scope, setScope] = useState("");
  const [reason, setReason] = useState("");
  const [files, setFiles] = useState<Attached[]>([]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    const r = await callFin("change_order_request", {
      p_contract: contractId, p_title: title, p_amount: Number(amount.replace(/[$,\s]/g, "")),
      p_scope: scope || null, p_reason: reason || null, p_file_ids: files.map((f) => f.id),
    });
    setBusy(false);
    if (!r.ok) { setErr(r.reason); return; }
    setOpen(false); setTitle(""); setAmount(""); setScope(""); setReason(""); setFiles([]);
    router.refresh();
  }

  return (
    <>
      <button type="button" className="btn btn-secondary small" onClick={() => setOpen(true)}>
        {mayRecord ? "Add an extra" : "Ask for a change"}
      </button>
      {open && (
        <Sheet title={mayRecord ? "An extra on this contract" : "Ask for a change"} onClose={() => setOpen(false)}>
          <form className="stack" style={{ gap: 10 }} onSubmit={(e) => void submit(e)}>
            <p className="small text-muted" style={{ margin: 0 }}>
              On <strong>{contractTitle}</strong>. {mayRecord
                ? "Recorded as agreed: it joins the contract total and gets its own milestone to pay."
                : "The owner sees it as a decision to make; approved, it gets its own milestone and is paid like any other."}
            </p>
            <div className="field">
              <label htmlFor="co-title">What</label>
              <input id="co-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Second sump pit, extra 2in PVC run" required />
            </div>
            <div className="field">
              <label htmlFor="co-amount">How much more ($)</label>
              <input id="co-amount" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="750" required />
            </div>
            <div className="field">
              <label htmlFor="co-scope">Scope of the change</label>
              <textarea id="co-scope" className="input" rows={2} value={scope} onChange={(e) => setScope(e.target.value)} placeholder="What gets done or supplied that the contract did not cover" />
            </div>
            <div className="field">
              <label htmlFor="co-reason">Why</label>
              <textarea id="co-reason" className="input" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Found rock at the pit; material quote attached" />
            </div>
            <div className="field">
              <span className="field-label">Evidence</span>
              <Evidence projectId={projectId} caption={`Change: ${title || "requested"}`} onChange={setFiles} accept="image/*,application/pdf,audio/*,video/*" />
            </div>
            {err && <p className="tiny" style={{ color: "var(--color-danger)", margin: 0 }}>{err}</p>}
            <button className="btn btn-primary btn-block" disabled={busy || !title || !amount}>{busy ? "Saving…" : mayRecord ? "Record the extra" : "Send the request"}</button>
          </form>
        </Sheet>
      )}
    </>
  );
}

export function ChangeActions({ change, mayRecord, payee }: { change: FinChange; mayRecord: boolean; payee: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function decide(approve: boolean) {
    const note = approve ? null : (prompt(mayRecord ? "Why not? (optional)" : "Withdraw this request?") ?? null);
    if (!approve && note === null && !mayRecord) return;
    setBusy(true); setErr("");
    const r = await callFin("change_order_decide", { p_contract: change.id, p_approve: approve, p_note: note || null });
    setBusy(false);
    if (!r.ok) { setErr(r.reason); return; }
    router.refresh();
  }
  const open = change.status === "requested";
  const retry = mayRecord && (change.status === "declined" || change.status === "withdrawn");
  if (!open && !retry) return null;
  return (
    <div className="stack" style={{ gap: 6, marginTop: 6 }}>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {mayRecord && <button type="button" className="btn btn-primary small" disabled={busy} onClick={() => void decide(true)}>{open ? "Approve" : "Approve after all"}</button>}
        {mayRecord && open && <button type="button" className="btn btn-ghost small btn-danger" disabled={busy} onClick={() => void decide(false)}>Decline</button>}
        {!mayRecord && payee && open && <button type="button" className="btn btn-ghost small" disabled={busy} onClick={() => void decide(false)}>Withdraw</button>}
      </div>
      {err && <p className="tiny" style={{ color: "var(--color-danger)", margin: 0 }}>{err}</p>}
    </div>
  );
}
