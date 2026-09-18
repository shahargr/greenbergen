"use client";

import { useState } from "react";
import { Evidence, type Attached } from "@shared/Evidence";

export type Method = { id: string; name: string; requires_reference: boolean };

// WHAT A CONTRACT ALREADY KNOWS (migration 165): who gets paid, the account
// the last payment left from, the rail it went on. Filled into the slots
// when the task changes; editable after.
export type PayDefaults = {
  payee: string | null; account: string | null; method: string | null;
  /** WHAT THE GATE IS WORTH (190). A payment stage already says what it pays;
   *  nobody should be typing that number again from memory while standing in
   *  front of the work it settles. */
  amount?: string | null;
};

// WHAT THIS TASK COST. Shahar (2026-09-11): "just purchased this sign online
// so i can add a payment directly from here."
//
// It sits inside the server-action form and does the two things a plain form
// cannot: it carries the ids of receipt files uploaded while the form was
// being filled in, and it follows the payment method - a rail that needs a
// reference (check number, Zelle confirmation) says so before the database
// has to refuse the payment for the lack of one.
export function PaymentBox({ projectId, methods, people, accounts = [], defaults = null, defaultsKey = "" }: {
  projectId: string | null;
  methods: Method[];
  people: { contact_id: string; name: string }[];
  // Every account this job has already been paid from (migration 075). No
  // list to maintain: it is the record, and it fills itself.
  accounts?: string[];
  /** What the chosen task's contract knows (165). Applied whenever `defaultsKey` changes. */
  defaults?: PayDefaults | null;
  defaultsKey?: string;
}) {
  const [methodId, setMethodId] = useState(methods[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [payee, setPayee] = useState("");
  const [files, setFiles] = useState<Attached[]>([]);
  const [reference, setReference] = useState("");
  // Your account is a slot in the From/To row now, so it is controlled state
  // like the other side - the sentence under the row reads them both.
  const [account, setAccount] = useState("");
  // WHICH WAY THE MONEY WENT. Shahar (2026-09-13), on a lumber credit:
  // "tried to log in negative value as credit -1646.14 and got this error".
  // A credit is not a negative payment - it is a POSITIVE amount coming the
  // other way. All 173 rows in the ledger are positive; a minus sign here
  // would have been the first, and would have quietly broken the roll-ups.
  //
  // This state stays in the BROWSER. It decides which slot your account sits
  // in and therefore which field name it is posted under - nothing named
  // "direction" is sent, and nothing writes that column (migration 093).
  const [dir, setDir] = useState<"out" | "in">("out");
  const credit = dir === "in";
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
  // BOTH ENDS ARE REQUIRED (Shahar, 2026-09-17: "From account is mandatory,
  // as well as to account is mandatory"). A payment with one end is a
  // number nobody can reconcile.
  const ready = started && payee.trim().length > 0 && account.trim().length > 0 && (!needsRef || reference.trim().length > 0);
  const clear = () => { setAmount(""); setPayee(""); setReference(""); setAccount(""); };

  // THE CONTRACT FILLS THE SLOTS. When the task changes to one with a
  // contract, its party lands in To, its last account in From, its last rail
  // in How. Only on that change - what you type afterwards stays. Done as
  // state adjusted during render (React's pattern for "a prop changed"),
  // not in an effect, so there is no extra paint with the old values.
  const [applied, setApplied] = useState(defaultsKey);
  if (defaultsKey !== applied) {
    setApplied(defaultsKey);
    if (defaults?.payee) setPayee(defaults.payee);
    if (defaults?.account) setAccount(defaults.account);
    if (defaults?.amount) setAmount(defaults.amount);
    if (defaults?.method) {
      const hit = methods.find((x) => x.name === defaults.method);
      if (hit) setMethodId(hit.id);
    }
  }

  // FROM → TO, and the ORDER is the direction.
  //
  // Shahar (2026-09-14), on the direction select this replaced: "so do you add
  // to the transaction log the ability to choose direction? or just from & to?
  // where from can be the other side?"
  //
  // He is right. Nobody thinks "direction" - they think "Kuiken credited the
  // 55 Walnut card". And a direction picker can CONTRADICT the fields under
  // it: you could choose Money out and then name the person who paid you, and
  // nothing noticed. Here the two slots never change meaning, only position,
  // so there is no second field left to disagree with.
  //
  // The slots are TYPED, which is what makes the direction derivable without a
  // registry of your own accounts - there isn't one, and paid_from_account is
  // free text that has already drifted to "55 Walnut", "55 Walnut Dr" and "C".
  // One slot is always your account, the other always the other side; which
  // one sits on top says which way the money went.
  const mine = (
    <label className="field" style={{ marginBottom: 0 }}>
      <span className="field-label">
        {credit ? "To — your account" : "From — your account"}
      </span>
      {/* THE NAME OF THIS FIELD IS THE DIRECTION. Your account is the source
          when you paid and the destination when they paid you back, so the
          slot posts under from_account or to_account accordingly and the
          database reads which way the money went off the two ends. There is
          no separate direction field left to disagree with it. */}
      <input className="input" name={credit ? "to_account" : "from_account"} list="task-account-list" autoComplete="off"
        value={account} onChange={(e) => setAccount(e.target.value)} required={started}
        placeholder={accounts[0] ? `${accounts[0]}, or a new one` : "Business card ·4821, checking, cash"} />
    </label>
  );
  const theirs = (
    <label className="field" style={{ marginBottom: 0 }}>
      <span className="field-label">{credit ? "From — the other side" : "To — the other side"}</span>
      <input className="input" name="payee" value={payee} onChange={(e) => setPayee(e.target.value)}
        required={started}
        list="task-payee-list" placeholder="The supplier, the shop, the person" autoComplete="off" />
      <datalist id="task-payee-list">
        {people.map((p) => <option key={p.contact_id} value={p.name} />)}
      </datalist>
    </label>
  );
  return (
    <>
      {/* Its OWN name: the note box in the same form already uses file_ids,
          and two hidden fields of one name would hand the note's photos to
          the payment and the receipt to the note. */}
      <input type="hidden" name="payment_file_ids" value={files.map((f) => f.id).join(",")} />

      {/* WHICH WAY THE MONEY WENT, said as where it came from and where it
          landed. Swap turns a payment into a credit and back; nothing else on
          the form has to change, because the slots keep their meanings. */}
      {/* TRANSACTION, not "Money moves", and no sentence under it (Shahar,
          2026-09-17: "the money move - comment is not necessary. change to
          Transaction"). The two slots say it. */}
      <div className="stack" style={{ gap: 8 }}>
        <div className="between" style={{ alignItems: "baseline" }}>
          <span className="divider-label" style={{ padding: 0 }}>Transaction</span>
          <button type="button" className="btn btn-ghost small" onClick={() => setDir(credit ? "out" : "in")}>
            ⇄ {credit ? "I paid them" : "They paid me"}
          </button>
        </div>
        {credit ? theirs : mine}
        <div className="tiny text-muted" style={{ textAlign: "center", margin: "-2px 0" }}>↓</div>
        {credit ? mine : theirs}
      </div>

      <div className="row" style={{ gap: 8 }}>
        <label className="field grow">
          <span className="field-label">{credit ? "How much came back ($)" : "What it cost ($)"}</span>
          <input className="input" name="amount" inputMode="decimal" value={amount}
            onChange={(e) => setAmount(e.target.value)} placeholder={credit ? "1646.14" : "480"} />
        </label>
        <label className="field grow">
          <span className="field-label">{credit ? "Came back on" : "Paid on"}</span>
          <input className="input" name="paid_on" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
        </label>
      </div>

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
        <span className="field-label">Note <span className="text-muted">(optional)</span></span>
        <input className="input" name="notes" placeholder={credit ? "What was returned, and what it was credited against" : "Anything worth remembering about this purchase"} />
      </label>

      {/* The receipt, the order confirmation, a photo of the thing. It is
          filed against this task, which is where anyone looks for it. */}
      {projectId && (
        <div className="field">
          <span className="field-label">{credit ? "Credit note" : "Receipt"} <span className="text-muted">(optional)</span></span>
          <Evidence projectId={projectId} caption="Receipt" folder="receipts" onChange={setFiles}
            accept="image/*,application/pdf" />
        </div>
      )}

      <label className="row small" style={{ gap: 8, alignItems: "flex-start" }}>
        <input type="checkbox" name="awaiting" value="1" style={{ marginTop: 3 }} />
        <span>
          {credit ? "I am waiting on them to confirm the credit" : "I am waiting on them to confirm it landed"}
          <span className="text-muted"> — opens a task until they do. Leave this off when you already have the paperwork.</span>
        </span>
      </label>

      {/* This button saves the WHOLE form - the field edits and the comment
          too - and logs the purchase. So do the two at the foot of the page:
          an amount in the box is a payment, whichever button you press. */}
      <button name="do" value="payment" className="btn btn-primary btn-block" disabled={!ready}>
        {ready
          ? `Log ${credit ? "a " : ""}${amount.trim().startsWith("$") ? amount.trim() : `$${amount.trim()}`} ${credit ? "credit on" : "against"} this task`
          : credit ? "Log the credit" : "Log the payment"}
      </button>
      {started && (
        <>
          <button type="button" className="btn btn-ghost btn-block" onClick={clear}>
            Clear this {credit ? "credit" : "payment"}
          </button>
          <p className="tiny text-muted" style={{ margin: 0 }}>
            {ready
              ? "This payment goes in with whichever Update you press — you do not have to use this button."
              : needsRef && !reference.trim()
                ? `${m?.name ?? "This"} needs a reference — a payment without one cannot be reconciled later. Fill it in, or Clear this payment to leave without it.`
                : !account.trim()
                  ? "Say which account it moved through to finish it, or Clear this payment to leave without it."
                  : "Say who is on the other side to finish it, or Clear this payment to leave without it."}
          </p>
        </>
      )}
    </>
  );
}
