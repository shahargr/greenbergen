"use client";

import { useState } from "react";
import { Evidence, type Attached } from "@shared/Evidence";

export type Method = { id: string; name: string; requires_reference: boolean };

// WHAT THIS TASK COST. Shahar (2026-09-11): "just purchased this sign online
// so i can add a payment directly from here."
//
// It sits inside the server-action form and does the two things a plain form
// cannot: it carries the ids of receipt files uploaded while the form was
// being filled in, and it follows the payment method - a rail that needs a
// reference (check number, Zelle confirmation) says so before the database
// has to refuse the payment for the lack of one.
export function PaymentBox({ projectId, methods, people }: {
  projectId: string | null;
  methods: Method[];
  people: { contact_id: string; name: string }[];
}) {
  const [methodId, setMethodId] = useState(methods[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [payee, setPayee] = useState("");
  const [files, setFiles] = useState<Attached[]>([]);
  const m = methods.find((x) => x.id === methodId);
  const needsRef = !!m?.requires_reference;
  const ready = amount.trim().length > 0 && payee.trim().length > 0;

  return (
    <>
      <input type="hidden" name="file_ids" value={files.map((f) => f.id).join(",")} />

      <div className="row" style={{ gap: 8 }}>
        <label className="field grow">
          <span className="field-label">What it cost ($)</span>
          <input className="input" name="amount" inputMode="decimal" value={amount}
            onChange={(e) => setAmount(e.target.value)} placeholder="480" />
        </label>
        <label className="field grow">
          <span className="field-label">Paid on</span>
          <input className="input" name="paid_on" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
        </label>
      </div>

      <label className="field">
        <span className="field-label">Who you paid</span>
        <input className="input" name="payee" value={payee} onChange={(e) => setPayee(e.target.value)}
          list="task-payee-list" placeholder="The sign shop, the supplier, the person" autoComplete="off" />
        <datalist id="task-payee-list">
          {people.map((p) => <option key={p.contact_id} value={p.name} />)}
        </datalist>
        <span className="hint">A name that is not on file becomes a contact, so the next purchase finds it.</span>
      </label>

      <div className="row" style={{ gap: 8 }}>
        <label className="field grow">
          <span className="field-label">How</span>
          <select className="input" name="method" value={methodId} onChange={(e) => setMethodId(e.target.value)}>
            {methods.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </label>
        <label className="field grow">
          <span className="field-label">{needsRef ? "Reference (required)" : "Reference"}</span>
          <input className="input" name="reference" required={needsRef}
            placeholder={m?.name === "Check" ? "Check number" : "Order or confirmation number"} />
        </label>
      </div>

      <label className="field">
        <span className="field-label">From which account <span className="text-muted">(optional)</span></span>
        <input className="input" name="from_account" placeholder="Business card ·4821, checking, cash" />
      </label>

      <label className="field">
        <span className="field-label">Note <span className="text-muted">(optional)</span></span>
        <input className="input" name="notes" placeholder="Anything worth remembering about this purchase" />
      </label>

      {/* The receipt, the order confirmation, a photo of the thing. It is
          filed against this task, which is where anyone looks for it. */}
      {projectId && (
        <div className="field">
          <span className="field-label">Receipt <span className="text-muted">(optional)</span></span>
          <Evidence projectId={projectId} caption="Receipt" folder="receipts" onChange={setFiles}
            accept="image/*,application/pdf" />
        </div>
      )}

      <label className="row small" style={{ gap: 8, alignItems: "flex-start" }}>
        <input type="checkbox" name="awaiting" value="1" style={{ marginTop: 3 }} />
        <span>
          I am waiting on them to confirm it landed
          <span className="text-muted"> — opens a task until they do. Leave this off for a purchase you have the receipt for.</span>
        </span>
      </label>

      <button className="btn btn-primary btn-block" disabled={!ready}>
        {ready ? `Log ${amount.trim().startsWith("$") ? amount.trim() : `$${amount.trim()}`} against this task` : "Log the payment"}
      </button>
    </>
  );
}
