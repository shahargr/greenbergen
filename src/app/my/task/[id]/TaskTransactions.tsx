"use client";

import { useMemo, useState } from "react";
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
}: {
  taskId: string;
  attached: TaskTx[];
  candidates: TaskTx[];
  canEdit: boolean;
  methods: PayMethod[];
  payees: string[];
  accounts: string[];
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
        <div key={t.id} className="small" style={{ ...ROW, borderTop: "1px solid #f0f1ee", paddingTop: 8 }}>
          <span style={DESC}>{t.description || "(payment)"}</span>
          <span className="muted" style={{ whiteSpace: "nowrap" }}>
            {money(t.amount)}{t.paid_on ? ` · ${t.paid_on}` : ""}
          </span>
          {canEdit ? (
            <form action={detachTransaction.bind(null, taskId, t.id)}>
              <button className="btn ghost small" style={{ padding: "2px 8px" }}>Detach</button>
            </form>
          ) : <span />}
        </div>
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
          <details style={{ minWidth: 0 }}>
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
