"use client";

import { useState } from "react";
import { createClient } from "@shared/supabase/client";
import { friendly } from "@shared/rpc";
import { Evidence, type Attached } from "@shared/Evidence";
import { ParentPicker } from "./ParentPicker";

// The database's vocabulary, not this screen's (rulebook 15).
const PRIORITIES = ["Missing", "No Priority", "Low", "Medium", "High"] as const;

// The seats somebody added from here can be given. Short on purpose: these
// are the five you actually hand out standing on a site. Every one of them is
// a row in project_roles, and portal_project_person_add refuses any seat
// above your own whatever this list says.
const SEATS = [
  { role: "contractor", label: "Contractor" },
  { role: "sub-contractor", label: "Sub-contractor" },
  { role: "site project manager", label: "Site project manager" },
  { role: "site GC", label: "Site GC" },
  { role: "Supplier", label: "Supplier" },
  { role: "viewer", label: "Viewer — can see, cannot change" },
] as const;

// The line between the people who RUN a job and the people who DO the work.
// It is project_roles.authority_rank: site PM is 50, contractor 30.
const RUNS = 50;
// Only so a person added here lands in the right half of the select without a
// round trip. The database is still the authority on every rank.
const SEAT_RANK: Record<string, number> = {
  "site GC": 60, "site project manager": 50, "contractor": 30, "sub-contractor": 10,
  "Supplier": 0, "viewer": 0,
};

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
export function NewTaskForm({ projectId, types, people, payees, trades, contracts, openTasks, defaultParent = null }: {
  projectId: string | null;
  types: TaskType[];
  people: { contact_id: string; name: string; seat: string | null; rank: number }[];
  // Who can be paid on this job: the people on it PLUS everyone already paid
  // here, because a supplier is almost never a member (migration 099).
  payees: { contact_id: string; name: string }[];
  trades: string[];
  contracts: { id: string; label: string }[];
  // Everything still open on this site, for "part of". Shipped whole so the
  // search box can filter without a round trip per keystroke.
  openTasks: { id: string; label: string }[];
  // Set when this was opened from inside a task ("Add a step under this one").
  defaultParent?: string | null;
}) {
  const [type, setType] = useState("");
  const [delivers, setDelivers] = useState<"work" | "product">("work");
  const [name, setName] = useState("");
  const [files, setFiles] = useState<Attached[]>([]);
  // The people list is state now, because a person added from this screen has
  // to appear in the select without a reload - a reload would take the
  // half-written task with it.
  const [crew, setCrew] = useState(people);
  const [assignee, setAssignee] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [addErr, setAddErr] = useState("");
  const [who, setWho] = useState({ name: "", company: "", email: "", phone: "", role: "contractor" as string });

  const running = crew.filter((p) => p.rank >= RUNS);
  const doing = crew.filter((p) => p.rank < RUNS);

  async function addPerson() {
    if (!projectId || !who.name.trim()) return;
    setBusy(true); setAddErr("");
    const supabase = createClient();
    const { data, error } = await supabase.rpc("portal_project_person_add", {
      p_project: projectId, p_name: who.name.trim(), p_role: who.role,
      p_company: who.company.trim() || null,
      p_email: who.email.trim() || null, p_phone: who.phone.trim() || null,
    });
    setBusy(false);
    if (error) { setAddErr(friendly(error.message)); return; }
    if (!data?.ok) { setAddErr(data?.reason ?? "They were not added."); return; }
    const rank = SEAT_RANK[who.role] ?? 0;
    const row = { contact_id: data.contact_id as string, name: (data.name as string) ?? who.name.trim(),
                  seat: (data.seat as string) ?? who.role, rank };
    setCrew((list) => list.some((p) => p.contact_id === row.contact_id)
      ? list
      : [...list, row].sort((a, b) => b.rank - a.rank || a.name.localeCompare(b.name)));
    setAssignee(row.contact_id);
    setAdding(false);
    setWho({ name: "", company: "", email: "", phone: "", role: "contractor" });
  }

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
        {/* Say what is about to happen before it happens. A task that
            silently grows four children is a surprise; one that says it will
            is a decision. */}
        {type === "build" && (
          <p className="hint" style={{ fontWeight: 600 }}>
            Four steps come with it: define the scope, contractor selection, legal and insurance,
            punch list and inspection.
          </p>
        )}
      </div>

      {/* Only the kind that carries money asks about money. The database
          agrees: fn_actions_money_fits_type clears a price off a kind that
          does not take one, so a stale number cannot survive a change of
          mind here. */}
      {money && (
        <>
          {/* STACKED, not side by side. Shahar (2026-09-14): "list target cost
              and pay to one above the other with a place to add $ and select
              pay to from drop down list." Side by side, a payee's name had
              half a phone to sit in and every one of them was truncated. */}
          <label className="field">
            <span className="field-label">Target cost</span>
            <span className="input-money">
              <span className="input-money-mark" aria-hidden>$</span>
              <input className="input" name="target_cost" inputMode="decimal" placeholder="4,200" />
            </span>
            <span className="hint">What you expect it to cost — not what has been paid.</span>
          </label>
          <label className="field">
            <span className="field-label">Pay to</span>
            <select className="input" name="pay_to_contact" defaultValue="">
              <option value="">— not set —</option>
              {payees.map((p) => <option key={p.contact_id} value={p.contact_id}>{p.name}</option>)}
            </select>
            <span className="hint">
              Everyone on this job, plus everyone already paid on it. Somebody new goes in the
              first time you pay them.
            </span>
          </label>
          {/* The trade belongs to the money kind because that is where it
              earns its keep: it is how the spend lands under Framing on the
              project screen rather than under the owner. */}
          <label className="field">
            <span className="field-label">Trade</span>
            <select className="input" name="trade" defaultValue="">
              <option value="">— not set —</option>
              {trades.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <span className="hint">
              Which trade this sits under on the board. Left unset, it is taken from the contract,
              the scope line, or whoever holds it.
            </span>
          </label>
        </>
      )}

      {/* WHO HOLDS IT, IN THE ORDER YOU WOULD SAY THEM. Shahar (2026-09-15):
          "sort assigned to drop down: first, list the PM, GC, Owner. then,
          list the rest of the assigned contractors."

          The split is at authority rank 50, which is the line between the
          people who RUN the job and the people who DO the work - and it is
          the database's own ladder (project_roles.authority_rank), handed
          over by portal_compose_targets since migration 131, not a list of
          role names kept in here to drift. Two optgroups rather than one long
          list, because the grouping is the point. */}
      <div className="field">
        <span className="field-label">Assigned to <span className="text-muted">(optional)</span></span>
        <select className="input" name="assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">Nobody yet</option>
          {running.length > 0 && (
            <optgroup label="Running this job">
              {running.map((p) => (
                <option key={p.contact_id} value={p.contact_id}>{p.name}{p.seat ? ` · ${p.seat}` : ""}</option>
              ))}
            </optgroup>
          )}
          {doing.length > 0 && (
            <optgroup label="On the job">
              {doing.map((p) => (
                <option key={p.contact_id} value={p.contact_id}>{p.name}{p.seat ? ` · ${p.seat}` : ""}</option>
              ))}
            </optgroup>
          )}
        </select>
        {/* SOMEBODY WHO IS NOT ON THE LIST. "add an option to add new assigned
            to / will require to create a contact - or company if does not
            exist." It happens HERE rather than on a screen of its own,
            because navigating away from a half-written task to make a contact
            and coming back to an empty form is how a two-line note becomes a
            thing you do not bother with. */}
        {projectId && !adding && (
          <button type="button" className="btn btn-ghost small" style={{ alignSelf: "flex-start", padding: "4px 0" }}
            onClick={() => { setAdding(true); setAddErr(""); }}>
            ＋ Somebody who is not on this list
          </button>
        )}
        {projectId && adding && (
          <div className="card pad stack" style={{ gap: 8, marginTop: 6 }}>
            <div className="between">
              <span className="small" style={{ fontWeight: 700 }}>Add them to this job</span>
              <button type="button" className="btn btn-ghost small" onClick={() => setAdding(false)}>Cancel</button>
            </div>
            <input className="input" placeholder="Their name" value={who.name}
              onChange={(e) => setWho({ ...who, name: e.target.value })} />
            <input className="input" placeholder="Company (optional)" value={who.company}
              onChange={(e) => setWho({ ...who, company: e.target.value })} />
            <div className="row" style={{ gap: 8 }}>
              <input className="input grow" style={{ minWidth: 0 }} placeholder="Email (optional)" inputMode="email"
                value={who.email} onChange={(e) => setWho({ ...who, email: e.target.value })} />
              <input className="input grow" style={{ minWidth: 0 }} placeholder="Phone (optional)" inputMode="tel"
                value={who.phone} onChange={(e) => setWho({ ...who, phone: e.target.value })} />
            </div>
            <select className="input" value={who.role} onChange={(e) => setWho({ ...who, role: e.target.value })}>
              {SEATS.map((s) => <option key={s.role} value={s.role}>{s.label}</option>)}
            </select>
            <p className="tiny text-muted" style={{ margin: 0 }}>
              An email or a phone number is what stops the same person being written down twice. Neither is
              required, and neither sends them anything — this only puts them on the job.
            </p>
            {addErr && <p className="tiny" style={{ color: "var(--color-danger)", margin: 0 }}>{addErr}</p>}
            <button type="button" className="btn btn-secondary" disabled={busy || !who.name.trim()}
              onClick={() => { void addPerson(); }}>
              {busy ? "Adding…" : "Add and assign"}
            </button>
          </div>
        )}
      </div>

      <div className="row" style={{ gap: 8 }}>
        <label className="field grow">
          <span className="field-label">Completion target</span>
          <input className="input" name="target_date" type="date" />
        </label>
        <label className="field grow">
          <span className="field-label">Priority</span>
          <select className="input" name="priority" defaultValue="Missing">
            {PRIORITIES.map((p) => <option key={p} value={p}>{p === "Missing" ? "Not set" : p}</option>)}
          </select>
        </label>
      </div>

      {/* PART OF, with a search - because on this job the list is 129 long
          (Shahar, 2026-09-14). Its own component: the filtering is the whole
          point and it cannot be done on the server. */}
      <ParentPicker tasks={openTasks} defaultParent={defaultParent} />

      {/* THE TWO GATES. Both already exist and are already enforced - by
          portal_close_task and by close_action - and until now nothing in
          either app could set either of them. */}
      <label className="row small" style={{ gap: 8, alignItems: "flex-start" }}>
        <input type="checkbox" name="requires_photo" value="1" style={{ marginTop: 3 }} />
        <span>
          Needs photographs to close
          <span className="text-muted"> — before and after, on the record, or it will not complete.</span>
        </span>
      </label>
      <label className="row small" style={{ gap: 8, alignItems: "flex-start" }}>
        <input type="checkbox" name="is_gate" value="1" style={{ marginTop: 3 }} />
        <span>
          Blocks whatever it is part of
          <span className="text-muted"> — the parent task cannot close while this one is open.</span>
        </span>
      </label>

      {contracts.length > 0 && (
        <label className="field">
          <span className="field-label">Part of a contract <span className="text-muted">(optional)</span></span>
          <select className="input" name="contract" defaultValue="">
            <option value="">Not under a contract</option>
            {contracts.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          <span className="hint">Ties the task to what was agreed, so it counts against that contract.</span>
        </label>
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
