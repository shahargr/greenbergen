"use client";

import { useMemo, useState } from "react";
import { createClient } from "@shared/supabase/client";
import { friendly } from "@shared/rpc";
import { PaymentBox, type Method } from "../../../task/[id]/PaymentBox";

// TRADE, THEN TASK, THEN CONTRACT.
//
// Shahar (2026-09-22), reading the screen from the top down:
//
//   a. which trade  - drop down. allow to add a trade if needed.
//   b. which task   - show only tasks associated with that trade. allow to
//                     add a task if needed.
//   c. which contract - all contracts associated with this task / trade.
//   where it lands - replaced by a (trade)
//
// It used to open on "which job", then a select of every open task on the
// site - 148 of them on 55 Walnut - with a search box to make that bearable.
// Searching is how you find a thing when the screen cannot narrow it for you;
// the trade narrows it, because a receipt in your hand is a FRAMING receipt
// before it is anything else. Three answers, each one shortening the next.
//
// THE JOB IS NOT ASKED ANY MORE. It is shown on each task instead. On a site
// with sub-jobs the trade cuts across them, and asking which job first put a
// question in front of the one thing the person already knows.
export type PayChoice = {
  id: string; action: string; project_id: string; project: string;
  owed: number; due: string | null; contract_id: string | null; contract: string | null;
  /** What the task is filed under. Null is a real answer - most of 55 Walnut. */
  trade: string | null;
};
/** A budget line on one of the jobs, so a payment can be counted against it. */
export type BudgetLine = { id: string; project_id: string; category: string; phase: string | null };
export type ContractDefault = {
  contract_id: string; title: string | null; trade: string | null;
  party: string | null; account: string | null; method: string | null;
};

/** The catalogue, for a trade this job does not have yet. */
export type TradeChoice = { trade: string };

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const shortDay = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Tasks with no trade are a category of their own, not a blank. */
const NONE = "__none__";

export function PayForm({
  projectId, choices, defaults, budgetLines, methods, accounts, people, defaultTask,
  trades, startAmount = null,
}: {
  projectId: string;
  /** Arrived from a payment gate that already knows what it is worth (190). */
  choices: PayChoice[];
  defaults: ContractDefault[];
  budgetLines: BudgetLine[];
  methods: Method[];
  accounts: string[];
  people: { contact_id: string; name: string }[];
  defaultTask: string | null;
  /** Every trade in the catalogue, so one can be added from here. */
  trades: string[];
  startAmount?: string | null;
}) {
  // Tasks created from this screen, held locally so the one you just made is
  // selectable without a round trip through the server component.
  const [made, setMade] = useState<PayChoice[]>([]);
  const all = useMemo(() => [...made, ...choices], [made, choices]);

  const preset = defaultTask ? all.find((c) => c.id === defaultTask) ?? null : null;

  // WHICH TRADES THIS JOB ACTUALLY HAS, counted off its own open work rather
  // than off a list somebody maintains. In trade order, with the one holding
  // the most open work first.
  const onJob = useMemo(() => {
    const n = new Map<string, number>();
    for (const c of all) n.set(c.trade ?? NONE, (n.get(c.trade ?? NONE) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [all]);

  const [trade, setTrade] = useState<string>(preset ? preset.trade ?? NONE : "");
  const [task, setTask] = useState(preset?.id ?? "");
  const [q, setQ] = useState("");

  // WHAT IS UNDER THE CHOSEN TRADE. Nothing chosen shows nothing: the point
  // of the trade is that it answers most of the question before the list is
  // drawn at all.
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const inTrade = trade === "" ? [] : all.filter((c) => (c.trade ?? NONE) === trade);
  const shown = inTrade.filter((c) => words.every((w) =>
    c.action.toLowerCase().includes(w) || (c.contract ?? "").toLowerCase().includes(w)));

  const picked = all.find((c) => c.id === task) ?? null;

  // WHICH CONTRACT. The task's own comes first and is chosen for you, because
  // it is right nearly always; the rest of the trade's contracts are there
  // for the receipt that belongs to a different one. It was never asked
  // before - the task's contract was posted in a hidden field - which was
  // fine until a trade had two.
  const tradeDeals = useMemo(() => {
    const t = trade === NONE ? null : trade;
    const seen = new Set<string>();
    return defaults.filter((d) => {
      if (seen.has(d.contract_id)) return false;
      if (picked?.contract_id === d.contract_id) { seen.add(d.contract_id); return true; }
      if (t && d.trade === t) { seen.add(d.contract_id); return true; }
      return false;
    });
  }, [defaults, trade, picked?.contract_id]);

  const [dealTouched, setDealTouched] = useState(false);
  const [dealPick, setDealPick] = useState("");
  const deal = dealTouched ? dealPick : picked?.contract_id ?? "";
  const d = deal ? defaults.find((x) => x.contract_id === deal) ?? null : null;

  // WHERE IT LANDS, NARROWED BY THE TRADE. The budget lines are finer than
  // trades - "Framing" is Framing Labor AND Framing Materials on 55 Walnut -
  // so the trade cannot simply BE the answer without guessing between them,
  // and a balance that is confidently wrong is worse than a question. What
  // the trade does is cut forty lines down to the two that could be meant.
  const t = trade === NONE ? null : trade;
  const matching = t
    ? budgetLines.filter((b) => b.category.toLowerCase().includes(t.toLowerCase()))
    : [];
  const linesHere = (matching.length > 0 ? matching : budgetLines)
    .filter((b) => !picked || b.project_id === picked.project_id);
  const [lineTouched, setLineTouched] = useState(false);
  const [linePick, setLinePick] = useState("");
  // One line under this trade is not a choice, it is the answer.
  const line = lineTouched ? linePick : (matching.length === 1 ? matching[0]!.id : "");

  return (
    <>
      <input type="hidden" name="action_id" value={task} />
      <input type="hidden" name="contract_id" value={deal} />
      <input type="hidden" name="budget_category_id" value={line} />

      {/* ── a. WHICH TRADE ── */}
      <label className="field">
        <span className="field-label">Which trade <span className="req">required</span></span>
        <select className="input" value={trade}
          onChange={(e) => { setTrade(e.target.value); setTask(""); setQ("");
                             setDealTouched(false); setDealPick(""); setLineTouched(false); setLinePick(""); }}>
          <option value="" disabled>Choose the trade this cost belongs to…</option>
          {onJob.length > 0 && (
            <optgroup label="On this job">
              {onJob.map(([key, n]) => (
                <option key={key} value={key}>
                  {key === NONE ? "No trade recorded" : key} · {n} open
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Add another trade to this job">
            {trades.filter((x) => !onJob.some(([k]) => k === x)).map((x) => (
              <option key={x} value={x}>{x}</option>
            ))}
          </optgroup>
        </select>
        <span className="hint">
          {trade === "" ? "It decides which tasks, which contracts and which budget lines you are offered below."
            : inTrade.length === 0
              ? <>Nothing is open under <strong>{trade === NONE ? "no trade" : trade}</strong> yet — add the task below and the trade joins this job with it.</>
              : <>{inTrade.length} open {inTrade.length === 1 ? "task" : "tasks"} under {trade === NONE ? "no trade" : <strong>{trade}</strong>}.</>}
        </span>
      </label>

      {/* ── b. WHICH TASK ── */}
      {trade !== "" && (
        <label className="field">
          <span className="field-label">Which task <span className="req">required</span></span>
          {inTrade.length > 8 && (
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="A word from the task or its contract…" aria-label="Find the task"
              style={{ marginBottom: 6 }} />
          )}
          <select className="input" value={task} required onChange={(e) => {
            setTask(e.target.value); setDealTouched(false); setDealPick(""); }}
            size={shown.length > 1 && shown.length <= 8 ? Math.max(3, shown.length + 1) : undefined}>
            <option value="" disabled>
              {inTrade.length === 0 ? "Nothing open under this trade — add one below"
                : shown.length === 0 ? "Nothing matches — try another word"
                : `Choose the task this belongs to… (${shown.length})`}
            </option>
            {shown.map((c) => (
              <option key={c.id} value={c.id}>
                {c.action}
                {c.owed > 0 ? ` — ${money(c.owed)} to pay` : ""}
                {` · ${c.project}`}
                {c.due ? ` · due ${shortDay(c.due)}` : ""}
              </option>
            ))}
          </select>
          <span className="hint">
            Anything already outstanding is at the top. A payment is filed against a task, because
            that is where anybody looks for it afterwards.
          </span>
          <AddTask projectId={projectId} trade={trade === NONE ? null : trade}
            onMade={(row) => { setMade((m) => [row, ...m]); setTask(row.id); }} />
        </label>
      )}

      {/* ── c. WHICH CONTRACT ── */}
      {picked && (
        <label className="field">
          <span className="field-label">Which contract</span>
          <select className="input" value={deal}
            onChange={(e) => { setDealTouched(true); setDealPick(e.target.value); }}>
            <option value="">Not under a contract</option>
            {tradeDeals.map((x) => (
              <option key={x.contract_id} value={x.contract_id}>
                {x.title ?? "Untitled contract"}{x.party ? ` · ${x.party}` : ""}
                {x.contract_id === picked.contract_id ? " — on this task" : ""}
              </option>
            ))}
          </select>
          <span className="hint">
            {d
              ? <>Counts against <strong>{d.title ?? "this contract"}</strong>{d.party ? <> — paid to {d.party}</> : null}. The money below is filled from it; change it if this one is different.</>
              : tradeDeals.length === 0
                ? <>Nothing is signed under this trade yet. The payment still lands on the task and the budget line.</>
                : <>Leave it off and the money lands on the task and the budget line, but no contract balance moves.</>}
          </span>
        </label>
      )}

      {/* WHERE IT LANDS, under the trade that chose it. */}
      {picked && (
        <label className="field">
          <span className="field-label">
            Budget line{matching.length === 1 ? "" : <> <span className="req">required</span></>}
          </span>
          <select className="input" value={line}
            onChange={(e) => { setLineTouched(true); setLinePick(e.target.value); }}>
            <option value="">Choose a budget line…</option>
            {linesHere.map((b) => (
              <option key={b.id} value={b.id}>{b.phase ? `${b.phase} · ` : ""}{b.category}</option>
            ))}
          </select>
          <span className="hint">
            {matching.length === 1
              ? <>Only one budget line answers to {t}, so that is where this lands.</>
              : matching.length > 1
                ? <>The {matching.length} lines under {t}. This is what makes the money show as spend — leave it blank and no budget moves.</>
                : <>No budget line is named after {t ?? "this work"}, so the whole list is here. Leave it blank and no budget moves.</>}
          </span>
        </label>
      )}

      {/* The gate's amount rides in on the FIRST render (its own key), so
          picking a task afterwards still applies that contract's payee and
          account without wiping the number you came here to pay. */}
      <PaymentBox projectId={projectId} methods={methods} accounts={accounts} people={people}
        defaults={{ payee: d?.party ?? null, account: d?.account ?? null, method: d?.method ?? null,
          amount: picked ? null : startAmount }}
        defaultsKey={`${deal}|${startAmount ?? ""}`} />
    </>
  );
}

/**
 * ADDING THE TASK FROM HERE. Shahar: "allow to add a task if needed."
 *
 * The receipt exists whether or not anybody wrote the task down first, and
 * sending somebody to another screen to create one is how a payment ends up
 * filed against the nearest wrong thing. A name is all it takes; everything
 * else about the task can be filled in later, and the payment about to be
 * logged gives it its cost.
 *
 * IT ALSO ADDS THE TRADE. portal_task_create carries p_trade, and
 * trg_actions_trade_joins_project puts that trade on the job the moment the
 * task lands - so "allow to add a trade if needed" needs no separate button.
 */
function AddTask({ projectId, trade, onMade }: {
  projectId: string; trade: string | null;
  onMade: (row: PayChoice) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    if (!name.trim()) return;
    setBusy(true); setErr("");
    const { data, error } = await createClient().rpc("portal_task_create", {
      p_project: projectId,
      p_action: name.trim(),
      p_trade: trade,
    });
    setBusy(false);
    if (error) { setErr(friendly(error.message)); return; }
    if (!data?.ok) { setErr(data?.reason ?? "That task was not added."); return; }
    onMade({
      id: data.id as string, action: name.trim(), project_id: projectId,
      project: "This job", owed: 0, due: null, contract_id: null, contract: null, trade,
    });
    setName(""); setOpen(false);
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-ghost small"
        style={{ alignSelf: "flex-start", padding: "4px 0" }}
        onClick={() => { setOpen(true); setErr(""); }}>
        ＋ The task is not on the list
      </button>
    );
  }

  return (
    <div className="card pad stack" style={{ gap: 8, marginTop: 6 }}>
      <div className="between">
        <span className="small" style={{ fontWeight: 700 }}>
          Add a task{trade ? ` under ${trade}` : ""}
        </span>
        <button type="button" className="btn btn-ghost small" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      <input className="input" placeholder="What the money was for — Framing labour, week 3"
        value={name} maxLength={300}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void save(); } }} />
      <p className="tiny text-muted" style={{ margin: 0 }}>
        A name is enough. It lands on the board under {trade ?? "no trade"}, and this payment is
        filed against it{trade ? " — which also puts the trade on this job if it was not there" : ""}.
      </p>
      {err && <p className="tiny" style={{ color: "var(--color-danger)", margin: 0 }}>{err}</p>}
      {/* type=button throughout: this panel sits inside the payment form and
          must never submit it. */}
      <button type="button" className="btn btn-secondary" disabled={busy || !name.trim()}
        onClick={() => { void save(); }}>
        {busy ? "Adding…" : "Add it and use it"}
      </button>
    </div>
  );
}
