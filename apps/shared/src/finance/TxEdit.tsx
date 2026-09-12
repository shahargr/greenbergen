"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "./Sheet";
import { callFin } from "./call";
import type { FinMethod } from "./types";

// CORRECTING A PAYMENT ALREADY IN THE LEDGER.
//
// Shahar (2026-09-12): "inside a task, i cannot edit the transaction. it is
// status paid, however, it was refunded. where can we edit the transactions
// from?"
//
// The honest answer was NOWHERE - nothing in any app could change a
// transaction once it was written, so a wrong amount stayed wrong and a
// refund had no home. portal_transaction_edit (migration 073) is the one
// write path, and this is its door on the money page; the task screen has
// its own, on the row itself.
//
// Every rule is the database's: who may edit (the same gate as recording a
// payment), which rails need a reference, and which states a person may set
// by hand. This shapes the form and repeats the refusal.
export const TX_STATES: [string, string][] = [
  ["paid", "Paid"],
  ["paid - receipt filed", "Paid, receipt on file"],
  ["paid - pending confirmation", "Paid, waiting on them to confirm"],
  ["refunded", "Refunded — it came back"],
  ["disputed", "Disputed"],
  ["cancelled", "Cancelled — it never happened"],
];

export function TxEditButton({ tx, methods }: {
  tx: {
    id: string; description: string | null; amount: number | null;
    paid_on: string | null; status: string | null; reference: string | null; method: string | null;
  };
  methods: FinMethod[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const [description, setDescription] = useState(tx.description ?? "");
  const [amount, setAmount] = useState(tx.amount != null ? String(tx.amount) : "");
  const [paidOn, setPaidOn] = useState(tx.paid_on ?? "");
  const [method, setMethod] = useState(methods.find((m) => m.name === tx.method)?.id ?? methods[0]?.id ?? "");
  const [reference, setReference] = useState(tx.reference ?? "");
  const [status, setStatus] = useState(
    TX_STATES.some(([v]) => v === tx.status) ? (tx.status as string) : "paid");

  async function save() {
    setBusy(true); setErr("");
    const r = await callFin("portal_transaction_edit", {
      p_id: tx.id,
      p_patch: {
        description, amount: amount.replace(/[$,\s]/g, ""), paid_on: paidOn,
        method, reference, status,
      },
    });
    setBusy(false);
    if (!r.ok) { setErr(r.reason); return; }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button type="button" className="btn btn-ghost small" style={{ padding: "0 6px", minHeight: 28 }}
        onClick={() => { setOpen(true); setErr(""); }}>
        Correct this
      </button>
      {open && (
        <Sheet title="Correct this payment" onClose={() => { if (!busy) setOpen(false); }}>
          <div className="stack" style={{ gap: 10 }}>
            <label className="field">
              <span className="field-label">What it was</span>
              <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
            <div className="row" style={{ gap: 8 }}>
              <label className="field grow">
                <span className="field-label">Amount ($)</span>
                <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </label>
              <label className="field grow">
                <span className="field-label">Paid on</span>
                <input className="input" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
              </label>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <label className="field grow">
                <span className="field-label">How</span>
                <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
                  {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </label>
              <label className="field grow">
                <span className="field-label">Reference</span>
                <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} />
              </label>
            </div>
            <label className="field">
              <span className="field-label">Where it stands</span>
              <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
                {TX_STATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <span className="hint">
                Refunded means the money went out and came back — it stops counting as a cost of this
                job, and the record of it happening stays.
              </span>
            </label>
            {err && <p className="small" style={{ color: "var(--color-danger)", margin: 0 }}>{err}</p>}
            <button type="button" className={`btn btn-primary btn-block ${busy ? "busy" : ""}`} disabled={busy}
              onClick={() => void save()}>
              {busy ? <><span className="spin" /> Saving…</> : "Save this payment"}
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
