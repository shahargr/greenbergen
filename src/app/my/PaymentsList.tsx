"use client";

import { useState } from "react";
import { VoiceRecorder } from "@/components/VoiceRecorder";
import { editPayment } from "./actions";
import { PAID_FROM_OPTIONS, type PayMethod } from "./LogPaymentForm";

export type RecentPayment = {
  id: string;
  amount: number;
  paid_on: string | null;
  description: string | null;
  notes: string | null;
  paid_from_account: string | null;
  payment_method_id: string | null;
  method: string | null;
  project: string | null;
};

// Recent payments with in-place editing - fix a field, or attach the
// receipt photos and voice note that arrived after the fact.
export function PaymentsList({ payments, methods }: { payments: RecentPayment[]; methods: PayMethod[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (voiceBlob) {
      const ext = voiceBlob.type.includes("mp4") ? "m4a" : "webm";
      fd.append("files", new File([voiceBlob], `payment-note.${ext}`, { type: voiceBlob.type }));
    }
    setBusy(true);
    await editPayment(fd);
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {payments.map((p) => (
        <div key={p.id} className="card" style={{ padding: "10px 14px", display: "grid", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <span className="small">
              <strong>${Number(p.amount).toLocaleString()}</strong> {p.description ?? ""}
              <span className="muted"> · {p.project} · {p.method}</span>
              <span className="muted"> · {p.paid_on}</span>
            </span>
            <button
              type="button"
              className="btn ghost small"
              onClick={() => { setOpen(open === p.id ? null : p.id); setVoiceBlob(null); }}
            >
              {open === p.id ? "Close" : "Edit"}
            </button>
          </div>

          {open === p.id && (
            <form onSubmit={submit} style={{ display: "grid", gap: 10 }}>
              <input type="hidden" name="tx" value={p.id} />
              <div className="form-2col">
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Amount ($)</label>
                  <input name="amount" className="input" inputMode="decimal" defaultValue={String(p.amount)} />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Paid on</label>
                  <input name="paid_on" type="date" className="input" defaultValue={p.paid_on ?? ""} />
                </div>
              </div>
              <div className="form-2col">
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Paid to</label>
                  <input name="paid_to" className="input"
                    defaultValue={(p.description ?? "").replace(/^Payment to /, "").replace(/ — requested by .*$/, "")} />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Payment type</label>
                  <select name="method" className="input" defaultValue={p.payment_method_id ?? ""}>
                    {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Paid from (account)</label>
                <select name="paid_from" className="input" defaultValue={p.paid_from_account ?? ""}>
                  <option value="">—</option>
                  {p.paid_from_account && !PAID_FROM_OPTIONS.includes(p.paid_from_account) && (
                    <option value={p.paid_from_account}>{p.paid_from_account}</option>
                  )}
                  {PAID_FROM_OPTIONS.map((a) => <option key={a}>{a}</option>)}
                </select>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Notes</label>
                <input name="notes" className="input" defaultValue={p.notes ?? ""} />
              </div>
              <div className="form-2col">
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Add receipt photos</label>
                  <input type="file" name="photos" accept="image/*" capture="environment" multiple className="small" />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Add voice note</label>
                  <VoiceRecorder onReady={setVoiceBlob} />
                </div>
              </div>
              <div>
                <button className="btn" disabled={busy}>{busy ? "Saving..." : "Save changes"}</button>
              </div>
            </form>
          )}
        </div>
      ))}
      {payments.length === 0 && <p className="muted small" style={{ margin: 0 }}>No payments logged yet.</p>}
    </div>
  );
}
