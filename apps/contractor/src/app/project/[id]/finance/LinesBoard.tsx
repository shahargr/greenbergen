"use client";

import { useState, useTransition } from "react";
import Link from "next/link";

// The budget lines, one row each (Shahar's review, 2026-09-23):
//   a. one line per row; editing is behind a pencil, not always-on inputs;
//   b. status is new / bid / awarded / working / completed, derived - never
//      typed (rule 34) - from the package, the contract and the money;
//   c. clicking a row unfolds it: payments made, the contract's schedule;
//   d. no per-row checkbox - a floating save appears while an edit is open;
//      each figure carries its label ABOVE it and reads in $k;
//   e. status is a chip, with the contract named under it;
//   f. Balance, against the contract when one exists, else the target;
//   g. "Link a contract" is a button; a trash can disconnects one;
//   h. a catcher row at the bottom holds spend filed to no line.
// And from 2026-09-24: the unfold IS the panel - editing swaps its contents,
// it never stacks a second panel - and a line is disabled, not deleted,
// which files it at the very end under its own Disabled section.
export type Payment = {
  id: string; paid_on: string | null; amount: number | null; status: string;
  description: string | null; reference: string | null;
};
export type Stage = {
  name: string | null; amount: number | null; due_on: string | null;
  settlement_status: string | null; paid_at: string | null;
};
export type BudgetLine = {
  id: string; category: string; phase: string | null; trade: string | null;
  cost_type: string | null; is_builder_scope: boolean;
  target_amount: number | null; agreed_amount: number | null; notes: string | null;
  disabled_at: string | null;
  actual_paid: number; open_committed: number;
  package_id: string | null; package_status: string | null;
  contract_id: string | null; contract_title: string | null; contract_status: string | null;
  contract_amount: number | null; contract_signed: string | null;
  payments: Payment[]; stages: Stage[];
};
export type ContractOpt = {
  id: string; title: string | null; trade: string | null; status: string;
  amount: number | null; budget_category_id: string | null;
};
export type Unattached = {
  actual_paid: number; open_committed: number; count: number; payments: Payment[];
};

type Acts = {
  save: (fd: FormData) => Promise<void>;
  link: (lineId: string, fd: FormData) => Promise<void>;
  unlink: (lineId: string, contractId: string, fd: FormData) => Promise<void>;
  startBid: (lineId: string, trade: string | null, fd: FormData) => Promise<void>;
};

// $k money: $1.8k, $52k; under a thousand stays plain.
const k = (n: number | null | undefined) => {
  if (n == null) return "—";
  const a = Math.abs(n);
  if (a < 1000) return `$${Math.round(n).toLocaleString()}`;
  const v = n / 1000;
  const s = a < 10000 ? v.toFixed(1).replace(/\.0$/, "") : Math.round(v).toLocaleString();
  return `$${s}k`;
};

type StatusKey = "new" | "bid" | "awarded" | "working" | "completed";
const TONE: Record<StatusKey | "unfiled" | "disabled", { background: string; color: string }> = {
  new: { background: "var(--color-soft)", color: "var(--color-text)" },
  bid: { background: "var(--color-bid-soft)", color: "var(--color-bid)" },
  awarded: { background: "var(--color-ok-soft)", color: "var(--color-ok)" },
  working: { background: "var(--color-ok)", color: "#fff" },
  completed: { background: "var(--color-soft-2)", color: "var(--color-ok)" },
  unfiled: { background: "var(--color-soft)", color: "var(--color-muted)" },
  disabled: { background: "var(--color-soft)", color: "var(--color-muted)" },
};

function statusOf(l: BudgetLine): StatusKey {
  const goal = l.contract_amount ?? l.agreed_amount;
  if (l.contract_status?.toLowerCase().startsWith("complete")) return "completed";
  if (l.contract_id && goal != null && goal > 0 && l.actual_paid >= goal - 0.5) return "completed";
  if (l.contract_id && l.actual_paid > 0) return "working";
  if (l.contract_id || l.package_status === "awarded") return "awarded";
  if (l.package_id) return "bid";
  return "new";
}

function Chip({ s }: { s: StatusKey | "unfiled" | "disabled" }) {
  return <span className="tag" style={{ ...TONE[s], textTransform: "capitalize" }}>{s}</span>;
}

// A figure with its label above it - the row is self-labelled, no header row.
function Fig({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <span style={{ display: "grid", gap: 1, textAlign: "right", minWidth: 50 }}>
      <span className="tiny text-muted" style={{ textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</span>
      <span style={{ fontWeight: 700, fontSize: 14, color: tone, whiteSpace: "nowrap" }}>{value}</span>
    </span>
  );
}

const g = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true, width: 15, height: 15 };
const Pencil = () => <svg {...g}><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>;
const Trash = () => <svg {...g}><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" /></svg>;

function PayList({ rows }: { rows: Payment[] }) {
  if (rows.length === 0) return <p className="small text-muted" style={{ margin: 0 }}>No payments yet.</p>;
  return (
    <div style={{ display: "grid", gap: 3 }}>
      {rows.map((p) => (
        <div key={p.id} className="small" style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
          <span className="text-muted" style={{ whiteSpace: "nowrap" }}>{p.paid_on ?? "—"}</span>
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
            {p.description ?? p.reference ?? p.status}
          </span>
          <span style={{ whiteSpace: "nowrap" }}>
            {k(p.amount)} <span className="text-muted">{p.status}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function LinesBoard({ projectId, lines, contracts, unattached, trades, phases, q, acts }: {
  projectId: string;
  lines: BudgetLine[];
  contracts: ContractOpt[];
  unattached: Unattached | null;
  trades: string[];
  phases: string[];
  q: string | null;
  acts: Acts;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [edit, setEdit] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, start] = useTransition();
  const freeContracts = contracts.filter((c) => !c.budget_category_id);

  const beginEdit = (l: BudgetLine) => {
    setEdit(l.id); setOpen(l.id);
    setDraft({
      category: l.category, trade: l.trade ?? "", phase: l.phase ?? "",
      target_amount: l.target_amount == null ? "" : String(l.target_amount),
    });
  };
  const withQ = (fd: FormData) => { if (q) fd.set("q", q); return fd; };
  const saveEdit = () => {
    if (!edit) return;
    start(async () => {
      const fd = withQ(new FormData());
      fd.set("id", edit);
      fd.set("category", draft.category ?? "");
      fd.set("trade", draft.trade ?? "");
      fd.set("phase", draft.phase ?? "");
      fd.set("target_amount", draft.target_amount ?? "");
      await acts.save(fd);
    });
  };

  // Retire or revive: one save with only the disabled key, nothing else moves.
  const toggleDisabled = (l: BudgetLine) => start(async () => {
    const fd = withQ(new FormData());
    fd.set("id", l.id);
    fd.set("disabled", l.disabled_at ? "0" : "1");
    await acts.save(fd);
  });

  const row = (l: BudgetLine) => {
    const s = l.disabled_at ? ("disabled" as const) : statusOf(l);
    const goal = l.contract_amount ?? l.agreed_amount ?? l.target_amount;
    const balance = goal == null ? null : goal - l.actual_paid;
    const editing = edit === l.id;
    const unfolded = open === l.id;
    return (
      <div key={l.id} style={{ borderTop: "1px solid var(--color-divider)", padding: "8px 0", display: "grid", gap: 8 }}>
        {/* THE ONE LINE. Click anywhere on it to unfold; the icons act. */}
        <div style={{ display: "flex", gap: 12, alignItems: "center", cursor: "pointer",
            opacity: l.disabled_at ? 0.55 : undefined }}
          onClick={() => setOpen(unfolded ? null : l.id)}>
          <span style={{ flex: "1 1 150px", minWidth: 0 }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{l.category}</span>
            <span className="small text-muted" style={{ display: "block" }}>
              {[l.trade, l.phase].filter(Boolean).join(" · ") || "—"}
            </span>
          </span>
          <span style={{ display: "flex", gap: 12 }}>
            <Fig label="Target" value={k(l.target_amount)} />
            <Fig label="Agreed" value={k(l.agreed_amount)} />
            <Fig label="Paid" value={k(l.actual_paid)} tone="var(--color-ok)" />
            <Fig label="Balance" value={balance == null ? "—" : k(balance)}
              tone={balance != null && balance < 0 ? "var(--color-danger)" : undefined} />
          </span>
          {/* Status above, the contract it stands on below (e). */}
          <span style={{ flex: "0 1 160px", minWidth: 88, display: "grid", gap: 2, justifyItems: "start" }}>
            <Chip s={s} />
            {l.contract_title && (
              <span className="tiny text-muted" style={{ overflow: "hidden", textOverflow: "ellipsis",
                whiteSpace: "nowrap", maxWidth: "100%" }}>
                {l.contract_signed ? "Signed · " : ""}{l.contract_title}
              </span>
            )}
          </span>
          <span style={{ display: "flex", gap: 6, alignItems: "center" }} onClick={(e) => e.stopPropagation()}>
            <button type="button" className="btn btn-ghost" title="Edit this line" aria-label={`Edit ${l.category}`}
              style={{ padding: "5px 8px" }} onClick={() => (editing ? setEdit(null) : beginEdit(l))}>
              <Pencil />
            </button>
            {l.disabled_at ? (
              <button type="button" className="btn btn-ghost" title="Bring this line back into the plan"
                disabled={busy} style={{ whiteSpace: "nowrap" }} onClick={() => toggleDisabled(l)}>Enable</button>
            ) : l.contract_id ? (
              <button type="button" className="btn btn-ghost" title="Disconnect the contract" disabled={busy}
                style={{ padding: "5px 8px", color: "var(--color-danger)" }}
                onClick={() => start(() => acts.unlink(l.id, l.contract_id!, withQ(new FormData())))}>
                <Trash />
              </button>
            ) : (
              <button type="button" className="btn btn-ghost" title="Link a contract to this line"
                style={{ whiteSpace: "nowrap" }} onClick={() => setOpen(l.id)}>Link a contract</button>
            )}
          </span>
        </div>

        {/* THE UNFOLD (c): ONE panel. Reading, it shows what was paid and what
            the contract schedules; editing, it BECOMES the editor - the
            detail never stacks beneath the fields as a second panel. */}
        {unfolded && (
          <div style={{ background: "var(--color-soft-2)", borderRadius: 14, padding: "10px 12px", display: "grid", gap: 10 }}>
            {editing ? (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <input className="input" value={draft.category ?? ""} style={{ flex: "2 1 160px" }}
                  onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value }))} />
                <select className="input" value={draft.trade ?? ""} style={{ flex: "1 1 130px" }}
                  onChange={(e) => setDraft((d) => ({ ...d, trade: e.target.value }))}>
                  <option value="">Trade — none</option>
                  {trades.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <select className="input" value={draft.phase ?? ""} style={{ flex: "1 1 140px" }}
                  onChange={(e) => setDraft((d) => ({ ...d, phase: e.target.value }))}>
                  <option value="">Phase — none</option>
                  {phases.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <label className="small" style={{ display: "grid", gap: 1 }}>
                  <span className="tiny text-muted" style={{ textTransform: "uppercase" }}>Target</span>
                  <input className="input" value={draft.target_amount ?? ""} inputMode="decimal" placeholder="$"
                    style={{ width: 100, textAlign: "right" }}
                    onChange={(e) => setDraft((d) => ({ ...d, target_amount: e.target.value }))} />
                </label>
                {/* Retire, never delete (2026-09-24): the line and everything
                    filed against it survive, at the end under Disabled. */}
                <button type="button" className="btn btn-ghost small" disabled={busy}
                  style={{ color: l.disabled_at ? undefined : "var(--color-danger)" }}
                  onClick={() => toggleDisabled(l)}>
                  {l.disabled_at ? "enable line" : "disable line"}
                </button>
              </div>
            ) : (<>
            {l.contract_id ? (
              <div className="small" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
                <strong>{l.contract_title ?? "Contract"}</strong>
                <span className="text-muted">{l.contract_status}{l.contract_signed ? ` · signed ${l.contract_signed}` : ""}</span>
                {l.contract_amount != null && <span>{k(l.contract_amount)}</span>}
              </div>
            ) : l.disabled_at ? null : (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                {freeContracts.length > 0 && (
                  <>
                    <select className="input" id={`lc-${l.id}`} style={{ maxWidth: 260 }} defaultValue="">
                      <option value="" disabled>Pick the contract…</option>
                      {freeContracts.map((c) => (
                        <option key={c.id} value={c.id}>
                          {(c.title ?? c.trade ?? "Contract").slice(0, 48)}{c.amount != null ? ` · ${k(c.amount)}` : ""}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => {
                      const sel = document.getElementById(`lc-${l.id}`) as HTMLSelectElement | null;
                      if (!sel?.value) return;
                      const fd = withQ(new FormData()); fd.set("contract", sel.value);
                      start(() => acts.link(l.id, fd));
                    }}>Link a contract</button>
                  </>
                )}
                {/* A bid room needs a real trade (226) - a line without one
                    gets sent to its own editor first, not to an error. */}
                {!l.package_id && (l.trade ? (
                  <button type="button" className="btn btn-ghost" disabled={busy}
                    onClick={() => start(() => acts.startBid(l.id, l.trade, withQ(new FormData())))}>
                    Start a bid
                  </button>
                ) : (
                  <button type="button" className="btn btn-ghost" title="Pick the line's trade, save, then bid"
                    onClick={() => beginEdit(l)}>
                    Set the trade, then bid
                  </button>
                ))}
                {l.package_id && (
                  <Link className="btn btn-ghost" href={`/project/${projectId}/bids/${l.package_id}`}>
                    Open the bid ({l.package_status})
                  </Link>
                )}
              </div>
            )}

            {l.stages.length > 0 && (
              <div style={{ display: "grid", gap: 3 }}>
                <span className="tiny text-muted" style={{ textTransform: "uppercase", letterSpacing: 0.4 }}>Payment schedule</span>
                {l.stages.map((st, i) => (
                  <div key={i} className="small" style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{st.name ?? `Stage ${i + 1}`}</span>
                    <span className="text-muted" style={{ whiteSpace: "nowrap" }}>{st.due_on ?? ""}</span>
                    <span style={{ whiteSpace: "nowrap" }}>{k(st.amount)} <span className="text-muted">{st.paid_at ? "paid" : st.settlement_status ?? "open"}</span></span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "grid", gap: 3 }}>
              <span className="tiny text-muted" style={{ textTransform: "uppercase", letterSpacing: 0.4 }}>Payments made</span>
              <PayList rows={l.payments} />
            </div>
            {l.notes && <p className="small text-muted" style={{ margin: 0 }}>{l.notes}</p>}
            </>)}
          </div>
        )}
      </div>
    );
  };

  const active = lines.filter((l) => !l.disabled_at);
  const retired = lines.filter((l) => l.disabled_at);

  return (
    <div style={{ display: "grid" }}>
      {active.map(row)}

      {/* THE CATCHER (h): every dollar on this project that names no budget
          line. It cannot be edited here - it exists to be seen and filed. */}
      {unattached && unattached.count > 0 && (
        <div style={{ borderTop: "1px solid var(--color-divider-strong)", padding: "8px 0", display: "grid", gap: 8 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", cursor: "pointer" }}
            onClick={() => setOpen(open === "unfiled" ? null : "unfiled")}>
            <span style={{ flex: "1 1 150px", minWidth: 0 }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>Everything else</span>
              <span className="small text-muted" style={{ display: "block" }}>
                {unattached.count} payment{unattached.count === 1 ? "" : "s"} filed to no line
              </span>
            </span>
            <span style={{ display: "flex", gap: 12 }}>
              <Fig label="Paid" value={k(unattached.actual_paid)} tone="var(--color-bid)" />
              <Fig label="Scheduled" value={k(unattached.open_committed)} />
            </span>
            <span style={{ flex: "0 1 160px", minWidth: 88 }}><Chip s="unfiled" /></span>
            <span style={{ width: 70 }} />
          </div>
          {open === "unfiled" && (
            <div style={{ background: "var(--color-soft-2)", borderRadius: 14, padding: "10px 12px", display: "grid", gap: 6 }}>
              <PayList rows={unattached.payments} />
              <p className="small text-muted" style={{ margin: 0 }}>
                File these against a line from the payment itself (Log payment → budget line), and this bucket empties.
              </p>
            </div>
          )}
        </div>
      )}

      {/* THE DISABLED SECTION (2026-09-24): retired lines file at the very
          end, dimmed, with everything filed against them intact. Enable
          brings one back into the plan. */}
      {retired.length > 0 && (
        <div style={{ borderTop: "1px solid var(--color-divider-strong)", paddingTop: 8, marginTop: 4 }}>
          <span className="tiny text-muted" style={{ textTransform: "uppercase", letterSpacing: 0.4 }}>
            Disabled — out of the plan, history kept
          </span>
          {retired.map(row)}
        </div>
      )}

      {/* THE FLOATING SAVE (d): appears only while a line is being edited. */}
      {edit && (
        <div style={{ position: "fixed", right: 18, bottom: 18, display: "flex", gap: 8, zIndex: 50 }}>
          <button type="button" className="btn btn-ghost" disabled={busy} style={{ background: "var(--color-surface)" }}
            onClick={() => setEdit(null)}>Cancel</button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={saveEdit}
            style={{ boxShadow: "var(--shadow-card)" }}>
            {busy ? "Saving…" : "Save line ✓"}
          </button>
        </div>
      )}
    </div>
  );
}
