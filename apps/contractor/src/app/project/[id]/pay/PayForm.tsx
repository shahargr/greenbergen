"use client";

import { useMemo, useState } from "react";
import { PaymentBox, type Method } from "../../../task/[id]/PaymentBox";

// FIND THE TASK IN TWO MOVES, THEN PAY IT.
//
// Shahar (2026-09-17), on one select of 145 open tasks: "the task list
// should be a/ project based, and b/ task based. one list for all is not
// possible to search. maybe search box? make this possible for me as a user
// to find the task in two clicks if needed."
//
// So: WHICH JOB (one select, only the jobs with something open; gone when
// there is only one), then WHICH TASK on it, with a search box that narrows
// the list as you type. Two taps on a phone, or one word at a desk. What is
// owed still sorts to the top within a job.
//
// AND THE CONTRACT FILLS THE MONEY. "If this is part of a contract, you can
// pull the right source and target automatically?" Choosing a task that has
// a contract hands the payment box the contract's party as To, the account
// the last payment on it left from as From, and the rail it went on. Both
// slots stay editable; they are filled, not fixed.
export type PayChoice = {
  id: string; action: string; project_id: string; project: string;
  owed: number; due: string | null; contract_id: string | null; contract: string | null;
};
export type ContractDefault = {
  contract_id: string; title: string | null; trade: string | null;
  party: string | null; account: string | null; method: string | null;
};

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;
const shortDay = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function PayForm({ projectId, choices, defaults, methods, accounts, people, defaultTask, startAmount = null }: {
  projectId: string;
  /** Arrived from a payment gate that already knows what it is worth (190). */
  choices: PayChoice[];
  defaults: ContractDefault[];
  methods: Method[];
  accounts: string[];
  people: { contact_id: string; name: string }[];
  defaultTask: string | null;
  startAmount?: string | null;
}) {
  // The jobs that have something open, in the order they first appear
  // (owed first, so the busiest job leads).
  const jobs = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of choices) if (!seen.has(c.project_id)) seen.set(c.project_id, c.project);
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [choices]);

  const preset = defaultTask ? choices.find((c) => c.id === defaultTask) ?? null : null;
  const [job, setJob] = useState(preset?.project_id ?? (jobs.length === 1 ? jobs[0]!.id : ""));
  const [q, setQ] = useState("");
  const [task, setTask] = useState(preset?.id ?? "");

  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const onJob = choices.filter((c) => !job || c.project_id === job);
  const shown = onJob.filter((c) => words.every((w) =>
    c.action.toLowerCase().includes(w) || (c.contract ?? "").toLowerCase().includes(w)));

  const picked = choices.find((c) => c.id === task) ?? null;
  const d = picked?.contract_id ? defaults.find((x) => x.contract_id === picked.contract_id) ?? null : null;

  return (
    <>
      <input type="hidden" name="action_id" value={task} />

      {jobs.length > 1 && (
        <label className="field">
          <span className="field-label">Which job</span>
          <select className="input" value={job}
            onChange={(e) => { setJob(e.target.value); setTask(""); }}>
            <option value="">Every job on this site ({choices.length} open tasks)</option>
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name} · {choices.filter((c) => c.project_id === j.id).length} open
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="field">
        <span className="field-label">Which task</span>
        {onJob.length > 8 && (
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="A word from the task or its contract…" aria-label="Find the task"
            style={{ marginBottom: 6 }} />
        )}
        <select className="input" value={task} required onChange={(e) => setTask(e.target.value)}
          size={shown.length > 1 && shown.length <= 8 ? Math.max(3, shown.length + 1) : undefined}>
          <option value="" disabled>
            {shown.length === 0 ? "Nothing matches — try another word" : `Choose the task this belongs to… (${shown.length})`}
          </option>
          {shown.map((c) => (
            <option key={c.id} value={c.id}>
              {c.action}
              {c.owed > 0 ? ` — ${money(c.owed)} to pay` : ""}
              {!job && jobs.length > 1 ? ` · ${c.project}` : ""}
              {c.due ? ` · due ${shortDay(c.due)}` : ""}
            </option>
          ))}
        </select>
        <span className="hint">
          {picked
            ? d
              ? <>On <strong>{picked.contract ?? d.title}</strong>{d.party ? <> — paid to {d.party}</> : null}. The money is filled from the contract; change it if this one is different.</>
              : <>No contract on this task. Say who you paid and from where.</>
            : <>Anything already outstanding is at the top. Nothing here fits? Open the job and add the task first — a payment with no task is a payment nobody can find again.</>}
        </span>
      </label>

      {/* The gate's amount rides in on the FIRST render (its own key), so
          picking a task afterwards still applies that contract's payee and
          account without wiping the number you came here to pay. */}
      <PaymentBox projectId={projectId} methods={methods} accounts={accounts} people={people}
        defaults={{ payee: d?.party ?? null, account: d?.account ?? null, method: d?.method ?? null,
          amount: picked ? null : startAmount }}
        defaultsKey={`${picked?.contract_id ?? ""}|${startAmount ?? ""}`} />
    </>
  );
}
