"use client";

import { useState } from "react";
import { editPayment } from "./actions";

// A transaction as the homepage card carries it: the compact row fields plus
// everything the inline editor needs.
export type CardTx = {
  id: string;
  paid_to: string;
  amount: number | null;
  on_date: string | null;
  status: string;
  description: string | null;
  notes: string | null;
  paid_on: string | null;
  paid_from_account: string | null;
  payment_method_id: string | null;
};

const money = (n: number | null) =>
  n == null ? "—" : n >= 1000 ? `$${Math.round(n).toLocaleString()}` : `$${Math.round(n * 100) / 100}`;

// Clickable transaction row: click to expand the fields below it, edit, Save
// (through the same editPayment action the Transactions page uses) or Close.
export function CardTxRow({
  tx,
  statuses,
  methods,
  pending,
}: {
  tx: CardTx;
  statuses: string[];
  methods: { id: string; name: string }[];
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // Only "Payment to X" descriptions expose an editable payee; other rows
  // (e.g. "RE taxes - Nov 2027") keep their description as-is.
  const isPayTo = /^payment to /i.test(tx.description ?? "");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setErr("");
    try {
      await editPayment(fd);
    } catch (x) {
      if (x && typeof x === "object" && "digest" in x && String(x.digest).startsWith("NEXT_REDIRECT")) throw x;
      setBusy(false);
      setErr(x instanceof Error ? x.message : "Could not save.");
    }
  }

  return (
    <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="small"
        title={open ? "Close" : "Open this transaction"}
        style={{
          background: "none", border: "none", padding: 0, textAlign: "left", font: "inherit", color: "inherit",
          cursor: "pointer", display: "flex", gap: 10, alignItems: "baseline", minWidth: 0, width: "100%",
        }}
      >
        <span className="muted" style={{ whiteSpace: "nowrap", minWidth: 84 }}>{tx.on_date ?? "—"}</span>
        <span style={{ whiteSpace: "nowrap", minWidth: 72, fontWeight: 600, color: pending ? "#a8842c" : undefined }}>
          {money(tx.amount)}
        </span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
          {tx.paid_to}
          {pending && <span className="extra-chip" style={{ marginLeft: 6, fontSize: 10, padding: "0 6px" }}>{tx.status}</span>}
        </span>
        <span className="muted" style={{ flex: "none", fontSize: 11 }}>{open ? "▴" : "▾"}</span>
      </button>

      {open && (
        <form onSubmit={submit} className="card" style={{ display: "grid", gap: 8, padding: "10px 12px", background: "#fafbfa", minWidth: 0 }}>
          <input type="hidden" name="tx" value={tx.id} />
          <input type="hidden" name="back" value="/my" />
          {isPayTo ? (
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor={`ctx-to-${tx.id}`}>Paid to</label>
              <input id={`ctx-to-${tx.id}`} name="paid_to" className="input" defaultValue={tx.paid_to} />
            </div>
          ) : (
            <p className="small" style={{ margin: 0 }}><strong>{tx.description}</strong></p>
          )}
          <div className="form-2col">
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor={`ctx-amt-${tx.id}`}>Amount</label>
              <input id={`ctx-amt-${tx.id}`} name="amount" className="input" inputMode="decimal" defaultValue={tx.amount == null ? "" : String(tx.amount)} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor={`ctx-date-${tx.id}`}>{pending ? "Due / paid on" : "Paid on"}</label>
              <input id={`ctx-date-${tx.id}`} name="paid_on" type="date" className="input" defaultValue={tx.paid_on ?? ""} />
            </div>
          </div>
          <div className="form-2col">
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor={`ctx-st-${tx.id}`}>Status</label>
              <select id={`ctx-st-${tx.id}`} name="status" className="input" defaultValue={tx.status}>
                {(statuses.includes(tx.status) ? statuses : [tx.status, ...statuses]).map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor={`ctx-m-${tx.id}`}>Method</label>
              <select id={`ctx-m-${tx.id}`} name="method" className="input" defaultValue={tx.payment_method_id ?? ""}>
                <option value="">—</option>
                {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </div>
          <div className="form-2col">
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor={`ctx-from-${tx.id}`}>Paid from</label>
              <input id={`ctx-from-${tx.id}`} name="paid_from" className="input" defaultValue={tx.paid_from_account ?? ""} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor={`ctx-n-${tx.id}`}>Notes</label>
              <input id={`ctx-n-${tx.id}`} name="notes" className="input" defaultValue={tx.notes ?? ""} />
            </div>
          </div>
          {err && <p className="error small" style={{ margin: 0 }}>{err}</p>}
          <div className="btn-row">
            <button className="btn small" disabled={busy}>{busy ? "Saving..." : "Save"}</button>
            <button type="button" className="btn ghost small" onClick={() => setOpen(false)} disabled={busy}>Close</button>
          </div>
        </form>
      )}
    </div>
  );
}
