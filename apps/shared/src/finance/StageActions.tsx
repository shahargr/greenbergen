"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Evidence, type Attached } from "../Evidence";
import { Sheet } from "./Sheet";
import { callFin } from "./call";
import { usd, type FinMethod, type FinStage } from "./types";

// What a person can DO to a milestone, by who they are to the contract.
//
//   the payor (owner side)  - approve a requested one, record the money
//                             (the one write path, evidence first), mark a
//                             sent check as cleared, cancel one not yet paid
//   the payee (contractor)  - ask for it (the work is done), say the money
//                             landed
//   either                  - add a photo, a receipt, a note to it
//
// Every write goes to the database function that owns the rule; the screen
// only relays its answer.
export function StageActions({
  stage, contractId, contractorName, projectId, mayRecord, payee, isSuperadmin, methods,
}: {
  stage: FinStage; contractId: string; contractorName: string | null; projectId: string;
  mayRecord: boolean; payee: boolean; isSuperadmin: boolean; methods: FinMethod[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState<"record" | "evidence" | "clear" | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const paid = stage.settlement_status === "paid" || stage.status === "Paid";
  const pending = stage.settlement_status === "pending_clearance";
  const payor = mayRecord;
  // The superadmin is both sides on their own project - useful on 55 Walnut,
  // where the same person runs the site and signs the checks.
  const asPayee = payee && (!mayRecord || isSuperadmin);
  const first = (contractorName ?? "the contractor").split(/\s+/)[0];

  async function run(fn: string, args: Record<string, unknown>) {
    setBusy(true); setErr("");
    const r = await callFin(fn, args);
    setBusy(false);
    if (!r.ok) { setErr(r.reason); return false; }
    setOpen(null);
    router.refresh();
    return true;
  }

  const buttons: React.ReactNode[] = [];
  if (payor && !paid && !pending && stage.status !== "Cancelled") {
    buttons.push(<button key="rec" type="button" className="btn btn-primary small" disabled={busy} onClick={() => setOpen("record")}>Record payment</button>);
    if (stage.status === "Requested") {
      buttons.push(<button key="appr" type="button" className="btn btn-secondary small" disabled={busy} onClick={() => void run("payment_stage_set", { p_id: stage.id, p_status: "Approved" })}>Approve</button>);
    }
  }
  if (payor && pending) {
    buttons.push(<button key="clr" type="button" className="btn btn-primary small" disabled={busy} onClick={() => setOpen("clear")}>It cleared</button>);
  }
  if (asPayee && !paid && !pending && (stage.status === "Planned" || stage.status === "Ready")) {
    buttons.push(<button key="req" type="button" className="btn btn-primary small" disabled={busy} onClick={() => void run("payment_stage_set", { p_id: stage.id, p_status: "Requested" })}>Request payment</button>);
  }
  if (asPayee && paid && stage.transaction?.confirm_task) {
    buttons.push(<button key="got" type="button" className="btn btn-primary small" disabled={busy} onClick={() => void run("fin_receipt_confirm", { p_stage: stage.id })}>I received it</button>);
  }
  if ((payor || asPayee) && stage.status !== "Cancelled") {
    buttons.push(<button key="ev" type="button" className="btn btn-ghost small" disabled={busy} onClick={() => setOpen("evidence")}>Add photo or note</button>);
  }
  if (payor && !paid && !pending && stage.status !== "Cancelled" && !stage.transaction) {
    buttons.push(<button key="cxl" type="button" className="btn btn-ghost small btn-danger" disabled={busy} onClick={() => { if (confirm("Cancel this milestone? It stays on the record as cancelled.")) void run("payment_stage_set", { p_id: stage.id, p_status: "Cancelled" }); }}>Cancel</button>);
  }
  if (buttons.length === 0 && !err) return null;

  return (
    <div className="stack" style={{ gap: 6, marginTop: 6 }}>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>{buttons}</div>
      {err && <p className="tiny" style={{ color: "var(--color-danger)", margin: 0 }}>{err}</p>}

      {open === "record" && (
        <RecordSheet stage={stage} methods={methods} projectId={projectId} first={first} busy={busy} err={err}
          onClose={() => { setOpen(null); setErr(""); }}
          onSubmit={(args) => run("fin_payment_record", { p_stage: stage.id, ...args })} />
      )}

      {open === "clear" && stage.settlement && (
        <Sheet title="The payment cleared" onClose={() => setOpen(null)}>
          <p className="small" style={{ margin: "0 0 10px" }}>
            {stage.settlement.method ?? "The payment"} {stage.settlement.reference ? `(${stage.settlement.reference})` : ""} for {usd(stage.settlement.amount)} was recorded as sent.
            Confirming it landed writes it into the ledger.
          </p>
          <button type="button" className="btn btn-primary btn-block" disabled={busy}
            onClick={() => void run("fin_payment_record", {
              p_stage: stage.id,
              p_method: methods.find((m) => m.name === stage.settlement?.method)?.id ?? null,
              p_reference: stage.settlement?.reference ?? null,
              p_amount: stage.settlement?.amount ?? null,
              p_paid_on: stage.settlement?.paid_on ?? null,
              p_cleared: true,
            })}>Yes, it cleared</button>
          {err && <p className="tiny" style={{ color: "var(--color-danger)", margin: "8px 0 0" }}>{err}</p>}
        </Sheet>
      )}

      {open === "evidence" && (
        <EvidenceSheet projectId={projectId} stageId={stage.id} contractId={contractId} busy={busy} err={err}
          onClose={() => { setOpen(null); setErr(""); }}
          onSubmit={async (files) => {
            setBusy(true); setErr("");
            for (const f of files) {
              const r = await callFin("fin_evidence_attach", { p_file_id: f.id, p_stage: stage.id, p_contract: null, p_role: null });
              if (!r.ok) { setBusy(false); setErr(r.reason); return; }
            }
            setBusy(false); setOpen(null); router.refresh();
          }} />
      )}
    </div>
  );
}

function RecordSheet({ stage, methods, projectId, first, busy, err, onClose, onSubmit }: {
  stage: FinStage; methods: FinMethod[]; projectId: string; first: string; busy: boolean; err: string;
  onClose: () => void; onSubmit: (args: Record<string, unknown>) => Promise<boolean>;
}) {
  const [method, setMethod] = useState(methods.find((m) => m.name === stage.method)?.id ?? methods[0]?.id ?? "");
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState(stage.amount != null ? String(stage.amount) : "");
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10));
  const [cleared, setCleared] = useState(true);
  const [from, setFrom] = useState("");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState<Attached[]>([]);
  const m = methods.find((x) => x.id === method);
  const needsRef = !!m?.requires_reference;
  const needsPhoto = stage.requires_photo && stage.evidence.length === 0 && !files.some((f) => f.kind === "photo");

  return (
    <Sheet title={`Record a payment to ${first}`} onClose={onClose}>
      <form className="stack" style={{ gap: 10 }} onSubmit={(e) => {
        e.preventDefault();
        void onSubmit({
          p_method: method || null, p_reference: reference || null,
          p_amount: amount ? Number(amount.replace(/[$,\s]/g, "")) : null,
          p_paid_on: paidOn || null, p_cleared: cleared, p_from_account: from || null, p_notes: notes || null,
          p_file_ids: files.map((f) => f.id),
        });
      }}>
        <p className="small text-muted" style={{ margin: 0 }}>
          {stage.name} · {usd(stage.amount)}. Green Bergen never holds the money: this records what you paid {first} directly.
        </p>
        <div className="field">
          <label htmlFor="fin-method">How</label>
          <select id="fin-method" className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
            {methods.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="fin-ref">{needsRef ? "Reference (required)" : "Reference"}</label>
          <input id="fin-ref" className="input" value={reference} onChange={(e) => setReference(e.target.value)}
            placeholder={m?.name === "Check" ? "Check number" : "Confirmation number"} required={needsRef} />
        </div>
        <div className="row" style={{ gap: 8, alignItems: "flex-end" }}>
          <div className="field grow">
            <label htmlFor="fin-amount">Amount ($)</label>
            <input id="fin-amount" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="field grow">
            <label htmlFor="fin-date">Paid on</label>
            <input id="fin-date" type="date" className="input" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="fin-from">From which account</label>
          <input id="fin-from" className="input" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="Checking, credit card, cash…" />
        </div>
        <label className="row small" style={{ gap: 8 }}>
          <input type="checkbox" checked={cleared} onChange={(e) => setCleared(e.target.checked)} />
          <span>The money has left my account (uncheck for a check that is sent but not yet cashed)</span>
        </label>
        <div className="field">
          <label htmlFor="fin-notes">Note</label>
          <input id="fin-notes" className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
        </div>
        <div className="field">
          <span className="field-label">Evidence {stage.requires_photo ? "(a photo is required on this milestone)" : ""}</span>
          <Evidence projectId={projectId} caption={`Payment: ${stage.name}`} onChange={setFiles} accept="image/*,application/pdf,audio/*" />
          {needsPhoto && <p className="hint">Photograph the check or the finished work: the payment cannot be recorded without one.</p>}
        </div>
        {err && <p className="tiny" style={{ color: "var(--color-danger)", margin: 0 }}>{err}</p>}
        <button className="btn btn-primary btn-block" disabled={busy || (needsRef && !reference)}>{busy ? "Recording…" : cleared ? "Record the payment" : "Record as sent"}</button>
      </form>
    </Sheet>
  );
}

export function EvidenceSheet({ projectId, busy, err, onClose, onSubmit, title = "Add to this milestone" }: {
  projectId: string; stageId?: string; contractId?: string; busy: boolean; err: string;
  onClose: () => void; onSubmit: (files: Attached[]) => Promise<void>; title?: string;
}) {
  const [files, setFiles] = useState<Attached[]>([]);
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="stack" style={{ gap: 10 }}>
        <p className="small text-muted" style={{ margin: 0 }}>A photo of the work, the check or the receipt; a file; or say it in a voice note.</p>
        <Evidence projectId={projectId} caption="Money evidence" onChange={setFiles} accept="image/*,application/pdf,audio/*,video/*" />
        {err && <p className="tiny" style={{ color: "var(--color-danger)", margin: 0 }}>{err}</p>}
        <button type="button" className="btn btn-primary btn-block" disabled={busy || files.length === 0} onClick={() => void onSubmit(files)}>
          {busy ? "Saving…" : files.length === 0 ? "Nothing attached yet" : `Attach ${files.length === 1 ? "it" : `${files.length} files`}`}
        </button>
      </div>
    </Sheet>
  );
}
