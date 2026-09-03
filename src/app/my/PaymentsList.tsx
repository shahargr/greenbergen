"use client";

import { useState } from "react";
import { VoiceRecorder } from "@/components/VoiceRecorder";
import { FilePick } from "@/components/FilePick";
import { editPayment, commentPayment } from "./actions";
import { GENERIC_ACCOUNTS, type PayMethod } from "./LogPaymentForm";

export type RecentPayment = {
  id: string;
  amount: number;
  paid_on: string | null;
  description: string | null;
  notes: string | null;
  paid_from_account: string | null;
  payment_method_id: string | null;
  status?: string;
  method: string | null;
  project: string | null;
  attachments?: { url: string; kind: string; name: string }[];
};

// Recent payments with in-place editing - fix a field, or attach the
// receipt photos and voice note that arrived after the fact.
export function PaymentsList({ payments, methods, statuses = [], accounts = GENERIC_ACCOUNTS }: { payments: RecentPayment[]; methods: PayMethod[]; statuses?: string[]; accounts?: string[] }) {
  const [open, setOpen] = useState<{ id: string; mode: "view" | "edit" } | null>(null);
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (voiceBlob) {
      const ext = voiceBlob.type.includes("mp4") ? "m4a" : "webm";
      fd.append("files", new File([voiceBlob], `payment-note.${ext}`, { type: voiceBlob.type }));
    }
    setBusy(true);
    setFailed("");
    try {
      await editPayment(fd);
    } catch (err) {
      // redirect() exits via throw and never lands here; anything that
      // does is a real failure (e.g. an oversized upload).
      if (err && typeof err === "object" && "digest" in err && String(err.digest).startsWith("NEXT_REDIRECT")) throw err;
      setBusy(false);
      setFailed(err instanceof Error ? err.message : "Save failed — try smaller files.");
    }
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {payments.map((p) => (
        <div key={p.id} className="card" style={{ padding: "10px 14px", display: "grid", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <span className="small">
              <strong>${Number(p.amount).toLocaleString()}</strong> {p.description ?? ""}
              <span className="muted"> · {p.project} · {p.method}</span>
              {p.status && !p.status.startsWith("paid") && p.status !== "settled" && (
                <span className="extra-chip" style={{ marginLeft: 6 }}>{p.status}</span>
              )}
              <span className="muted"> · {p.paid_on}</span>
            </span>
            <span className="btn-row" style={{ gap: 6 }}>
              <button
                type="button"
                className="btn ghost small"
                onClick={() => { setOpen(open?.id === p.id && open.mode === "view" ? null : { id: p.id, mode: "view" }); setVoiceBlob(null); }}
              >
                {open?.id === p.id && open.mode === "view" ? "Close" : "View"}
              </button>
              <button
                type="button"
                className="btn ghost small"
                onClick={() => { setOpen(open?.id === p.id && open.mode === "edit" ? null : { id: p.id, mode: "edit" }); setVoiceBlob(null); }}
              >
                {open?.id === p.id && open.mode === "edit" ? "Close" : "Edit"}
              </button>
            </span>
          </div>

          {open?.id === p.id && open.mode === "view" && (
            <div className="small" style={{ display: "grid", gap: 4 }}>
              <span><span className="muted">Amount:</span> <strong>${Number(p.amount).toLocaleString()}</strong></span>
              <span><span className="muted">Paid on:</span> {p.paid_on ?? "—"}</span>
              <span><span className="muted">Detail:</span> {p.description ?? "—"}</span>
              <span><span className="muted">Type:</span> {p.method ?? "—"}</span>
              <span><span className="muted">From account:</span> {p.paid_from_account ?? "—"}</span>
              <span><span className="muted">Project:</span> {p.project ?? "—"}</span>
              {p.notes && <span style={{ whiteSpace: "pre-line" }}><span className="muted">Notes:</span> {p.notes}</span>}
              {(p.attachments ?? []).length > 0 ? (
                <span style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                  {p.attachments!.map((a) => a.kind === "photo" ? (
                    <a key={a.url} href={a.url} target="_blank" rel="noreferrer" title={a.name}>
                      {/* signed URLs expire; next/image caching fights that */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={a.url} alt={a.name} style={{ width: 84, height: 84, objectFit: "cover", borderRadius: 8, display: "block" }} />
                    </a>
                  ) : a.kind === "video" ? (
                    <video key={a.url} src={a.url} controls preload="metadata" style={{ width: 160, borderRadius: 8 }} />
                  ) : (
                    <audio key={a.url} controls src={a.url} style={{ maxWidth: 240 }} />
                  ))}
                </span>
              ) : (
                <span className="muted">No receipts attached.</span>
              )}
              <form action={commentPayment} className="btn-row" style={{ marginTop: 6 }}>
                <input type="hidden" name="tx" value={p.id} />
                <input name="text" className="input" required placeholder="Add a comment" style={{ maxWidth: 280 }} />
                <button className="btn ghost small">Comment</button>
              </form>
            </div>
          )}

          {open?.id === p.id && open.mode === "edit" && (
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
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>Status</label>
                  <select name="status" className="input" defaultValue={p.status ?? "paid"}>
                    {[...new Set([p.status ?? "paid", ...statuses])].map((st) => <option key={st}>{st}</option>)}
                  </select>
                </div>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Paid from (account)</label>
                <input name="paid_from" className="input" list="edit-account-options" autoComplete="off" defaultValue={p.paid_from_account ?? ""} />
                <datalist id="edit-account-options">
                  {accounts.map((a) => <option key={a} value={a} />)}
                </datalist>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Notes</label>
                <input name="notes" className="input" defaultValue={p.notes ?? ""} />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Attachments</label>
                <div className="btn-row" style={{ alignItems: "flex-start" }}>
                  <FilePick name="photos" label="🖼 Add photo" accept="image/*" />
                  <FilePick name="photos" label="📷 Take photo" accept="image/*" capture="environment" multiple={false} />
                  <VoiceRecorder onReady={setVoiceBlob} />
                </div>
              </div>
              {failed && <p className="error small" style={{ margin: 0 }}>{failed}</p>}
              <div>
                <button className="btn" disabled={busy}>{busy ? "Saving..." : "Save changes"}</button>
              </div>
            </form>
          )}
        </div>
      ))}
      {payments.length === 0 && <p className="muted small" style={{ margin: 0 }}>No transactions yet.</p>}
    </div>
  );
}
