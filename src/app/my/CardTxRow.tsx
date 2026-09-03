"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { FileDrop } from "@/components/FileDrop";
import { editPayment } from "./actions";

// A transaction as the homepage card carries it: the compact row fields plus
// what the edit form needs. Everything richer is fetched ON OPEN (one lookup
// per opened transaction) so the page load never pays for it.
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

type TxDetail = {
  payment_reference: string | null;
  invoice_reference: string | null;
  paid_via: string | null;
  created_at: string | null;
  created_by: string | null;
  last_modified_at: string | null;
  last_modified_by: string | null;
  contractor: { id: string; name: string } | null;
  contract: { id: string; title: string } | null;
  task: { id: string; action: string } | null;
  attachments: { id: string; file_name: string; kind: string | null; bucket: string; path: string; created_at: string }[];
  payees: { id: string; name: string }[];
};

const money = (n: number | null) =>
  n == null ? "—" : n >= 1000 ? `$${Math.round(n).toLocaleString()}` : `$${Math.round(n * 100) / 100}`;
const when = (s: string | null) => (s ? new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

// Column headers shared by the Recent and Pending tables on the card.
export const TX_COLS = 5; // Date · Amount · Paid to · Status · (toggle)
export function CardTxHead() {
  return (
    <thead>
      <tr>
        <th style={{ width: 92 }}>Date</th>
        <th style={{ width: 84 }}>Amount</th>
        <th>Paid to</th>
        <th className="col-status" style={{ width: 150 }}>Status</th>
        <th style={{ width: 22 }} aria-label="Open" />
      </tr>
    </thead>
  );
}

// Clickable table row. Click → the transaction opens beneath it READ-ONLY
// (and fires its one lookup); "Edit" switches to a form (Save / Cancel);
// "Add evidence" attaches a receipt without touching any field. All writes go
// through editPayment, the same action the Transactions page uses.
export function CardTxRow({
  tx,
  statuses,
  methods,
  pending,
  className,
}: {
  tx: CardTx;
  statuses: string[];
  methods: { id: string; name: string }[];
  pending: boolean;
  // e.g. "tx-extra" — hidden on narrow screens by CSS.
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [detail, setDetail] = useState<TxDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});
  // Only "Payment to X" descriptions expose an editable payee; other rows
  // (e.g. "RE taxes - Nov 2027") keep their description as-is.
  const isPayTo = /^payment to /i.test(tx.description ?? "");
  const methodName = methods.find((m) => m.id === tx.payment_method_id)?.name ?? "—";

  // The one lookup: only when opened, only once per open session of the row.
  useEffect(() => {
    if (!open || detail || loading) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const supabase = createClient();
      const { data } = await supabase.rpc("portal_transaction_detail", { p_tx: tx.id });
      if (cancelled) return;
      const d = (data ?? null) as TxDetail | null;
      setDetail(d);
      setLoading(false);
      // Receipts live in the private project bucket: sign them for display.
      if (d?.attachments?.length) {
        const signed: Record<string, string> = {};
        await Promise.all(d.attachments.map(async (a) => {
          const { data: s } = await supabase.storage.from(a.bucket).createSignedUrl(a.path, 3600);
          if (s?.signedUrl) signed[a.id] = s.signedUrl;
        }));
        if (!cancelled) setUrls(signed);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function post(fd: FormData) {
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
  async function submitEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await post(new FormData(e.currentTarget));
  }
  async function submitEvidence(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (!Array.from(fd.getAll("photos")).some((f) => f instanceof File && f.size > 0)) {
      setErr("Pick a photo or file first.");
      return;
    }
    await post(fd);
  }

  const cell = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;
  const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div style={{ minWidth: 0 }}>
      <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
      <div style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
    </div>
  );
  const payeeList = `ctx-payees-${tx.id}`;

  return (
    <Fragment>
      <tr
        className={className}
        onClick={() => { setOpen(!open); setMode("view"); setErr(""); }}
        aria-expanded={open}
        title={open ? "Close" : "Open this transaction"}
        style={{ cursor: "pointer" }}
      >
        <td className="muted" style={cell}>{tx.on_date ?? "—"}</td>
        <td style={{ ...cell, fontWeight: 600, color: pending ? "#a8842c" : undefined }}>{money(tx.amount)}</td>
        <td style={cell}>{tx.paid_to}</td>
        <td className="muted col-status" style={cell}>{tx.status}</td>
        <td className="muted" style={{ fontSize: 11, textAlign: "right" }}>{open ? "▴" : "▾"}</td>
      </tr>

      {open && mode === "view" && (
        <tr className="tasktable-expand">
          <td colSpan={TX_COLS}>
            <div style={{ display: "grid", gap: 10, padding: "8px 0 10px", minWidth: 0 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }} className="small">
                <Field label={isPayTo ? "Paid to" : "Description"} value={<strong>{isPayTo ? tx.paid_to : (tx.description ?? tx.paid_to)}</strong>} />
                <Field label="Amount" value={<strong>{money(tx.amount)}</strong>} />
                <Field label={pending ? "Due / paid on" : "Paid on"} value={tx.paid_on ?? tx.on_date ?? "—"} />
                <Field label="Status" value={tx.status} />
                <Field label="Method" value={methodName} />
                <Field label="Paid from" value={tx.paid_from_account ?? "—"} />
              </div>
              {tx.notes && (
                <div className="small"><span className="muted">Notes: </span>{tx.notes}</div>
              )}

              {/* The lookup: contract, task, references, audit trail, receipts. */}
              {loading && <span className="muted small">Loading details…</span>}
              {detail && (
                <div style={{ display: "grid", gap: 8, borderTop: "1px solid #eef0ec", paddingTop: 8 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }} className="small">
                    <Field label="Contact on record" value={detail.contractor?.name ?? "—"} />
                    <Field label="Contract" value={detail.contract?.title ?? "—"} />
                    <Field label="Task" value={detail.task
                      ? <Link href={`/my/task/${detail.task.id}`}>{detail.task.action}</Link>
                      : "—"} />
                    <Field label="Reference" value={[detail.payment_reference, detail.invoice_reference].filter(Boolean).join(" · ") || "—"} />
                    <Field label="Entered" value={<>{when(detail.created_at)}<span className="muted"> · {detail.created_by ?? "—"}</span></>} />
                    <Field label="Last change" value={<>{when(detail.last_modified_at)}<span className="muted"> · {detail.last_modified_by ?? "—"}</span></>} />
                  </div>
                  <div>
                    <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>
                      Evidence · {detail.attachments.length}
                    </div>
                    {detail.attachments.length === 0 && <span className="muted small">No receipt attached yet.</span>}
                    {detail.attachments.length > 0 && (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                        {detail.attachments.map((a) => {
                          const u = urls[a.id];
                          const isImg = a.kind === "photo";
                          return u ? (
                            <a key={a.id} href={u} target="_blank" rel="noreferrer" title={a.file_name}
                              style={{ display: "inline-block", textDecoration: "none" }}>
                              {isImg
                                // eslint-disable-next-line @next/next/no-img-element
                                ? <img src={u} alt={a.file_name} style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8, border: "1px solid #e7e9e4" }} />
                                : <span className="extra-chip">📄 {a.file_name}</span>}
                            </a>
                          ) : (
                            <span key={a.id} className="extra-chip">{a.file_name}</span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {err && <p className="error small" style={{ margin: 0 }}>{err}</p>}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <button type="button" className="btn small" onClick={() => { setMode("edit"); setErr(""); }} disabled={busy}>✏️ Edit</button>
                <form onSubmit={submitEvidence} style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <input type="hidden" name="tx" value={tx.id} />
                  <input type="hidden" name="back" value="/my" />
                  <label className="btn ghost small" style={{ cursor: "pointer" }}>
                    📎 Add evidence
                    <input type="file" name="photos" accept="image/*,application/pdf" multiple style={{ display: "none" }}
                      onChange={(e) => e.currentTarget.form?.requestSubmit()} />
                  </label>
                  {busy && <span className="muted small">Uploading…</span>}
                </form>
                <button type="button" className="btn ghost small" onClick={() => setOpen(false)} disabled={busy}>Close</button>
              </div>
            </div>
          </td>
        </tr>
      )}

      {open && mode === "edit" && (
        <tr className="tasktable-expand">
          <td colSpan={TX_COLS}>
            <form onSubmit={submitEdit} style={{ display: "grid", gap: 8, padding: "8px 0 10px", minWidth: 0 }}>
              <input type="hidden" name="tx" value={tx.id} />
              <input type="hidden" name="back" value="/my" />
              {isPayTo ? (
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor={`ctx-to-${tx.id}`}>Paid to</label>
                  {/* Payee suggestions come from the lookup (people on the project). */}
                  <input id={`ctx-to-${tx.id}`} name="paid_to" className="input" defaultValue={tx.paid_to} list={payeeList} autoComplete="off" />
                  <datalist id={payeeList}>
                    {(detail?.payees ?? []).map((p) => <option key={p.id} value={p.name} />)}
                  </datalist>
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
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Evidence / receipt (optional)</label>
                <FileDrop name="photos" accept="image/*,application/pdf" label="Add receipts" />
              </div>
              {err && <p className="error small" style={{ margin: 0 }}>{err}</p>}
              <div className="btn-row">
                <button className="btn small" disabled={busy}>{busy ? "Saving..." : "Save"}</button>
                <button type="button" className="btn ghost small" onClick={() => { setMode("view"); setErr(""); }} disabled={busy}>Cancel</button>
              </div>
            </form>
          </td>
        </tr>
      )}
    </Fragment>
  );
}
