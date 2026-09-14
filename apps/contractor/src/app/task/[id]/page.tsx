import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";
import { shortDate } from "@shared/format";
import { stopwatch } from "@shared/perf";
import { AppBar, Card, LongText, Notice, Screen } from "@shared/ui";
import { saveTask, undoNote, editPayment, cancelTask, deleteTask } from "./actions";
import { NoteBox } from "./NoteBox";
import { PaymentBox, type Method } from "./PaymentBox";
import { ReceiptBox, type ReceiptFile } from "./ReceiptBox";
import { ChevronIcon } from "@shared/ui";
import type { Target } from "@shared/inbox/data";

export const dynamic = "force-dynamic";

// One task, opened from wherever you were, and returning there when you are
// done with it. portal_task_detail already carries the notes, the evidence,
// the assignee and the photo requirement, so this screen reads one function
// and posts to two - add_task_comment and portal_close_task.
type Detail = {
  id: string; action: string; status: string; priority: string | null;
  target_date: string | null; desired_outcome: string | null; notes: string | null;
  pending_on: string | null; pending_reason: string | null; pending_category: string | null;
  requires_photo_evidence: boolean | null;
  can_edit: boolean;
  created_at: string | null; created_by: string | null; last_updated: string | null;
  project_id: string | null; project: string | null;
  // The CONTACT the "Assigned to" select is bound to, and - display only -
  // whoever actually holds it, which may be an assistant (migration 080).
  // Reading only the contact is why a task Bobby holds read "unassigned"
  // here while the list beside it said Bobby.
  assignee: { id: string; name: string | null } | null;
  holder: { name: string | null; kind: "person" | "assistant" } | null;
  evidence: { id: string; file_name: string | null; kind: string | null; role: string | null }[];
  comments: { author: string | null; body: string | null; created_at: string | null }[];
  open_children: number;
  // What this task cost, and whether the person looking may add to it
  // (migration 065). Money follows the money ladder: a crew member reads
  // the work and never the cost, so both come back empty for them.
  can_log_payment: boolean;
  payments: Payment[];
  methods: Method[];
};

type Payment = {
  id: string; description: string | null; amount: number | null; paid_on: string | null;
  status: string; reference: string | null; from_account: string | null;
  method: string | null; paid_to: string | null; contract_id: string | null;
  // 'out' is a payment, 'in' is a credit or refund. Positive either way -
  // the sign lives here, not on the amount (migration 086).
  direction: "in" | "out" | null;
  // The receipts for THIS payment (migration 084). Until then a file_link
  // had a column for every target except a transaction, so three payments on
  // one task shared one undifferentiated pile of paper.
  files: ReceiptFile[];
};

const usd = (n: number | null) => (n == null ? "—" : `$${Math.round(n).toLocaleString()}`);

// Money that went out and came back, or never went: not a cost of this job.
const SPENT_NOT = ["refunded", "cancelled", "void"];

// The states a person can honestly set by hand. portal_transaction_edit holds
// the same list and refuses anything else - the rest of the lifecycle belongs
// to the money screens (migration 073).
const TXN_STATES = [
  ["paid", "Paid"],
  ["paid - receipt filed", "Paid, receipt on file"],
  ["paid - pending confirmation", "Paid, waiting on them to confirm"],
  ["refunded", "Refunded — it came back"],
  ["disputed", "Disputed"],
  ["cancelled", "Cancelled — it never happened"],
] as const;

// A credit has its own two states: it landed, or you are waiting on them to
// confirm it. portal_transaction_edit refuses the payment words on an 'in'
// row and these on an 'out' one, so the select must offer the right pair.
const CREDIT_STATES = [
  ["payment received", "Received"],
  ["payment received - pending confirmation", "Waiting on them to confirm"],
  ["disputed", "Disputed"],
  ["cancelled", "Cancelled — it never happened"],
] as const;

// A note and what it carries (migration 037). Evidence hangs off the NOTE,
// not just the task, so the history reads as what someone said and showed.
type Note = {
  id: string; body: string | null; author: string | null; created_at: string | null;
  files: { file_id: string; path: string; kind: string | null; mime: string | null; name: string | null }[];
};

const CLOSED = ["Completed", "Cancelled", "Force Cancelled", "Superseded"];
const todayISO = () => new Date().toISOString().slice(0, 10);

// THE VOCABULARY IS THE DATABASE'S (rulebook 15) - the open stages of
// actions_status_check, plus Completed.
//
// Completed used to be missing on purpose, because closing has to go through
// portal_close_task, which asks for the proof. Shahar (2026-09-12): "this page
// needs to be such that all that is required to close it is in one place...
// i cannot seem to set the task stage to complete." He is right that the list
// lying about the vocabulary is worse than the detour it was protecting: the
// stage now offers Completed and choosing it routes through the same gate,
// so the rule is kept and the dropdown tells the truth.
//
// Cancelled is still not here: it needs a reason and it is an ending, not a
// stage - it lives under "Cancel this task", at the foot of the task's own
// panel (Shahar, 2026-09-13).
// Parked = you set it down; Pending on Others = you are blocked and the
// unblock comes from outside, so it needs a reason (help: actions).
const STAGES = ["Not Started", "In Progress", "Pending on Others", "Parked", "Completed"] as const;
const PRIORITIES = ["Missing", "No Priority", "Low", "Medium", "High"] as const;
const PENDING_KINDS = [["", "—"], ["decision", "A decision"], ["delivery", "A delivery"], ["inspection", "An inspection"], ["legal", "Legal / permit"], ["financial", "Money"]] as const;

export default async function TaskPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string; error?: string; ok?: string; why?: string; undo?: string; money?: string }>;
}) {
  const { id } = await params;
  const { back, error, ok, why, undo, money } = await searchParams;
  const to = back && back.startsWith("/") && !back.startsWith("//") ? back : "/tasks";

  const w = stopwatch("/task/[id]");
  const supabase = await createClient();
  const { data: claims } = await w.step("claims", () => supabase.auth.getClaims());
  if (!claims?.claims?.sub) redirect(`/login?next=${encodeURIComponent(`/task/${id}`)}`);
  // The detail and the notes leave together: portal_task_detail carries the
  // comments but not their ids, so there is nothing to hang evidence off -
  // portal_task_notes returns each note WITH what was attached to it.
  // The people on the project come from the same read the compose box
  // uses, so "assign to" offers exactly who a message could reach.
  const [{ data }, { data: noteData }, { data: targetData }] = await Promise.all([
    w.step("task", () => rpc<Detail>(supabase, "portal_task_detail", { p_task: id })),
    w.step("notes", () => rpc<Note[]>(supabase, "portal_task_notes", { p_action_id: id })),
    w.step("people", () => rpc<Target[]>(supabase, "portal_compose_targets")),
  ]);
  if (!data) notFound();

  const t = data;
  // THE ACCOUNTS THIS JOB HAS BEEN PAID FROM (migration 075). Shahar
  // (2026-09-12): "have a place to update one's payment sources for easy
  // select in the drop down. can we start with nothing, but as data progress
  // it is added to a drop down automatically (per project)." There is no list
  // to maintain - the list IS the record, most recently used first, empty on
  // a new job. It costs a read only where money can be logged.
  const { data: acctData } = t.can_log_payment && t.project_id
    ? await w.step("accounts", () => rpc<string[]>(supabase, "portal_payment_accounts", { p_project: t.project_id }))
    : { data: null };
  const accounts = Array.isArray(acctData) ? acctData : [];
  const notes = Array.isArray(noteData) ? noteData : [];
  const people = (Array.isArray(targetData) ? targetData : []).find((x) => x.project_id === t.project_id)?.people ?? [];
  // The current assignee may sit on a parent project rather than this one;
  // keep them in the list so the select does not silently drop them.
  if (t.assignee && !people.some((p) => p.contact_id === t.assignee!.id)) {
    people.unshift({ contact_id: t.assignee.id, name: t.assignee.name ?? "Assigned", seat: null });
  }
  // ONE signed-URL round trip for every attachment on the page - the notes'
  // and the payments' receipts together, because they live in the same
  // private bucket and two calls would buy nothing.
  const notePaths = [
    ...notes.flatMap((n) => n.files.map((f) => f.path)),
    ...t.payments.flatMap((p) => (p.files ?? []).map((f) => f.path)),
  ];
  const noteUrls: Record<string, string> = {};
  if (notePaths.length > 0) {
    const { data: signed } = await w.step("noteFiles", () =>
      supabase.storage.from("project-media").createSignedUrls([...new Set(notePaths)], 3600));
    for (const row of signed ?? []) if (row.path && row.signedUrl) noteUrls[row.path] = row.signedUrl;
  }
  w.done();
  const closed = CLOSED.includes(t.status);
  const late = !!t.target_date && t.target_date < todayISO() && !closed;
  // PROOF, NOT PHOTOGRAPHS (migration 074). Shahar, closing a task about a
  // workers comp certificate with the certificate attached: "error saving
  // asking for photo where PDF files were attached." There is nothing to
  // photograph - the evidence for a certificate IS the certificate. Anything
  // on the task or on a note against it counts, which is what portal_close_task
  // counts too, so the screen and the gate cannot disagree.
  // A receipt filed against a payment counts too - portal_close_task walks
  // the same relationship (migration 084), and the screen must not disagree
  // with the gate about what proof exists.
  // WHAT THIS TASK HAS COST, NET. A credit is a positive amount travelling
  // the other way (migration 086), so it SUBTRACTS - summing every row would
  // make money coming back look like money going out.
  const counted = t.payments.filter((p) => !SPENT_NOT.includes(p.status));
  const credited = counted.filter((p) => p.direction === "in")
    .reduce((n, p) => n + (p.amount ?? 0), 0);
  const net = counted.reduce((n, p) => n + (p.direction === "in" ? -1 : 1) * (p.amount ?? 0), 0);
  const proof = (t.evidence ?? []).length
    + notes.reduce((n, c) => n + c.files.length, 0)
    + t.payments.reduce((n, p) => n + (p.files ?? []).length, 0);
  // ONE BOX, NOT TWO. Shahar (2026-09-13): "the system forces me both to
  // update comment header and what happened so i can close it as complete."
  //
  // It did, and it was this screen's doing rather than the database's. The
  // task closes on PROOF or on a REASON; the screen used to put the reason in
  // its own unlabelled input ABOVE the comment box, so a task with nothing
  // attached showed two writing boxes and closing needed the top one. There is
  // one box now - what you write in it IS the reason when there is nothing
  // attached (the action hands it over). This field only appears if the
  // database still refuses, which now only happens on a genuinely empty
  // update.
  const askWhy = why === "1";

  return (
    <Screen>
      <AppBar back={to} title="Task" sub={t.project ?? undefined} />
      <div className="body">
        {error && <Notice kind="error" title="Not saved.">{error}</Notice>}
        {/* IT STAYS ON THE TASK NOW, and the thing you just posted is one tap
            from being taken back (Shahar, 2026-09-12: "after clicking save,
            you should stay on this very same line added, as sometime you would
            want to edit. would be good to set an option for undo as well").
            The page also lands on the new entry - the redirect carries its
            anchor - so "the very same line" is what is under your thumb. */}
        {ok && (
          <div className="banner-ok">
            <span className="grow">{ok}</span>
            {undo && (
              <form action={undoNote} style={{ display: "inline" }}>
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="note" value={undo} />
                <input type="hidden" name="back" value={to} />
                <button className="btn btn-ghost small" style={{ marginLeft: 8 }}>Undo</button>
              </form>
            )}
          </div>
        )}

        {/* THE TASK LINE. Shahar (2026-09-13): "Task line, below expanded
            info about the task." */}
        <div className="hero">
          <h1 style={{ fontSize: 24 }}>{t.action}</h1>
          <p className="lead">
            {[
              t.holder?.name
                ? (t.holder.kind === "assistant" ? `${t.holder.name} · assistant` : t.holder.name)
                : "nobody holds this",
              t.priority && t.priority !== "Missing" ? `${t.priority} priority` : null,
              t.target_date ? `${late ? "was due" : "due"} ${shortDate(t.target_date)}` : "no date",
              closed ? t.status : null,
            ].filter(Boolean).join(" · ")}
          </p>
        </div>

        {t.project_id && (
          <p className="small text-muted" style={{ margin: "-4px 0 0" }}>
            On <Link href={`/project/${t.project_id}`}>{t.project}</Link>.
          </p>
        )}

        {t.open_children > 0 && (
          <Notice kind="info" title={`${t.open_children} step${t.open_children === 1 ? "" : "s"} still open beneath this.`}>
            Those close first — the database blocks a parent while a gate child is open.
          </Notice>
        )}

        {/* Read-only: the expanded task, for somebody who may not change it,
            and for a task that has ended. The editable version below shows
            the same words in their fields, so it is one or the other. */}
        {(closed || !t.can_edit) && (t.desired_outcome || t.notes) && (
          <Card soft pad>
            {t.desired_outcome && <><div className="kicker">Done looks like</div>
              <LongText text={t.desired_outcome} lines={4} style={{ marginTop: 4 }} /></>}
            {t.notes && (
              <div style={{ marginTop: t.desired_outcome ? 10 : 0 }}>
                <LongText text={t.notes} lines={6} />
              </div>
            )}
          </Card>
        )}

        {(closed || !t.can_edit) && t.pending_on && (
          <Notice kind="info" title={`Waiting on ${t.pending_on}.`}>{t.pending_reason ?? "No reason recorded."}</Notice>
        )}

        {/* ONE FORM, TWO PARTS (Shahar, 2026-09-12 and 2026-09-13).
            The screen once had three forms, three save buttons, and pressing
            one silently threw away what had been typed in the other two. It
            is ONE form now: every button on it saves ALL of it, and which
            button you pressed only decides what ELSE happens.

            The two parts are the ones Shahar asked for. First the TASK -
            what it is, its stage, its priority, who holds the ball and why,
            with save, cancel-the-changes and cancel-the-task under it.
            Then, after that part, what you DO about it: log a payment
            against it, or post an update and close it. */}
        {!closed && (
          <form action={saveTask} className="stack" style={{ gap: 18 }}>
            <input type="hidden" name="id" value={t.id} />
            <input type="hidden" name="back" value={to} />

            {/* ---- PART ONE: THE TASK ---------------------------------- */}
            {t.can_edit && (
              <section className="stack" style={{ gap: 10 }}>
                <div className="divider-label">The task</div>
                {/* Says the fields are on the page at all: a crew member who
                    may not edit never sends them, and the action knows. */}
                <input type="hidden" name="has_fields" value="1" />
                <label className="field">
                  <span className="field-label">Task</span>
                  <input className="input" name="action" defaultValue={t.action} required maxLength={300} />
                </label>
                <label className="field">
                  <span className="field-label">Done looks like <span className="text-muted">(the end state, not the work)</span></span>
                  <textarea className="input" name="desired_outcome" rows={3} defaultValue={t.desired_outcome ?? ""} />
                </label>
                <div className="row" style={{ gap: 8 }}>
                  <label className="field grow">
                    <span className="field-label">Stage</span>
                    <select className="input" name="status" defaultValue={STAGES.includes(t.status as typeof STAGES[number]) ? t.status : "Not Started"}>
                      {STAGES.map((x) => <option key={x} value={x}>{x}</option>)}
                    </select>
                  </label>
                  <label className="field grow">
                    <span className="field-label">Priority</span>
                    <select className="input" name="priority" defaultValue={t.priority ?? "Missing"}>
                      {PRIORITIES.map((x) => <option key={x} value={x}>{x === "Missing" ? "Not set" : x}</option>)}
                    </select>
                  </label>
                </div>
                <label className="field">
                  <span className="field-label">Pending on <span className="text-muted">(who or what holds the ball)</span></span>
                  <input className="input" name="pending_on" defaultValue={t.pending_on ?? ""} placeholder="Steve at Andersen · the town inspector · a decision from Ifat" />
                </label>
                <div className="row" style={{ gap: 8 }}>
                  <label className="field grow">
                    <span className="field-label">Why <span className="text-muted">(required when Pending on Others)</span></span>
                    <input className="input" name="pending_reason" defaultValue={t.pending_reason ?? ""} placeholder="Waiting for the revised quote" />
                  </label>
                  <label className="field" style={{ flex: "0 0 40%" }}>
                    <span className="field-label">Type</span>
                    <select className="input" name="pending_category" defaultValue={t.pending_category ?? ""}>
                      {PENDING_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </label>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <label className="field grow">
                    <span className="field-label">Due</span>
                    <input className="input" name="target_date" type="date" defaultValue={t.target_date ?? ""} />
                  </label>
                  <label className="field grow">
                    <span className="field-label">Assigned to</span>
                    <select className="input" name="assignee" defaultValue={t.assignee?.id ?? ""}>
                      <option value="">Nobody yet</option>
                      {people.map((x) => (
                        <option key={x.contact_id} value={x.contact_id}>{x.me ? `${x.name} (me)` : x.name}{x.seat ? ` · ${x.seat}` : ""}</option>
                      ))}
                    </select>
                  </label>
                </div>

                {/* SAVE · CANCEL THE CHANGES · CANCEL THE TASK, in that
                    order, right under the fields they belong to. Save takes
                    the whole screen with it, so nothing typed further down
                    is ever lost to pressing it. */}
                <div className="row" style={{ gap: 8 }}>
                  <button name="do" value="save" className="btn btn-primary grow">Save</button>
                  <Link href={`/task/${t.id}?back=${encodeURIComponent(to)}`} className="btn btn-ghost grow">Cancel changes</Link>
                </div>

                {/* THE END OF THE TASK, not the end of the edit. This
                    replaced the old "This task will not happen" panel
                    (Shahar, 2026-09-13) and sits with the task rather than
                    at the foot of the page, which is where the confusion
                    with Discard came from. Both buttons skip the browser's
                    validation - a half-filled payment further down must not
                    stand between somebody and calling a task off. */}
                <details className="home-panel">
                  <summary className="home-row">
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="t">Cancel the task</span>
                      <span className="m" style={{ display: "block" }}>Call it off, or remove one entered by mistake</span>
                    </span>
                    <span className="chev"><ChevronIcon /></span>
                  </summary>
                  <div className="drawer stack" style={{ gap: 10, paddingTop: 12 }}>
                    <p className="tiny text-muted" style={{ margin: 0 }}>
                      Not the same as Cancel changes: that one throws away what you have typed.
                      These end the TASK — calling it off keeps it as a record with your reason
                      on it, deleting removes it as though it had never been entered.
                    </p>
                    <label className="field">
                      <span className="field-label">Why it will not happen <span className="text-muted">(optional)</span></span>
                      <input className="input" name="cancel_reason" placeholder="Scope changed · done by someone else · no longer needed" />
                    </label>
                    <button formAction={cancelTask} formNoValidate className="btn btn-secondary btn-block">
                      Call this task off
                    </button>
                    <button formAction={deleteTask} formNoValidate className="btn btn-ghost btn-block btn-danger">
                      Delete it — it was entered by mistake
                    </button>
                    <p className="tiny text-muted" style={{ margin: 0 }}>
                      Only a task nothing has been posted on, made by you or on a site you run.
                      Anything else is cancelled, not deleted.
                    </p>
                  </div>
                </details>
              </section>
            )}

            {/* ---- PART TWO: WHAT YOU DO ABOUT IT ---------------------- */}
            <section className="stack" style={{ gap: 10 }}>
              <div className="divider-label">Against this task</div>

              {/* WHAT IT COST (migration 065). Inside the same form, so
                  logging a purchase saves the field edits and the update
                  with it, and an amount in the box is logged by whichever
                  button gets pressed. */}
              {t.can_log_payment && (
                <details className="home-panel" open={money === "1"}>
                  <summary className="home-row">
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="t">Log a payment</span>
                      <span className="m" style={{ display: "block" }}>Something you bought or paid for to get this done</span>
                    </span>
                    <span className="chev"><ChevronIcon /></span>
                  </summary>
                  <div className="drawer stack" style={{ gap: 10, paddingTop: 12 }}>
                    <PaymentBox projectId={t.project_id} methods={t.methods} accounts={accounts}
                      people={people.map((x) => ({ contact_id: x.contact_id, name: x.name }))} />
                  </div>
                </details>
              )}

              {/* THE UPDATE. One writing box, and the proof that goes with
                  it - a photo, the certificate, a recording. */}
              {/* A div, not a label: Evidence carries buttons, and a click
                  on a button inside a label goes to the label's control. */}
              <div className="field">
                <span className="field-label">Update the status</span>
                <NoteBox projectId={t.project_id} />
              </div>

              {/* Only when the database has actually refused - see askWhy. */}
              {askWhy && (
                <label className="field">
                  <span className="field-label">Why it closes with nothing attached</span>
                  <input name="unlock_reason" className="input" autoFocus
                    placeholder="Nothing to photograph · the certificate is with the town · done by phone" />
                  <span className="hint">
                    A few words, recorded against the task. Or attach the proof above instead —
                    a photo, a certificate or a recording all count.
                  </span>
                </label>
              )}

              <div className="stack" style={{ gap: 8 }}>
                <button name="do" value="save" className="btn btn-primary btn-block">Post the update</button>
                <button name="do" value="complete" className="btn btn-secondary btn-block">Post it &amp; mark complete</button>
                <p className="tiny text-muted" style={{ margin: 0 }}>
                  Either button saves the whole screen — the task fields, the update, the files and
                  the payment. The first stays here so you can carry on; the second closes the task,
                  and what you wrote above is the reason on record if nothing is attached.
                </p>
              </div>
            </section>
          </form>
        )}

        {closed && (
          <Card soft pad><div className="small">This task is {t.status.toLowerCase()}. Reopening is a portal action.</div></Card>
        )}

        {/* WHAT IT HAS COST. Each row opens to be corrected - Shahar
            (2026-09-12): "inside a task, i cannot edit the transaction. it is
            status paid, however, it was refunded. where can we edit the
            transactions from?" Nowhere, until migration 073: nothing in any
            app could change a transaction once it was written. Now the row
            IS the edit, and "refunded" is a state it can be put in - money
            that left and came back is neither a cost nor an obligation. */}
        {t.payments.length > 0 && (
          <section className="stack" style={{ gap: 8 }}>
            <div className="divider-label">
              Money · {usd(net)} on this task
              {credited > 0 ? ` · ${usd(credited)} credited back` : ""}
            </div>

            {t.payments.map((p) => {
              const back = SPENT_NOT.includes(p.status);
              const line = [
                p.paid_on ? shortDate(p.paid_on) : null, p.method,
                p.reference ? `ref ${p.reference}` : null,
              ].filter(Boolean).join(" · ");
              const row = (
                <>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="t" style={back ? { textDecoration: "line-through", color: "var(--muted)" } : undefined}>
                      {p.direction === "in" ? "− " : ""}{usd(p.amount)}
                      {/* Where it came from and where it landed, in the order
                          it travelled - the same shape it was entered in
                          (Shahar, 2026-09-14: "just from & to"). */}
                      <span className="text-muted" style={{ fontWeight: 400 }}>
                        {"  "}
                        {p.direction === "in"
                          ? `${p.paid_to ?? "them"} → ${p.from_account ?? "you"}`
                          : `${p.from_account ?? "you"} → ${p.paid_to ?? "them"}`}
                      </span>
                    </span>
                    <span className="m" style={{ display: "block" }}>{line || p.description || "—"}</span>
                  </span>
                  <span className={`tag ${p.status === "refunded" ? "tag-neutral" : p.status === "paid - receipt filed" || p.status === "settled" ? "tag-ok" : "tag-outline"}`}
                    style={{ whiteSpace: "nowrap" }}>
                    {p.status === "paid - receipt filed" ? "receipt filed" : p.status === "paid - pending confirmation" ? "awaiting" : p.status}
                  </span>
                  {/* Whether the paper is actually here. "receipt filed" is a
                      STATUS somebody chose; this is the file count, and until
                      migration 084 the two could say opposite things because
                      a receipt could not be attached to a payment at all. */}
                  {(p.files ?? []).length > 0 && (
                    <span className="tag tag-neutral" style={{ whiteSpace: "nowrap" }}>
                      {p.files.length} on file
                    </span>
                  )}
                </>
              );
              if (!t.can_log_payment) {
                return <div className="home-row" key={p.id} style={{ cursor: "default", alignItems: "flex-start" }}>{row}</div>;
              }
              return (
                <details className="home-panel" key={p.id}>
                  <summary className="home-row">{row}<span className="chev"><ChevronIcon /></span></summary>
                  <form action={editPayment} className="drawer stack" style={{ gap: 10, paddingTop: 12 }}>
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="txn" value={p.id} />
                    <input type="hidden" name="back" value={to} />
                    <label className="field">
                      <span className="field-label">What it was</span>
                      <input className="input" name="description" defaultValue={p.description ?? ""} placeholder="The sign, the part, the permit fee" />
                    </label>
                    <div className="row" style={{ gap: 8 }}>
                      <label className="field grow">
                        <span className="field-label">Amount ($)</span>
                        <input className="input" name="amount" inputMode="decimal" defaultValue={p.amount != null ? String(p.amount) : ""} />
                      </label>
                      <label className="field grow">
                        <span className="field-label">Paid on</span>
                        <input className="input" name="paid_on" type="date" defaultValue={p.paid_on ?? ""} />
                      </label>
                    </div>
                    {/* FROM → TO, the order this row's money travelled.
                        No swap here: turning a payment into a credit would
                        also have to move its status to the other direction's
                        vocabulary, which is a different act from correcting a
                        field. Log the other one and cancel this. */}
                    <div className="stack" style={{ gap: 8 }}>
                      <label className="field" style={{ marginBottom: 0 }}>
                        <span className="field-label">
                          {p.direction === "in" ? "From — the other side" : "From — your account"}
                        </span>
                        {p.direction === "in"
                          ? <input className="input" name="payee" defaultValue={p.paid_to ?? ""} list="task-payee-list" autoComplete="off" />
                          : <input className="input" name="from_account" defaultValue={p.from_account ?? ""} list="task-account-list" autoComplete="off" />}
                      </label>
                      <div className="tiny text-muted" style={{ textAlign: "center", margin: "-2px 0" }}>↓</div>
                      <label className="field" style={{ marginBottom: 0 }}>
                        <span className="field-label">
                          {p.direction === "in" ? "To — your account" : "To — the other side"}
                        </span>
                        {p.direction === "in"
                          ? <input className="input" name="from_account" defaultValue={p.from_account ?? ""} list="task-account-list" autoComplete="off" />
                          : <input className="input" name="payee" defaultValue={p.paid_to ?? ""} list="task-payee-list" autoComplete="off" />}
                      </label>
                    </div>
                    <div className="row" style={{ gap: 8 }}>
                      <label className="field grow">
                        <span className="field-label">How</span>
                        <select className="input" name="method"
                          defaultValue={t.methods.find((mm) => mm.name === p.method)?.id ?? t.methods[0]?.id ?? ""}>
                          {t.methods.map((mm) => <option key={mm.id} value={mm.id}>{mm.name}</option>)}
                        </select>
                      </label>
                      <label className="field grow">
                        <span className="field-label">Reference</span>
                        <input className="input" name="reference" defaultValue={p.reference ?? ""} />
                      </label>
                    </div>
                    <label className="field">
                      <span className="field-label">Where it stands</span>
                      <select className="input" name="status"
                        defaultValue={(p.direction === "in" ? CREDIT_STATES : TXN_STATES).some(([v]) => v === p.status)
                          ? p.status : (p.direction === "in" ? "payment received" : "paid")}>
                        {(p.direction === "in" ? CREDIT_STATES : TXN_STATES).map(([v, l]) =>
                          <option key={v} value={v}>{l}</option>)}
                      </select>
                      <span className="hint">
                        Refunded means it went out and came back — it stops counting as a cost of this job,
                        and the record of it happening stays.
                      </span>
                    </label>

                    {/* THE PAPER (migration 084). Add one, or take one off -
                        both go in with the same Save as the fields. */}
                    <ReceiptBox projectId={t.project_id} existing={p.files ?? []} urls={noteUrls} />

                    <button className="btn btn-primary btn-block">Save this payment</button>
                  </form>
                </details>
              );
            })}
          </section>
        )}

        <datalist id="task-payee-list">
          {people.map((x) => <option key={x.contact_id} value={x.name ?? ""} />)}
        </datalist>
        {/* Every account this job has already been paid from, newest first. */}
        <datalist id="task-account-list">
          {accounts.map((a) => <option key={a} value={a} />)}
        </datalist>

        {proof > 0 && (
          <p className="tiny text-muted" style={{ margin: 0 }}>
            {proof} file{proof === 1 ? "" : "s"} on file — that is the proof this task closes on.
          </p>
        )}

        <section className="stack" style={{ gap: 8 }}>
          <div className="divider-label">History · {notes.length}</div>
          {notes.length === 0 && (
            <Card soft pad><div className="small">Nothing posted on this task yet.</div></Card>
          )}
          {notes.map((c) => (
            <Card pad key={c.id} className={`tight ${undo === c.id ? "just-added" : ""}`} id={`n${c.id}`}>
              <div className="tiny text-muted">
                {[c.author, c.created_at ? shortDate(c.created_at.slice(0, 10)) : null].filter(Boolean).join(" · ")}
              </div>
              {c.body && <p className="small" style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{c.body}</p>}
              {/* What was attached WITH this note. A recording plays here;
                  a photo shows; anything else is a named file. */}
              {c.files.length > 0 && (
                <div className="stack" style={{ gap: 8, marginTop: c.body ? 10 : 4 }}>
                  {c.files.map((f) => {
                    const url = noteUrls[f.path];
                    if (f.kind === "audio") {
                      return url
                        ? <audio key={f.file_id} src={url} controls preload="none" style={{ width: "100%" }} />
                        : <p key={f.file_id} className="tiny text-muted" style={{ margin: 0 }}>Voice note</p>;
                    }
                    if (f.kind === "photo") {
                      return url
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img key={f.file_id} src={url} alt={f.name ?? "Photo"} style={{ width: "100%", borderRadius: 10, display: "block" }} />
                        : <div key={f.file_id} className="skel" style={{ aspectRatio: "4/3" }} />;
                    }
                    return (
                      <p key={f.file_id} className="tiny text-muted" style={{ margin: 0 }}>
                        {url ? <a href={url} target="_blank" rel="noreferrer">{f.name ?? f.kind}</a> : (f.name ?? f.kind)}
                      </p>
                    );
                  })}
                </div>
              )}
            </Card>
          ))}
        </section>
      </div>
    </Screen>
  );
}
