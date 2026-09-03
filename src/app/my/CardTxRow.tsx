"use client";

import { Fragment, useState } from "react";
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

// Column headers shared by the Recent and Pending tables on the card.
export const TX_COLS = 5; // Date · Amount · Paid to · Status · (toggle)
export function CardTxHead() {
  return (
    <thead>
      <tr>
        <th style={{ width: 92 }}>Date</th>
        <th style={{ width: 84 }}>Amount</th>
        <th>Paid to</th>
        <th style={{ width: 150 }}>Status</th>
        <th style={{ width: 22 }} aria-label="Open" />
      </tr>
    </thead>
  );
}

// Clickable table row: click to open the transaction's fields in a full-width
// row beneath it; Save (same editPayment action as the Transactions page) or
// Close.
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

  const cell = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;

  return (
    <Fragment>
      <tr
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title={open ? "Close" : "Open this transaction"}
        style={{ cursor: "pointer" }}
      >
        <td className="muted" style={cell}>{tx.on_date ?? "—"}</td>
        <td style={{ ...cell, fontWeight: 600, color: pending ? "#a8842c" : undefined }}>{money(tx.amount)}</td>
        <td style={cell}>{tx.paid_to}</td>
        <td className="muted" style={cell}>{tx.status}</td>
        <td className="muted" style={{ fontSize: 11, textAlign: "right" }}>{open ? "▴" : "▾"}</td>
      </tr>
      {open && (
        <tr className="tasktable-expand">
          <td colSpan={TX_COLS}>
            <form onSubmit={submit} style={{ display: "grid", gap: 8, padding: "8px 0 10px", minWidth: 0 }}>
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
          </td>
        </tr>
      )}
    </Fragment>
  );
}
