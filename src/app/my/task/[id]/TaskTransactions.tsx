"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { attachTransaction, detachTransaction, createTaskTransaction } from "./actions";

export type TaskTx = {
  id: string;
  description: string | null;
  amount: number | null;
  paid_on: string | null;
  status: string;
  paid_from_account: string | null;
};

export type PayMethod = { id: string; name: string };

const money = (n: number | null) =>
  n == null ? "—" : n >= 1000 ? `$${Math.round(n).toLocaleString()}` : `$${Math.round(n * 100) / 100}`;

// Every row - attached or a search hit - uses the same three columns, so
// description, amount and the button line up down the panel. minWidth 0 at
// each level lets a long description ellipsize instead of pushing the grid
// wider than the card.
const ROW: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto auto",
  alignItems: "center",
  gap: 10,
  minWidth: 0,
};
const DESC: React.CSSProperties = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  minWidth: 0,
};

type TxDetail = {
  payment_reference: string | null;
  invoice_reference: string | null;
  paid_via: string | null;
  created_at: string | null;
  created_by: string | null;
  contractor: { id: string; name: string } | null;
  contract: { id: string; title: string } | null;
  attachments: { id: string; file_name: string; kind: string | null; bucket: string; path: string }[];
  payees: { id: string; name: string }[];
};

const chipStyle = (status: string): React.CSSProperties =>
  status === "paid"
    ? { background: "#e6f2ea", color: "#1f6b45" }
    : status === "planned" || status === "scheduled"
      ? { background: "#fdf4e3", color: "#a8842c" }
      : { background: "#f0f1ee", color: "#555" };

// One attached transaction: status shown on the row, click the description
// to open its detail (looked up on open, never on page load).
function AttachedRow({ t, taskId, canEdit }: { t: TaskTx; taskId: string; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<TxDetail | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  // "loading" | "done" | "denied" | "failed" — kept OUT of the effect's
  // dependencies: re-running the effect on its own state change would fire
  // the cleanup and cancel the fetch it had just started (the "Loading…
  // forever" bug).
  const [state, setState] = useState<"idle" | "loading" | "done" | "denied" | "failed">("idle");

  useEffect(() => {
    if (!open || state !== "idle") return;
    let cancelled = false;
    setState("loading");
    (async () => {
      try {
        const supabase = createBrowserClient();
        const { data, error } = await supabase.rpc("portal_transaction_detail", { p_tx: t.id });
        if (cancelled) return;
        if (error) { setState("failed"); return; }
        const d = (data ?? null) as TxDetail | null;
        if (!d) { setState("denied"); return; }
        setDetail(d);
        if (d.attachments?.length) {
          const signed: Record<string, string> = {};
          await Promise.all(d.attachments.map(async (a) => {
            const { data: s } = await supabase.storage.from(a.bucket).createSignedUrl(a.path, 3600);
            if (s?.signedUrl) signed[a.id] = s.signedUrl;
          }));
          if (!cancelled) setUrls(signed);
        }
        if (!cancelled) setState("done");
      } catch {
        if (!cancelled) setState("failed");
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, t.id]);

  return (
    <div style={{ display: "grid", gap: 6, borderTop: "1px solid #f0f1ee", paddingTop: 8, minWidth: 0 }}>
      <div className="small" style={ROW}>
        <button type="button" onClick={() => setOpen(!open)} title={open ? "Hide details" : "Show details"}
          style={{ ...DESC, background: "none", border: 0, padding: 0, font: "inherit", color: "inherit", cursor: "pointer", textAlign: "left" }}>
          <span style={{ textDecoration: "underline dotted" }}>{t.description || "(payment)"}</span>
          <span className="extra-chip" style={{ ...chipStyle(t.status), marginLeft: 8 }}>{t.status}</span>
        </button>
        <span className="muted" style={{ whiteSpace: "nowrap" }}>
          {money(t.amount)}{t.paid_on ? ` · ${t.paid_on}` : ""}
        </span>
        {canEdit ? (
          <form action={detachTransaction.bind(null, taskId, t.id)}>
            <button className="btn ghost small" style={{ padding: "2px 8px" }}>Detach</button>
          </form>
        ) : <span />}
      </div>
      {open && (
        <div className="small" style={{ display: "grid", gap: 4, padding: "6px 10px", background: "#f7f8f5", borderRadius: 8, minWidth: 0 }}>
          {state === "loading" && <span className="muted">Loading…</span>}
          {state === "denied" && (
            <span className="muted">Status: {t.status}{t.paid_from_account ? ` · from ${t.paid_from_account}` : ""}. The full detail (payee, references, receipts) is only shown to seats that see money on this project.</span>
          )}
          {state === "failed" && <span className="error">Could not load the detail — try again.</span>}
          {detail && (
            <>
              <div><span className="muted">Status:</span> {t.status}{detail.paid_via ? ` · via ${detail.paid_via}` : ""}{t.paid_from_account ? ` · from ${t.paid_from_account}` : ""}</div>
              {(detail.contractor || detail.payees.length > 0) && (
                <div><span className="muted">Paid to:</span> {detail.contractor?.name ?? detail.payees.map((p) => p.name).join(", ")}</div>
              )}
              {detail.contract && <div><span className="muted">Contract:</span> {detail.contract.title}</div>}
              {(detail.payment_reference || detail.invoice_reference) && (
                <div><span className="muted">Reference:</span> {[detail.payment_reference, detail.invoice_reference].filter(Boolean).join(" · ")}</div>
              )}
              {detail.attachments.length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {detail.attachments.map((a) => urls[a.id]
                    ? <a key={a.id} href={urls[a.id]} target="_blank" rel="noreferrer" className="extra-chip" style={{ textDecoration: "none" }}>{a.kind === "photo" ? "🖼" : "📄"} {a.file_name}</a>
                    : <span key={a.id} className="extra-chip">{a.file_name}</span>)}
                </div>
              )}
              <div className="muted">
                Logged {detail.created_at ? new Date(detail.created_at).toLocaleDateString() : "—"}{detail.created_by ? ` by ${detail.created_by}` : ""}
                {" · "}<Link href="/my/payments">All payments →</Link>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Club transactions under a task: attached ones with a detach control, a
// search over the project's unattached ones, and - when the transaction
// does not exist yet - a form to create it already attached.
export function TaskTransactions({
  taskId,
  attached,
  candidates,
  canEdit,
  methods,
  payees,
  accounts,
  openCreate = false,
}: {
  taskId: string;
  attached: TaskTx[];
  candidates: TaskTx[];
  canEdit: boolean;
  methods: PayMethod[];
  payees: string[];
  accounts: string[];
  // Land with the create form open (quick access from a task list).
  openCreate?: boolean;
}) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [] as TaskTx[];
    return candidates
      .filter((t) =>
        (t.description ?? "").toLowerCase().includes(s) ||
        (t.paid_from_account ?? "").toLowerCase().includes(s) ||
        String(t.amount ?? "").includes(s))
      .slice(0, 8);
  }, [q, candidates]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="card" style={{ display: "grid", gap: 10, minWidth: 0, overflow: "hidden" }}>
      <h2 className="section-title" style={{ margin: 0 }}>
        Transactions{attached.length > 0 ? ` · ${attached.length}` : ""}
      </h2>

      {attached.length === 0 && (
        <p className="muted small" style={{ margin: 0 }}>No transactions clubbed under this task yet.</p>
      )}
      {attached.map((t) => (
        <AttachedRow key={t.id} t={t} taskId={taskId} canEdit={canEdit} />
      ))}

      {canEdit && (
        <div style={{ display: "grid", gap: 8, minWidth: 0, borderTop: "1px solid #e7e9e4", paddingTop: 10 }}>
          <label className="small muted" htmlFor="tx-search" style={{ margin: 0 }}>
            Attach a transaction — search by payee, account or amount
          </label>
          <input
            id="tx-search"
            className="input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. Kuiken, 14676, credit card"
            autoComplete="off"
          />
          {q.trim() && matches.length === 0 && (
            <p className="muted small" style={{ margin: 0 }}>
              No unattached transactions match — it may already be attached elsewhere, or you can create it below.
            </p>
          )}
          {matches.map((t) => (
            <form key={t.id} action={attachTransaction.bind(null, taskId, t.id)} className="small" style={ROW}>
              <span style={DESC}>{t.description || "(payment)"}</span>
              <span className="muted" style={{ whiteSpace: "nowrap" }}>
                {money(t.amount)}{t.paid_on ? ` · ${t.paid_on}` : ""}
              </span>
              <button className="btn ghost small" style={{ padding: "2px 8px" }}>Attach</button>
            </form>
          ))}

          {/* Not logged yet: create it here, already attached to this task. */}
          <details style={{ minWidth: 0 }} open={openCreate} id="tx-create">
            <summary className="small" style={{ cursor: "pointer", fontWeight: 700 }}>
              ＋ Create a transaction
            </summary>
            <form
              action={createTaskTransaction.bind(null, taskId)}
              onSubmit={() => setBusy(true)}
              style={{ display: "grid", gap: 8, marginTop: 10, minWidth: 0 }}
            >
              <div className="form-2col">
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="ntx-paid-to">Paid to</label>
                  <input id="ntx-paid-to" name="paid_to" className="input" required autoComplete="off" list="ntx-payees" />
                  <datalist id="ntx-payees">
                    {payees.map((p) => <option key={p} value={p} />)}
                  </datalist>
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="ntx-amount">Amount</label>
                  <input id="ntx-amount" name="amount" className="input" required inputMode="decimal" placeholder="e.g. 4,500" />
                </div>
              </div>
              <div className="form-2col">
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="ntx-date">Date</label>
                  <input id="ntx-date" name="paid_on" type="date" className="input" defaultValue={today} />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="ntx-method">Payment type</label>
                  <select id="ntx-method" name="method" className="input" defaultValue="">
                    <option value="">—</option>
                    {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-2col">
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="ntx-from">Paid from</label>
                  <input id="ntx-from" name="paid_from" className="input" autoComplete="off" list="ntx-accounts" />
                  <datalist id="ntx-accounts">
                    {accounts.map((a) => <option key={a} value={a} />)}
                  </datalist>
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="ntx-status">Status</label>
                  <select id="ntx-status" name="status" className="input" defaultValue="paid">
                    <option value="paid">paid</option>
                    <option value="planned">planned</option>
                  </select>
                </div>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="ntx-notes">Note (optional)</label>
                <input id="ntx-notes" name="notes" className="input" />
              </div>
              <div>
                <button className="btn small" disabled={busy}>{busy ? "Saving…" : "Create and attach"}</button>
              </div>
            </form>
          </details>
        </div>
      )}
    </div>
  );
}
