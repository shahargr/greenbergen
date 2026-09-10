"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "./Sheet";
import { callFin } from "./call";
import { usd, type FinStage } from "./types";

// The payment schedule, written by the owner side: a milestone is a name,
// an amount (or a share of the contract), what triggers it, when it is due.
export function StageSheetButton({ contractId, contractAmount, stage, label, className = "btn btn-ghost small" }: {
  contractId: string; contractAmount: number | null; stage?: FinStage; label: string; className?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [name, setName] = useState(stage?.name ?? "");
  const [amount, setAmount] = useState(stage?.amount != null && stage.percent == null ? String(stage.amount) : "");
  const [percent, setPercent] = useState(stage?.percent != null ? String(stage.percent) : "");
  const [due, setDue] = useState(stage?.due_on ?? "");
  const [trigger, setTrigger] = useState(stage?.trigger ?? "");
  const pct = percent ? Number(percent) : null;
  const preview = pct != null && contractAmount != null ? usd(Math.round(contractAmount * pct) / 100) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    const r = await callFin("payment_stage_save", {
      p_contract: contractId, p_id: stage?.id ?? null, p_name: name,
      p_amount: amount ? Number(amount.replace(/[$,\s]/g, "")) : null,
      p_percent: pct, p_due_on: due || null, p_trigger: trigger || null,
    });
    setBusy(false);
    if (!r.ok) { setErr(r.reason); return; }
    setOpen(false);
    if (!stage) { setName(""); setAmount(""); setPercent(""); setDue(""); setTrigger(""); }
    router.refresh();
  }

  async function remove() {
    if (!stage || !confirm("Remove this milestone from the schedule?")) return;
    setBusy(true); setErr("");
    const r = await callFin("payment_stage_delete", { p_id: stage.id });
    setBusy(false);
    if (!r.ok) { setErr(r.reason); return; }
    setOpen(false); router.refresh();
  }

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{label}</button>
      {open && (
        <Sheet title={stage ? "Edit the milestone" : "Add a milestone"} onClose={() => setOpen(false)}>
          <form className="stack" style={{ gap: 10 }} onSubmit={(e) => void submit(e)}>
            <div className="field">
              <label htmlFor="st-name">Name</label>
              <input id="st-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Rough-in inspected" required />
            </div>
            <div className="row" style={{ gap: 8, alignItems: "flex-end" }}>
              <div className="field grow">
                <label htmlFor="st-amount">Amount ($)</label>
                <input id="st-amount" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="7,500" />
              </div>
              <div className="field grow">
                <label htmlFor="st-pct">or % of contract</label>
                <input id="st-pct" className="input" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} placeholder="20" />
              </div>
            </div>
            {preview && !amount && <p className="hint">{percent}% of {usd(contractAmount)} is {preview}.</p>}
            <div className="field">
              <label htmlFor="st-trigger">What has to be true</label>
              <input id="st-trigger" className="input" value={trigger} onChange={(e) => setTrigger(e.target.value)} placeholder="Town inspection passed, before sheetrock" />
            </div>
            <div className="field">
              <label htmlFor="st-due">Due</label>
              <input id="st-due" type="date" className="input" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
            {err && <p className="tiny" style={{ color: "var(--color-danger)", margin: 0 }}>{err}</p>}
            <button className="btn btn-primary btn-block" disabled={busy || !name || (!amount && !percent)}>{busy ? "Saving…" : stage ? "Save" : "Add it"}</button>
            {stage && stage.status === "Planned" && stage.settlement_status === "not_started" && (
              <button type="button" className="btn btn-ghost btn-block btn-danger" disabled={busy} onClick={() => void remove()}>Remove from the schedule</button>
            )}
          </form>
        </Sheet>
      )}
    </>
  );
}
