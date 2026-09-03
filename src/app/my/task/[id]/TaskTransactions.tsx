"use client";

import { useMemo, useState } from "react";
import { attachTransaction, detachTransaction } from "./actions";

export type TaskTx = {
  id: string;
  description: string | null;
  amount: number | null;
  paid_on: string | null;
  status: string;
  paid_from_account: string | null;
};

const money = (n: number | null) =>
  n == null ? "—" : n >= 1000 ? `$${Math.round(n).toLocaleString()}` : `$${Math.round(n * 100) / 100}`;

// Club transactions under a task. Attached ones show with a detach control;
// a search filters the project's unattached transactions to attach more.
// Multiple transactions can hang under one task.
export function TaskTransactions({
  taskId,
  attached,
  candidates,
  canEdit,
}: {
  taskId: string;
  attached: TaskTx[];
  candidates: TaskTx[];
  canEdit: boolean;
}) {
  const [q, setQ] = useState("");
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

  const line = (t: TaskTx) => (
    <>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
        {t.description || "(payment)"}
      </span>
      <span className="muted" style={{ whiteSpace: "nowrap" }}>
        {money(t.amount)}{t.paid_on ? ` · ${t.paid_on}` : ""}
      </span>
    </>
  );

  return (
    <div className="card" style={{ display: "grid", gap: 10 }}>
      <h2 className="section-title" style={{ margin: 0 }}>
        Transactions{attached.length > 0 ? ` · ${attached.length}` : ""}
      </h2>

      {attached.length === 0 && (
        <p className="muted small" style={{ margin: 0 }}>No transactions clubbed under this task yet.</p>
      )}
      {attached.map((t) => (
        <div key={t.id} className="small" style={{ display: "flex", alignItems: "center", gap: 10, borderTop: "1px solid #f0f1ee", paddingTop: 8 }}>
          {line(t)}
          {canEdit && (
            <form action={detachTransaction.bind(null, taskId, t.id)}>
              <button className="btn ghost small" title="Detach" style={{ padding: "2px 8px" }}>Detach</button>
            </form>
          )}
        </div>
      ))}

      {canEdit && (
        <div style={{ display: "grid", gap: 8, borderTop: "1px solid #e7e9e4", paddingTop: 10 }}>
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
            <p className="muted small" style={{ margin: 0 }}>No unattached transactions match — it may already be attached elsewhere.</p>
          )}
          {matches.map((t) => (
            <form key={t.id} action={attachTransaction.bind(null, taskId, t.id)}
              className="small" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {line(t)}
              <button className="btn ghost small" style={{ padding: "2px 8px" }}>Attach</button>
            </form>
          ))}
        </div>
      )}
    </div>
  );
}
