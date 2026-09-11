"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Evidence, type Attached } from "../Evidence";
import { Sheet } from "./Sheet";
import { callFin } from "./call";
import type { FinMethod } from "./types";

// A payment against the contract, no milestone needed - the check already
// written to the framer, the wire to the lumber yard. The owner side logs
// it with what rulebook 51 asks for: how, the reference, when, from which
// account, and the photograph of the check. The transaction id is minted
// here first so the evidence uploads under payments/<id>, where the ledger
// finds it again.
export function LogPaymentButton({ contractId, contractTitle, payeeName, projectId, methods }: {
  contractId: string; contractTitle: string; payeeName: string | null; projectId: string; methods: FinMethod[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const txId = useMemo(() => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : null), [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const [method, setMethod] = useState(methods[0]?.id ?? "");
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [from, setFrom] = useState("");
  const [invoice, setInvoice] = useState("");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<Attached[]>([]);
  const m = methods.find((x) => x.id === method);
  const needsRef = !!m?.requires_reference;
  const first = (payeeName ?? "the contractor").split(/\s+/)[0];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    const r = await callFin("fin_payment_log", {
      p_contract: contractId, p_amount: Number(amount.replace(/[$,\s]/g, "")), p_method: method,
      p_reference: reference || null, p_paid_on: paidOn || null, p_from_account: from || null,
      p_notes: notes || null, p_invoice_reference: invoice || null, p_description: null,
      p_file_ids: files.map((f) => f.id), p_id: txId,
    });
    setBusy(false);
    if (!r.ok) { setErr(r.reason); return; }
    setOpen(false); setAmount(""); setReference(""); setFrom(""); setInvoice(""); setNotes(""); setFiles([]);
    router.refresh();
  }

  return (
    <>
      <button type="button" className="btn btn-secondary small" onClick={() => setOpen(true)}>Log a payment</button>
      {open && (
        <Sheet title={`Log a payment to ${first}`} onClose={() => setOpen(false)}>
          <form className="stack" style={{ gap: 10 }} onSubmit={(e) => void submit(e)}>
            <p className="small text-muted" style={{ margin: 0 }}>
              Against <strong>{contractTitle}</strong>, outside any milestone. What you paid {first} directly; the record asks {first} to confirm it landed.
            </p>
            <div className="row" style={{ gap: 8, alignItems: "flex-end" }}>
              <div className="field grow">
                <label htmlFor="lp-amount">Amount ($)</label>
                <input id="lp-amount" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="2,500" required />
              </div>
              <div className="field grow">
                <label htmlFor="lp-date">Paid on</label>
                <input id="lp-date" type="date" className="input" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="lp-method">How</label>
              <select id="lp-method" className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
                {methods.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="lp-ref">{needsRef ? "Reference (required)" : "Reference"}</label>
              <input id="lp-ref" className="input" value={reference} onChange={(e) => setReference(e.target.value)}
                placeholder={m?.name === "Check" ? "Check number" : "Confirmation number"} required={needsRef} />
            </div>
            <div className="row" style={{ gap: 8, alignItems: "flex-end" }}>
              <div className="field grow">
                <label htmlFor="lp-from">From which account</label>
                <input id="lp-from" className="input" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="55 Walnut, personal…" />
              </div>
              <div className="field grow">
                <label htmlFor="lp-inv">Their invoice</label>
                <input id="lp-inv" className="input" value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder="Optional" />
              </div>
            </div>
            <div className="field">
              <label htmlFor="lp-notes">What it was for</label>
              <input id="lp-notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Second draw, rough-in done" />
            </div>
            <div className="field">
              <span className="field-label">The check, the receipt, a note</span>
              {txId && <Evidence projectId={projectId} folder={`payments/${txId}`} caption={`Payment to ${first}: ${contractTitle}`} onChange={setFiles} accept="image/*,application/pdf,audio/*" />}
            </div>
            {err && <p className="tiny" style={{ color: "var(--color-danger)", margin: 0 }}>{err}</p>}
            <button className="btn btn-primary btn-block" disabled={busy || !amount || (needsRef && !reference)}>{busy ? "Logging…" : "Log the payment"}</button>
          </form>
        </Sheet>
      )}
    </>
  );
}
