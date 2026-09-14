"use client";

import { useState } from "react";
import { Evidence, type Attached } from "@shared/Evidence";

export type TaskType = {
  action_type: string;
  label: string;
  description: string | null;
  needs_money: boolean;
};

// WRITING A NEW TASK.
//
// Shahar (2026-09-14): "i need to be able to log a new task. new task will
// have: task name, work / product, desciption, attachments (camera, voice,
// file), type: financial transaction (target cost, pay to), visual inspection,
// backoffice, other."
//
// Client-side for two reasons and no others: the type picker decides whether
// the money questions exist at all, and the attachments upload as you go so
// nothing is waiting on Save. Everything else is a plain form posting to a
// server action, and every rule is portal_task_create's.
export function NewTaskForm({ projectId, types, people }: {
  projectId: string | null;
  types: TaskType[];
  people: { contact_id: string; name: string }[];
}) {
  const [type, setType] = useState("");
  const [delivers, setDelivers] = useState<"work" | "product">("work");
  const [name, setName] = useState("");
  const [files, setFiles] = useState<Attached[]>([]);

  const chosen = types.find((t) => t.action_type === type) ?? null;
  // The money questions belong to the KIND, not to this component's opinion
  // of which kind. action_types.needs_money is the flag; a new kind that
  // costs money is a row in that table, not an edit here.
  const money = !!chosen?.needs_money;
  const ready = name.trim().length > 0;

  return (
    <>
      <input type="hidden" name="file_ids" value={files.map((f) => f.id).join(",")} />

      <label className="field">
        <span className="field-label">What has to happen</span>
        <input className="input" name="action" value={name} onChange={(e) => setName(e.target.value)}
          required maxLength={300} autoFocus
          placeholder="Order the LVL beam · Book the framing inspection · Chase the COI" />
      </label>

      {/* WORK OR A PRODUCT. Not decoration: it decides what done looks like.
          Work finishes when somebody has done it and it passes; a product
          finishes when it is on site. */}
      <div className="field">
        <span className="field-label">Is it work, or a product?</span>
        <div className="seg" role="radiogroup" aria-label="Work or a product">
          <label className="seg-opt">
            <input type="radio" name="delivers" value="work" checked={delivers === "work"}
              onChange={() => setDelivers("work")} />
            <span>Work</span>
          </label>
          <label className="seg-opt">
            <input type="radio" name="delivers" value="product" checked={delivers === "product"}
              onChange={() => setDelivers("product")} />
            <span>Product</span>
          </label>
        </div>
        <p className="hint">
          {delivers === "work"
            ? "Somebody does something. It is done when the work is done and checked."
            : "Something arrives. It is done when it is on site."}
        </p>
      </div>

      <label className="field">
        <span className="field-label">Description <span className="text-muted">(optional)</span></span>
        <textarea className="input" name="description" rows={3}
          placeholder="What it covers, what it depends on, anything the next person needs to know." />
      </label>

      <div className="field">
        <span className="field-label">What kind of task</span>
        <select className="input" name="type" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">— not set —</option>
          {types.map((t) => <option key={t.action_type} value={t.action_type}>{t.label}</option>)}
        </select>
        {chosen?.description && <p className="hint">{chosen.description}</p>}
      </div>

      {/* Only the kind that carries money asks about money. The database
          agrees: fn_actions_money_fits_type clears a price off a kind that
          does not take one, so a stale number cannot survive a change of
          mind here. */}
      {money && (
        <div className="row" style={{ gap: 8 }}>
          <label className="field grow">
            <span className="field-label">Target cost ($)</span>
            <input className="input" name="target_cost" inputMode="decimal" placeholder="4200" />
            <span className="hint">What you expect it to cost — not what has been paid.</span>
          </label>
          <label className="field grow">
            <span className="field-label">Pay to</span>
            <input className="input" name="pay_to" list="new-task-payees" autoComplete="off"
              placeholder="Kuiken Brothers" />
            <datalist id="new-task-payees">
              {people.map((p) => <option key={p.contact_id} value={p.name} />)}
            </datalist>
          </label>
        </div>
      )}

      {/* A div, not a label: Evidence carries buttons, and a click on a
          button inside a label goes to the label's control. */}
      {projectId && (
        <div className="field">
          <span className="field-label">Attach <span className="text-muted">(optional)</span></span>
          <Evidence projectId={projectId} caption="New task" onChange={setFiles} />
          <span className="hint">A photo, a recording, the quote, the drawing — whatever says what this is.</span>
        </div>
      )}

      <button className="btn btn-primary btn-block" disabled={!ready}>
        {ready ? "Add this task" : "Name the task first"}
      </button>
    </>
  );
}
