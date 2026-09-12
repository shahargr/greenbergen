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
export function PaymentBox({ projectId, methods, people, accounts = [] }: {
  projectId: string | null;
  methods: Method[];
  people: { contact_id: string; name: string }[];
  // Every account this job has already been paid from (migration 075). No
  // list to maintain: it is the record, and it fills itself.
  accounts?: string[];
}) {
  const [methodId, setMethodId] = useState(methods[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [payee, setPayee] = useState("");
  const [files, setFiles] = useState<Attached[]>([]);
  const [reference, setReference] = useState("");
  const m = methods.find((x) => x.id === methodId);
  const needsRef = !!m?.requires_reference;
  // STARTED means an amount is in the box: from that moment this IS a payment
  // somebody means to record, so every Update on the form logs it (the action
  // does not wait for this box's own button any more). Which means the form
  // must not submit while it is half-filled - `required` is form-wide, so the
  // browser stops any of the three buttons and points at what is missing.
  // Shahar (2026-09-12): "is there a way to disable anything outside the panel
  // when working on it, but add an option to cancel so we are not blocked?"
  // This is that, without freezing the screen: finish it, or Clear it.
  const started = amount.trim().length > 0;
  const ready = started && payee.trim().length > 0 && (!needsRef || reference.trim().length > 0);
  const clear = () => { setAmount(""); setPayee(""); setReference(""); };

  return (
    <>
      {/* Its OWN name: the note box in the same form already uses file_ids,
          and two hidden fields of one name would hand the note's photos to
          the payment and the receipt to the note. */}
      <input type="hidden" name="payment_file_ids" value={files.map((f) => f.id).join(",")} />

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
          required={started}
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
          {/* Required only once an amount is in the box, and only on a rail
              that needs one. An empty drawer never blocks the form. */}
          <input className="input" name="reference" value={reference} required={started && needsRef}
            onChange={(e) => setReference(e.target.value)}
            placeholder={m?.name === "Check" ? "Check number" : "Order or confirmation number"} />
        </label>
      </div>

      <label className="field">
        <span className="field-label">From which account <span className="text-muted">(optional)</span></span>
        <input className="input" name="from_account" list="task-account-list" autoComplete="off"
          placeholder={accounts[0] ? `${accounts[0]}, or a new one` : "Business card ·4821, checking, cash"} />
        <span className="hint">
          {accounts.length > 0
            ? `${accounts.length} ${accounts.length === 1 ? "account" : "accounts"} used on this job so far — pick one, or type a new one and it joins the list.`
            : "Type it once and it is offered on every payment on this job from then on."}
        </span>
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

      {/* This button saves the WHOLE form - the field edits and the comment
          too - and logs the purchase. So do the two at the foot of the page:
          an amount in the box is a payment, whichever button you press. */}
      <button name="do" value="payment" className="btn btn-primary btn-block" disabled={!ready}>
        {ready ? `Log ${amount.trim().startsWith("$") ? amount.trim() : `$${amount.trim()}`} against this task` : "Log the payment"}
      </button>
      {started && (
        <>
          <button type="button" className="btn btn-ghost btn-block" onClick={clear}>
            Clear this payment
          </button>
          <p className="tiny text-muted" style={{ margin: 0 }}>
            {ready
              ? "This payment goes in with whichever Update you press — you do not have to use this button."
              : needsRef && !reference.trim()
                ? `${m?.name ?? "This"} needs a reference — a payment without one cannot be reconciled later. Fill it in, or Clear this payment to leave without it.`
                : "Say who you paid to finish it, or Clear this payment to leave without it."}
          </p>
        </>
      )}
    </>
  );
}
