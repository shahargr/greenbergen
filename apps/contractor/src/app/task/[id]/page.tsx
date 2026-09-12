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
  assignee: { id: string; name: string | null } | null;
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

// A note and what it carries (migration 037). Evidence hangs off the NOTE,
// not just the task, so the history reads as what someone said and showed.
type Note = {
  id: string; body: string | null; author: string | null; created_at: string | null;
  files: { file_id: string; path: string; kind: string | null; mime: string | null; name: string | null }[];
};

const CLOSED = ["Completed", "Cancelled", "Force Cancelled", "Superseded"];
const todayISO = () => new Date().toISOString().slice(0, 10);

// THE VOCABULARY IS THE DATABASE'S (rulebook 15). These are the open stages
// of actions_status_check - Completed and Cancelled are not here because
// closing goes through Mark complete, which records the why and the photo.
// Parked = you set it down; Pending on Others = you are blocked and the
// unblock comes from outside, so it needs a reason (help: actions).
const STAGES = ["Not Started", "In Progress", "Pending on Others", "Parked"] as const;
const PRIORITIES = ["Missing", "No Priority", "Low", "Medium", "High"] as const;
const PENDING_KINDS = [["", "—"], ["decision", "A decision"], ["delivery", "A delivery"], ["inspection", "An inspection"], ["legal", "Legal / permit"], ["financial", "Money"]] as const;

export default async function TaskPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string; error?: string; ok?: string; why?: string; edit?: string; undo?: string; money?: string }>;
}) {
  const { id } = await params;
  const { back, error, ok, why, edit, undo, money } = await searchParams;
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
  const notes = Array.isArray(noteData) ? noteData : [];
  const people = (Array.isArray(targetData) ? targetData : []).find((x) => x.project_id === t.project_id)?.people ?? [];
  // The current assignee may sit on a parent project rather than this one;
  // keep them in the list so the select does not silently drop them.
  if (t.assignee && !people.some((p) => p.contact_id === t.assignee!.id)) {
    people.unshift({ contact_id: t.assignee.id, name: t.assignee.name ?? "Assigned", seat: null });
  }
  // One signed-URL round trip for every attachment on the page.
  const notePaths = notes.flatMap((n) => n.files.map((f) => f.path));
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
  const proof = (t.evidence ?? []).length + notes.reduce((n, c) => n + c.files.length, 0);
  // It asks for a reason whenever there is nothing attached - not only when
  // the task is flagged as requiring evidence.
  const needsWhy = why === "1" || proof === 0;

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

        <div className="hero">
          <h1 style={{ fontSize: 24 }}>{t.action}</h1>
          <p className="lead">
            {[
              t.assignee?.name ?? "unassigned",
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

        {/* The description, folded to a few lines: some of these run for two
            screens, and the task's own state is what you came for (Shahar). */}
        {(t.desired_outcome || t.notes) && (
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

        {t.open_children > 0 && (
          <Notice kind="info" title={`${t.open_children} step${t.open_children === 1 ? "" : "s"} still open beneath this.`}>
            Those close first — the database blocks a parent while a gate child is open.
          </Notice>
        )}

        {t.pending_on && (
          <Notice kind="info" title={`Waiting on ${t.pending_on}.`}>{t.pending_reason ?? "No reason recorded."}</Notice>
        )}

        {/* ONE FORM, ONE SAVE (Shahar, 2026-09-12).
            This screen used to be three forms - the fields, the update, the
            payment - each with its own save button, and pressing one of them
            threw away whatever had been typed in the other two, silently. It
            is one form now and every button on it saves ALL of it. Which
            button you pressed only decides what ELSE happens: nothing,
            closing the task, or logging the purchase. */}
        {!closed && (
          <form action={saveTask} className="stack" style={{ gap: 12 }}>
            <input type="hidden" name="id" value={t.id} />
            <input type="hidden" name="back" value={to} />

            {/* EVERYTHING THE TASK IS. Shut by default because most visits
                are to post an update; open when a save just failed, so
                nothing typed is lost to a reload. Closing is not here -
                Mark complete is at the foot of this same form. */}
            {t.can_edit && (
              <details className="home-panel" open={edit === "1"}>
                <summary className="home-row">
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="t">Edit the task</span>
                    <span className="m" style={{ display: "block" }}>Subject, outcome, stage, who holds the ball, priority, date, assignee</span>
                  </span>
                  <span className="chev"><ChevronIcon /></span>
                </summary>
                <div className="drawer stack" style={{ gap: 10, paddingTop: 12 }}>
                  {/* Says the fields are on the page at all: a crew member who
                      may not edit never sends them, and the action knows. */}
                  <input type="hidden" name="has_fields" value="1" />
                  <label className="field">
                    <span className="field-label">Subject</span>
                    <input className="input" name="action" defaultValue={t.action} required maxLength={300} />
                  </label>
                  <label className="field">
                    <span className="field-label">Done looks like <span className="text-muted">(the end state, not the work)</span></span>
                    <textarea className="input" name="desired_outcome" rows={2} defaultValue={t.desired_outcome ?? ""} />
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
                      <span className="field-label">Kind</span>
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
                </div>
              </details>
            )}

            {/* WHAT HAPPENED. The note and whatever it carries. */}
            <div className="stack" style={{ gap: 8 }}>
              <div className="divider-label">Comment</div>
              {needsWhy && (
                <label className="stack" style={{ gap: 4 }}>
                  <span className="tiny text-muted">
                    Nothing attached to this task yet. Closing it without proof records why, against
                    the task — a photo, a certificate or a recording is enough either way.
                  </span>
                  <input name="reason" className="input" placeholder="Why there is no photo (a few words)" />
                </label>
              )}
              <NoteBox projectId={t.project_id} />
            </div>

            {/* WHAT IT COST (migration 065). Inside this form, so logging a
                purchase saves the field edits and the note with it. */}
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
                  <PaymentBox projectId={t.project_id} methods={t.methods}
                    people={people.map((x) => ({ contact_id: x.contact_id, name: x.name }))} />
                </div>
              </details>
            )}

            {/* THREE WAYS OUT, no more (Shahar, 2026-09-12: "Need to simplify
                the task update... cancel / back, update & close, update &
                close complete"). Neither Update is ever disabled: you may
                have changed only a field, and a save that will not press is
                how the last version lost a drawer full of them. */}
            <div className="stack" style={{ gap: 8 }}>
              <button name="do" value="save" className="btn btn-primary btn-block">Update &amp; close</button>
              <button name="do" value="complete" className="btn btn-secondary btn-block">Update &amp; mark complete</button>
              <Link href={to} className="btn btn-ghost btn-block">Cancel / back</Link>
              <p className="tiny text-muted" style={{ margin: 0 }}>
                Both Updates save everything on this screen — the fields, the comment, the files,
                the payment. The first stays here so you can carry on; the second closes the task.
              </p>
            </div>
          </form>
        )}

        {/* This will not happen - or it was a slip (migration 060). Cancel
            keeps the task as record, with the reason; delete removes a task
            nothing has been posted on yet, and the database says when a
            task is a record instead. Its own forms: they end the task rather
            than saving it. */}
        {!closed && t.can_edit && (
          <details className="home-panel">
            <summary className="home-row">
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="t">Cancel or delete</span>
                <span className="m" style={{ display: "block" }}>It will not happen, or it was entered by mistake</span>
              </span>
              <span className="chev"><ChevronIcon /></span>
            </summary>
            <div className="drawer stack" style={{ gap: 10, paddingTop: 12 }}>
              <form action={cancelTask} className="stack" style={{ gap: 8 }}>
                <input type="hidden" name="id" value={t.id} />
                <input type="hidden" name="back" value={to} />
                <label className="field">
                  <span className="field-label">Why it will not happen <span className="text-muted">(optional)</span></span>
                  <input className="input" name="reason" placeholder="Scope changed · done by someone else · no longer needed" />
                </label>
                <button className="btn btn-secondary btn-block">Cancel this task</button>
              </form>
              <form action={deleteTask} className="stack" style={{ gap: 6 }}>
                <input type="hidden" name="id" value={t.id} />
                <input type="hidden" name="back" value={to} />
                <button className="btn btn-ghost btn-block btn-danger">Delete it - it was a mistake</button>
                <p className="tiny text-muted" style={{ margin: 0 }}>Only a task nothing has been posted on, made by you or on a site you run. Anything else is cancelled, not deleted.</p>
              </form>
            </div>
          </details>
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
              Money · {usd(t.payments
                .filter((p) => !SPENT_NOT.includes(p.status))
                .reduce((n, p) => n + (p.amount ?? 0), 0))} on this task
            </div>

            {t.payments.map((p) => {
              const back = SPENT_NOT.includes(p.status);
              const line = [
                p.paid_on ? shortDate(p.paid_on) : null, p.method,
                p.reference ? `ref ${p.reference}` : null, p.from_account,
              ].filter(Boolean).join(" · ");
              const row = (
                <>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="t" style={back ? { textDecoration: "line-through", color: "var(--muted)" } : undefined}>
                      {usd(p.amount)}{p.paid_to ? ` to ${p.paid_to}` : ""}
                    </span>
                    <span className="m" style={{ display: "block" }}>{line || p.description || "—"}</span>
                  </span>
                  <span className={`tag ${p.status === "refunded" ? "tag-neutral" : p.status === "paid - receipt filed" || p.status === "settled" ? "tag-ok" : "tag-outline"}`}
                    style={{ whiteSpace: "nowrap" }}>
                    {p.status === "paid - receipt filed" ? "receipt filed" : p.status === "paid - pending confirmation" ? "awaiting" : p.status}
                  </span>
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
                    <label className="field">
                      <span className="field-label">Who was paid</span>
                      <input className="input" name="payee" defaultValue={p.paid_to ?? ""} list="task-payee-list" autoComplete="off" />
                    </label>
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
                      <span className="field-label">From which account <span className="text-muted">(optional)</span></span>
                      <input className="input" name="from_account" defaultValue={p.from_account ?? ""} />
                    </label>
                    <label className="field">
                      <span className="field-label">Where it stands</span>
                      <select className="input" name="status" defaultValue={TXN_STATES.some(([v]) => v === p.status) ? p.status : "paid"}>
                        {TXN_STATES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                      <span className="hint">
                        Refunded means it went out and came back — it stops counting as a cost of this job,
                        and the record of it happening stays.
                      </span>
                    </label>
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
