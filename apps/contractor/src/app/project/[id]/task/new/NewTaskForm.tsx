"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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

type Contract = { id: string; label: string };

// WRITING A NEW TASK, IN THREE PASSES.
//
// Shahar (2026-09-15): "on task creation - image comes next. so change this to
// a step by step, where first step saves some info. needs to be a total of 3
// steps."
//
// It was one form fourteen fields long with the camera at the bottom, which
// is backwards for the way it actually gets used: you are standing in front
// of the thing, you photograph it, and everything else is typed later. And
// nothing existed until Save, so a phone call halfway through lost the lot.
//
//   1. WHAT IT IS       - and this one SAVES. From here on there is a real
//                         task with a real id and nothing can be lost.
//   2. WHO AND WHEN     - the holder, the date, what it is part of, what it
//                         is agreed under.
//   3. THE PICTURES     - attached to something that exists, rather than
//                         carried along in a hidden field.
//
// Every pass after the first is a patch, so stopping at any of them leaves a
// task that is correct as far as it goes - which is why there is no Skip on
// pass two (Shahar, 2026-09-15: "Remove the skip to the picture option"). Save
// and carry on is the only way forward, and it costs nothing when there is
// nothing to save: closing the app is the skip.
export function NewTaskForm({
  projectId, back, types, people, payees, trades, contracts, openTasks,
  defaultParent = null, defaultTrade = null,
}: {
  projectId: string | null;
  /** Where Done goes when the person would rather not open the task. */
  back: string;
  types: TaskType[];
  people: { contact_id: string; name: string; seat: string | null; rank: number }[];
  // Who can be paid on this job: the people on it PLUS everyone already paid
  // here, because a supplier is almost never a member (migration 099).
  payees: { contact_id: string; name: string }[];
  trades: string[];
  contracts: Contract[];
  // Everything still open on this site, for "part of". Shipped whole so the
  // search box can filter without a round trip per keystroke.
  openTasks: { id: string; label: string }[];
  // Set when this was opened from inside a task ("Add a step under this one").
  defaultParent?: string | null;
  // Set when this was opened from a trade's own screen. The task is filed
  // under that trade without being asked - you were looking at Framing, so
  // the thing you just thought of is a Framing task.
  defaultTrade?: string | null;
}) {
  const router = useRouter();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Pass one.
  const [name, setName] = useState("");
  const [delivers, setDelivers] = useState<"work" | "product">("work");
  const [description, setDescription] = useState("");
  const [type, setType] = useState("");
  const [trade, setTrade] = useState(defaultTrade ?? "");
  const [cost, setCost] = useState("");
  const [payTo, setPayTo] = useState("");

  // Pass two.
  const [crew, setCrew] = useState(people);
  const [assignee, setAssignee] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState<string>("Missing");
  const [parent, setParent] = useState(defaultParent ?? "");
  const [savedParent, setSavedParent] = useState(defaultParent ?? "");
  const [needsPhoto, setNeedsPhoto] = useState(false);
  const [gate, setGate] = useState(false);
  const [deals, setDeals] = useState<Contract[]>(contracts);
  const [contract, setContract] = useState("");

  // Pass three.
  const [files, setFiles] = useState<Attached[]>([]);

  // Adding somebody who is not on the job yet.
  const [adding, setAdding] = useState(false);
  const [addErr, setAddErr] = useState("");
  const [who, setWho] = useState({ name: "", company: "", email: "", phone: "", role: "contractor" as string });

  // Making a contract that does not exist yet.
  const [shelling, setShelling] = useState(false);
  const [shellErr, setShellErr] = useState("");
  const [shell, setShell] = useState({ who: "", company: "" });
  // "This work really is not under a contract" - said by cancelling the
  // panel, and remembered, so the button stops offering to make one.
  const [noDeal, setNoDeal] = useState(false);

  const chosen = types.find((t) => t.action_type === type) ?? null;
  // The money questions belong to the KIND, not to this component's opinion
  // of which kind. action_types.needs_money is the flag; a new kind that
  // costs money is a row in that table, not an edit here.
  const money = !!chosen?.needs_money;
  const ready = name.trim().length > 0;

  // Nothing agreed and nobody has said there will not be: the button offers
  // to make the shell rather than pretending the question was answered.
  const offerDeal = !!projectId && !contract && !noDeal;

  const running = crew.filter((p) => p.rank >= RUNS);
  const doing = crew.filter((p) => p.rank < RUNS);

  const num = (s: string) => {
    const n = Number(s.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  // ---- pass one: create ---------------------------------------------------
  async function savePassOne() {
    if (!projectId || !ready) return;
    setBusy(true); setErr("");
    const supabase = createClient();
    const { data, error } = await supabase.rpc("portal_task_create", {
      p_project: projectId,
      p_action: name.trim(),
      p_type: type || null,
      p_delivers: delivers,
      p_description: description.trim() || null,
      p_target_cost: money ? num(cost) : null,
      p_pay_to_contact: money ? (payTo || null) : null,
      // NOT gated on the money kind. A trade is how the work is filed, not
      // a detail of its price, and a task opened from a trade's screen is
      // filed under it whatever kind it turns out to be.
      p_trade: trade || null,
      p_parent: parent || null,
    });
    setBusy(false);
    if (error) { setErr(friendly(error.message)); return; }
    if (!data?.ok) { setErr(data?.reason ?? "The task was not added."); return; }
    setTaskId(data.id as string);
    setSavedParent(parent);
    setStep(2);
  }

  // ---- pass two: patch ----------------------------------------------------
  async function savePassTwo() {
    if (!taskId) return;
    // THE SHELL CONTRACT IS PART OF THIS SAVE. An open panel with nobody named
    // is not silently ignored - that would lose a decision somebody was in the
    // middle of making. Cancel is how you close it without one.
    let deal = contract;
    if (shelling) {
      // NOT KNOWING WHO IT IS WITH IS THE POINT. Shahar (2026-09-15): "the
      // whole idea is to create a contract with target for transaction as
      // place holder as we don't know them yet." So an empty panel is a
      // complete answer - the contract is made against the WORK, and the
      // party is filled in when there is one (migration 135).
      setBusy(true); setErr(""); setShellErr("");
      const made = await makeShell();
      if (!made) { setBusy(false); return; }
      deal = made;
    }
    setBusy(true); setErr("");
    const supabase = createClient();
    // The parent FIRST, because "blocks whatever it is part of" is refused
    // outright when there is nothing to be part of.
    if (parent !== savedParent) {
      const { data, error } = await supabase.rpc("portal_task_link", {
        p_action: taskId, p_rel: "parent", p_other: parent || null,
      });
      if (error) { setBusy(false); setErr(friendly(error.message)); return; }
      if (!data?.ok) { setBusy(false); setErr(data?.reason ?? "That could not be filed under the other task."); return; }
      setSavedParent(parent);
    }
    const { data, error } = await supabase.rpc("portal_task_edit", {
      p_action_id: taskId,
      p_patch: {
        assignee: assignee || null,
        target_date: due || null,
        priority,
        contract: deal || null,
        requires_photo: needsPhoto,
        is_gate: gate,
      },
    });
    setBusy(false);
    if (error) { setErr(friendly(error.message)); return; }
    if (!data?.ok) { setErr(data?.reason ?? "That did not save."); return; }
    setStep(3);
  }

  // ---- pass three: attach -------------------------------------------------
  async function finish(open: boolean) {
    if (!taskId) return;
    setBusy(true); setErr("");
    if (files.length > 0) {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("portal_task_attach", {
        p_action_id: taskId, p_file_ids: files.map((f) => f.id),
      });
      if (error) { setBusy(false); setErr(friendly(error.message)); return; }
      if (!data?.ok) { setBusy(false); setErr(data?.reason ?? "Those did not attach."); return; }
    }
    router.push(open ? `/task/${taskId}?back=${encodeURIComponent(back)}` : back);
  }

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

  // A CONTRACT THAT DOES NOT EXIST YET. Shahar (2026-09-15): "if no contract
  // can be attached, you need to enable me create a shell contract that will
  // be used later but referenced already from the start" - and then: "If
  // selecting someone not on the job yet, the save and carry on should create
  // a new contract."
  //
  // So there is no button of its own any more. Filling the panel in IS the
  // decision; Save and carry on makes the contract and ties this task to it in
  // the same breath, which is one press instead of two for something nobody
  // would fill in and then not want.
  //
  // It carries the target cost from pass one rather than asking again ("you
  // already have budget from previously"). A shell contract's value is what
  // you expect to spend on the work it covers, and that number has already
  // been typed once on this screen.
  async function makeShell(): Promise<string | null> {
    if (!projectId) return null;
    const { data, error } = await createClient().rpc("portal_contract_shell", {
      p_project: projectId,
      // The work is what the contract is called until somebody is appointed:
      // a list of rows all named "(placeholder)" is a list nobody can use.
      p_title: shell.who || shell.company.trim() ? null : name.trim() || null,
      p_trade: trade || null,
      p_counterparty: shell.who || null,
      p_company_name: shell.who ? null : (shell.company.trim() || null),
      p_amount: money ? num(cost) : null,
    });
    if (error) { setShellErr(friendly(error.message)); return null; }
    if (!data?.ok) { setShellErr(data?.reason ?? "That contract was not made."); return null; }
    const row = { id: data.id as string, label: data.label as string };
    setDeals((list) => [row, ...list]);
    setContract(row.id);
    setShelling(false);
    setShell({ who: "", company: "" });
    return row.id;
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      {/* WHERE YOU ARE, AND WHAT IS ALREADY SAFE. After pass one the second
          line says the task exists - which is the whole reason the screen was
          split, so it has to be visible rather than implied. */}
      <ol className="passes" aria-label="Steps">
        {["What it is", "Who and when", "Pictures"].map((label, i) => {
          const n = (i + 1) as 1 | 2 | 3;
          return (
            <li key={label} className={n === step ? "on" : n < step ? "done" : ""}>
              <span className="n" aria-hidden>{n < step ? "✓" : n}</span>
              <span className="l">{label}</span>
            </li>
          );
        })}
      </ol>
      {taskId && step > 1 && (
        <p className="tiny text-muted" style={{ margin: 0 }}>
          Saved. <strong>{name.trim()}</strong> is on the board — everything from here is added to it, and
          you can stop whenever you like.
        </p>
      )}
      {err && <p className="small" style={{ color: "var(--color-danger)", margin: 0 }}>{err}</p>}

      {/* ================= 1. WHAT IT IS ================= */}
      {step === 1 && (
        <>
          {/* FILED WHERE YOU WERE STANDING. Opened from a trade's screen, the
              trade is already answered - saying so beats a pre-selected field
              buried behind the money questions, which is where the Trade
              select lives. */}
          {defaultTrade && (
            <p className="small" style={{ margin: 0 }}>
              Filed under <strong>{defaultTrade}</strong>.
            </p>
          )}

          <label className="field">
            <span className="field-label">What has to happen</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)}
              required maxLength={300} autoFocus
              placeholder="Order the LVL beam · Book the framing inspection · Chase the COI" />
          </label>

          {/* WORK OR A PRODUCT. Not decoration: it decides what done looks
              like. Work finishes when somebody has done it and it passes; a
              product finishes when it is on site. */}
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
            <textarea className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="What it covers, what it depends on, anything the next person needs to know." />
          </label>

          <div className="field">
            <span className="field-label">What kind of task</span>
            <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">— not set —</option>
              {types.map((t) => <option key={t.action_type} value={t.action_type}>{t.label}</option>)}
            </select>
            {chosen?.description && <p className="hint">{chosen.description}</p>}
            {/* Say what is about to happen before it happens. A task that
                silently grows four children is a surprise; one that says it
                will is a decision. */}
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
              {/* The trade leads on a Build, because it is what files the work
                  under Framing on the project screen rather than under the
                  owner - which is the whole reason the kind exists. */}
              <label className="field">
                <span className="field-label">Trade</span>
                <select className="input" value={trade} onChange={(e) => setTrade(e.target.value)}>
                  <option value="">— not set —</option>
                  {trades.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <span className="hint">
                  Which trade this sits under on the board. Left unset, it is taken from the contract,
                  the scope line, or whoever holds it.
                </span>
              </label>
              {/* STACKED, not side by side (Shahar, 2026-09-14): side by side,
                  a payee's name had half a phone to sit in. */}
              <label className="field">
                <span className="field-label">Target cost</span>
                <span className="input-money">
                  <span className="input-money-mark" aria-hidden>$</span>
                  <input className="input" inputMode="decimal" placeholder="4,200"
                    value={cost} onChange={(e) => setCost(e.target.value)} />
                </span>
                <span className="hint">What you expect it to cost — not what has been paid.</span>
              </label>
              <label className="field">
                <span className="field-label">Pay to</span>
                {/* "Not yet awarded" rather than "not set" (Shahar,
                    2026-09-15). Blank here is not an oversight - on a Build it
                    is the normal state, because you write the work down before
                    you know who is doing it. Saying so stops it reading as a
                    field you forgot. */}
                <select className="input" value={payTo} onChange={(e) => setPayTo(e.target.value)}>
                  <option value="">Not yet awarded</option>
                  {payees.map((p) => <option key={p.contact_id} value={p.contact_id}>{p.name}</option>)}
                </select>
                <span className="hint">
                  Everyone on this job, plus everyone already paid on it. Somebody new goes in the
                  first time you pay them.
                </span>
              </label>
            </>
          )}

          <button type="button" className="btn btn-primary btn-block" disabled={!ready || busy}
            onClick={() => { void savePassOne(); }}>
            {busy ? "Saving…" : ready ? "Save and carry on" : "Name the task first"}
          </button>
        </>
      )}

      {/* ================= 2. WHO AND WHEN ================= */}
      {step === 2 && (
        <>
          {/* WHO HOLDS IT, IN THE ORDER YOU WOULD SAY THEM. Shahar
              (2026-09-15): "first, list the PM, GC, Owner. then, list the rest
              of the assigned contractors." The split is at authority rank 50,
              the line between the people who RUN the job and the people who DO
              the work - the database's own ladder, handed over by
              portal_compose_targets, not a list of role names kept in here. */}
          <div className="field">
            <span className="field-label">Assigned to <span className="text-muted">(optional)</span></span>
            <select className="input" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
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
              <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </label>
            <label className="field grow">
              <span className="field-label">Priority</span>
              <select className="input" value={priority} onChange={(e) => setPriority(e.target.value)}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p === "Missing" ? "Not set" : p}</option>)}
              </select>
            </label>
          </div>

          <ParentPicker tasks={openTasks} value={parent} onPick={setParent} />

          {/* THE TWO GATES. Both already exist and are already enforced - by
              portal_close_task and by close_action - and until migration 132
              only creation could set them. */}
          <label className="row small" style={{ gap: 8, alignItems: "flex-start" }}>
            <input type="checkbox" checked={needsPhoto} onChange={(e) => setNeedsPhoto(e.target.checked)}
              style={{ marginTop: 3 }} />
            <span>
              Needs photographs to close
              <span className="text-muted"> — before and after, on the record, or it will not complete.</span>
            </span>
          </label>
          <label className="row small" style={{ gap: 8, alignItems: "flex-start" }}>
            <input type="checkbox" checked={gate} onChange={(e) => setGate(e.target.checked)}
              disabled={!parent} style={{ marginTop: 3 }} />
            <span>
              Blocks whatever it is part of
              <span className="text-muted">
                {parent
                  ? " — the parent task cannot close while this one is open."
                  : " — pick what it is part of first; there has to be something to block."}
              </span>
            </span>
          </label>

          <div className="field">
            <span className="field-label">Part of a contract <span className="text-muted">(optional)</span></span>
            <select className="input" value={contract}
              onChange={(e) => { setContract(e.target.value); if (e.target.value) { setShelling(false); setShellErr(""); } }}>
              <option value="">Not under a contract</option>
              {deals.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <span className="hint">
              {deals.length === 0
                ? "Nothing is signed on this job yet."
                : "Ties the task to what was agreed, so it counts against that contract."}
            </span>
            {/* The link that used to sit here has gone (Shahar, 2026-09-15:
                "no need to see + There is no contract yet"). The button at the
                foot of the pass says what it will do and opens this panel
                itself, so a second way in was one affordance too many. */}
            {projectId && shelling && (
              <div className="card pad stack" style={{ gap: 8, marginTop: 6 }}>
                <div className="between">
                  <span className="small" style={{ fontWeight: 700 }}>Start a shell contract</span>
                  {/* Cancel is also the answer to "this work really is not
                      under a contract" - it is remembered, so the button below
                      stops offering to make one and goes back to saving. */}
                  <button type="button" className="btn btn-ghost small"
                    onClick={() => { setShelling(false); setShellErr(""); setNoDeal(true); }}>
                    Cancel
                  </button>
                </div>
                <select className="input" value={shell.who} onChange={(e) => setShell({ ...shell, who: e.target.value })}>
                  <option value="">Not appointed yet</option>
                  {crew.map((p) => <option key={p.contact_id} value={p.contact_id}>{p.name}</option>)}
                </select>
                {!shell.who && (
                  <input className="input" placeholder="Or a company, if you know it" value={shell.company}
                    onChange={(e) => setShell({ ...shell, company: e.target.value })} />
                )}
                <p className="tiny text-muted" style={{ margin: 0 }}>
                  Leave it at <strong>Not appointed yet</strong> if you do not know — that is what a shell is for.
                  It is made against the work{money && num(cost) !== null ? ", and carries the target cost you already gave" : ""},
                  and whoever ends up doing it is written in later.
                </p>
                {shellErr && <p className="tiny" style={{ color: "var(--color-danger)", margin: 0 }}>{shellErr}</p>}
              </div>
            )}
          </div>

          {/* THE BUTTON SAYS WHAT THE NEXT PRESS DOES. Shahar (2026-09-15):
              "if not under contract, change the Save and carry on to Create
              contract and continue. otherwise, Save and carry on is good."

              So while nothing is agreed it offers to make the shell - opening
              the panel if it is shut, making the contract if it is filled in.
              Cancelling the panel is how you say the work really is not under
              one, and the button goes back to saving. */}
          <button type="button" className="btn btn-primary btn-block" disabled={busy}
            onClick={() => { if (offerDeal && !shelling) { setShelling(true); setShellErr(""); } else void savePassTwo(); }}>
            {busy ? "Saving…" : offerDeal ? "Create contract and continue" : "Save and carry on"}
          </button>
        </>
      )}

      {/* ================= 3. THE PICTURES ================= */}
      {step === 3 && projectId && (
        <>
          <div className="field">
            <span className="field-label">Attach</span>
            <Evidence projectId={projectId} caption={name.trim() || "New task"} onChange={setFiles} />
            <span className="hint">A photo, a recording, the quote, the drawing — whatever says what this is.</span>
          </div>

          <button type="button" className="btn btn-primary btn-block" disabled={busy}
            onClick={() => { void finish(true); }}>
            {busy ? "Finishing…" : files.length > 0 ? `Attach ${files.length} and open the task` : "Open the task"}
          </button>
          <button type="button" className="btn btn-ghost btn-block" disabled={busy}
            onClick={() => { void finish(false); }}>
            Done — back to the job
          </button>
        </>
      )}
    </div>
  );
}
