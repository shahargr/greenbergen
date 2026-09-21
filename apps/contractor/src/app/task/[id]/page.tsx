import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";
import { shortDate } from "@shared/format";
import { stopwatch } from "@shared/perf";
import { AppBar, Card, LongText, Notice, Screen } from "@shared/ui";
import { TaskBar } from "./TaskBar";
import { TaskActionsRow } from "./TaskActionsRow";
import { saveTask, undoNote, editPayment, cancelTask, deleteTask, linkTask } from "./actions";
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
  // Where it stands, in one line, in your own words. Replaced Pending on +
  // Why + Type, which asked three questions to describe one thing and made
  // you answer two of them before it would save (migration 095).
  status_note: string | null;
  requires_photo_evidence: boolean | null;
  // SIMPLE OR NOT (migration 137). False means nothing may be filed beneath
  // it - a one-line task logged from a trade screen. The database refuses a
  // child either way; this is so the screen stops offering one.
  accepts_steps: boolean;
  can_edit: boolean;
  created_at: string | null; created_by: string | null; last_updated: string | null;
  project_id: string | null; project: string | null;
  // The CONTACT the "Assigned to" select is bound to, and - display only -
  // whoever actually holds it, which may be an assistant (migration 080).
  // Reading only the contact is why a task Bobby holds read "unassigned"
  // here while the list beside it said Bobby.
  assignee: { id: string; name: string | null } | null;
  holder: { name: string | null; kind: "person" | "assistant" } | null;
  // WHAT IS ATTACHED TO THE TASK ITSELF, as against what is attached to a
  // note. Returned since this function was written and only ever COUNTED -
  // the count feeds the photo gate and the pictures were never drawn
  // (migration 136, which added the caption so they can be).
  evidence: { id: string; file_name: string | null; kind: string | null; role: string | null;
              path: string; caption: string | null; mime: string | null; created_at: string | null }[];
  comments: { author: string | null; body: string | null; created_at: string | null }[];
  open_children: number;
  // WHAT IS IN IT (migration 133). A container's children, in the blueprint's
  // own order, done ones in place rather than sorted to the bottom - a
  // checklist is read down the sequence.
  children: Kid[];
  // HOW IT FITS (migration 130). Both columns have been on actions since the
  // beginning and neither had a door until now: `parent` is the task this is
  // a step of, `follows` is the one thing it waits on, `blocks` is everything
  // waiting on it. link_options is what may be picked - this job's tasks,
  // minus this one and anything already beneath it.
  parent: Link1 | null;
  scope: { id: string; item: string | null; trade: string | null; category: string | null } | null;
  follows: (Link1 & { done: boolean }) | null;
  blocks: Link1[];
  link_options: { id: string; action: string; open: boolean }[];
  // What this task cost, and whether the person looking may add to it
  // (migration 065). Money follows the money ladder: a crew member reads
  // the work and never the cost, so both come back empty for them.
  can_log_payment: boolean;
  payments: Payment[];
  methods: Method[];
};

type Link1 = { id: string; action: string; status: string };

type Kid = {
  id: string; action: string; status: string; open: boolean;
  target_date: string | null; completed_on: string | null;
  step_order: number | null; is_gate: boolean;
  holder: string | null; open_children: number;
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

// Label on the left, the thing you change on the right. One row per line,
// which is what Shahar asked for (2026-09-14) and what makes the screen
// readable on a phone at arm's length on a site.
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="task-row">
      <span className="task-row-label">
        {label}
        {hint && <span className="text-muted" style={{ display: "block", fontWeight: 400 }}>{hint}</span>}
      </span>
      <div className="task-row-value">{children}</div>
    </div>
  );
}

// One link, as a sentence you can tap through. A finished predecessor is
// worth saying out loud: "comes after X · done" is the difference between
// blocked and free to start.
function FitLine({ label, x, back }: { label: string; x: Link1; back: string }) {
  const done = CLOSED.includes(x.status);
  return (
    <span className="small" style={{ display: "block" }}>
      <span className="text-muted">{label} </span>
      <Link href={`/task/${x.id}?back=${encodeURIComponent(back)}`}>{x.action}</Link>
      {done && <span className="text-muted"> · done</span>}
    </span>
  );
}

// A picker that is its own form: pick, save, done. `clearable` is for the two
// links this task owns - "part of" and "comes after" are one thing each, so
// an empty pick means cut it. "Comes before" has no empty option because
// there can be several and each is removed by name.
function LinkPicker({ id, back, rel, label, hint, current, options, clearable = false }: {
  id: string; back: string; rel: "parent" | "after" | "before";
  label: string; hint: string; current: string;
  options: { id: string; action: string; open: boolean }[];
  clearable?: boolean;
}) {
  return (
    <form action={linkTask} className="stack" style={{ gap: 4 }}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="back" value={back} />
      <input type="hidden" name="rel" value={rel} />
      <label className="divider-label" style={{ padding: 0 }} htmlFor={`link-${rel}`}>{label}</label>
      <p className="tiny text-muted" style={{ margin: 0 }}>{hint}</p>
      <div className="row" style={{ gap: 8, alignItems: "center" }}>
        <select id={`link-${rel}`} name="other" defaultValue={current} className="input grow" style={{ minWidth: 0 }}>
          <option value="">{clearable ? "— nothing —" : "— pick a task —"}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>{o.action}{o.open ? "" : " · done"}</option>
          ))}
        </select>
        <button className="btn btn-secondary small" style={{ minHeight: 38, flex: "none" }}>
          {rel === "before" ? "Add" : "Save"}
        </button>
      </div>
    </form>
  );
}

export default async function TaskPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string; error?: string; ok?: string; why?: string; undo?: string; money?: string; setup?: string; remove?: string; fit?: string; stage?: string; prio?: string }>;
}) {
  const { id } = await params;
  const { back, error, ok, why, undo, money, setup: setupQ, remove: removeQ, fit: fitQ, stage: stageQ, prio: prioQ } = await searchParams;
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
    // The task's own attachments ride the same round trip: same bucket, and
    // two calls would buy nothing.
    ...(t.evidence ?? []).map((f) => f.path),
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
  // WHAT YOU CHOSE, KEPT THROUGH A REFUSAL. The action sends the attempted
  // stage and priority back on the URL when the database says no; without
  // them the dropdowns re-read the old values and you choose twice - and the
  // "why it closes" box was posting under a stage that no longer said
  // Completed, so it closed nothing.
  const isStage = (x: string | null | undefined) => (STAGES as readonly string[]).includes(x ?? "");
  const stageShown = isStage(stageQ) ? stageQ! : isStage(t.status) ? t.status : "Not Started";
  const prioShown = (PRIORITIES as readonly string[]).includes(prioQ ?? "") ? prioQ! : (t.priority ?? "Missing");

  // THE GEAR AND THE i. Shahar (2026-09-14): "task name / have a gear icon
  // next to it to allow enter the task setup... Next to the gear button you
  // have an 'i' information button, allowing also to see what good look like
  // for the task if entered."
  //
  // Both are links carrying a query flag rather than client state, the way
  // this screen already opens the payment drawer. That keeps them working
  // with the page's ONE form: a panel opened by a link is rendered by the
  // server INSIDE that form, so its fields save with everything else. A
  // client toggle would have had to live outside the form or drag the whole
  // screen into a client component.
  const setup = setupQ === "1";
  const remove = removeQ === "1";
  // HOW IT FITS. Same trick, one more flag - except this panel's forms post
  // to linkTask rather than to the page's own save, so they sit OUTSIDE the
  // big form (nested forms are not a thing) and are rendered before it.
  const fit = fitQ === "1";
  const fits = !!t.parent || !!t.follows || t.blocks.length > 0;
  const flag = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ back: to, ...extra });
    return `/task/${id}?${p.toString()}`;
  };

  return (
    <Screen>
      {/* PROJECT › TASK. Shahar (2026-09-17): "instead of the top right where
          it says Task, and under it, new build, use breadcrumbs format:
          project name > task name." The word "Task" told you what kind of
          screen you were on, which you knew; the crumb tells you which one. */}
      <AppBar back={to} title={
        <span className="crumbs">
          {t.project_id
            ? <Link href={`/project/${t.project_id}`}>{t.project ?? "Project"}</Link>
            : <span style={{ color: "var(--muted)", fontWeight: 600 }}>{t.project ?? "Project"}</span>}
          <span className="sep" aria-hidden>›</span>
          <span className="leaf">{t.action}</span>
        </span>
      } />

      {/* SAVE AND UNDO, kept in view - and only in view when there is
          something to save or take back (Shahar, 2026-09-17: "Hide both Save
          and Nothing to save unless there are changes to the form"). Exit is
          gone: it went where the back arrow goes. */}
      {!closed && t.can_edit && (
        <TaskBar formId="task-form" taskId={id} justSaved={!!ok} />
      )}
      <div className="body">
        {/* "Not saved." IS A LIE WHEN SOMETHING WAS. Shahar, 2026-09-21, on a
            screen showing both banners at once: the status note had saved and
            the close had been refused, so the page said "Not saved." directly
            above "Saved: status." Both were true and together they read as a
            broken screen. An update here is several writes - a note, a status
            line, a stage - and they do not all fail together, so the title
            says which case it is. */}
        {error && (
          <Notice kind="error" title={ok ? "The rest was not saved." : "Not saved."}>{error}</Notice>
        )}
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

        {/* THE TASK LINE - without the name. Shahar (2026-09-17): "the second
            panel 'Keep the ...' is already listed on top, you can remove the
            2nd panel text, keeping the task creator, priority and date." The
            name is the crumb now, said once; what stays is the line under it -
            who holds it, how much it matters, when it is due - and the two
            words on its right: Edit, Remove. They replaced a gear and an i he
            found "really small" and empty of anything new; what the gear held
            that still needs a door is "Edit", what he asked for next -
            "allow me to remove [tasks], but confirm before deletion is done"
            - is "Remove". */}
        <div className="hero task-lead">
          <p className="lead grow">
            {[
              t.holder?.name
                ? (t.holder.kind === "assistant" ? `${t.holder.name} · assistant` : t.holder.name)
                : "nobody holds this",
              t.priority && t.priority !== "Missing" ? `${t.priority} priority` : null,
              t.target_date ? `${late ? "was due" : "due"} ${shortDate(t.target_date)}` : "no date",
              closed ? t.status : null,
            ].filter(Boolean).join(" · ")}
            {/* Who opened it and when, where the opener was a person rather
                than a blueprint or an import - the "creator" he asked to
                keep. created_by is a free-text name (rulebook: the database
                carries the words), so a system: prefix is the tell. */}
            {t.created_by && !/^(system:|log_import)/.test(t.created_by) && (
              <span className="opened">
                opened by {t.created_by}{t.created_at ? ` · ${shortDate(t.created_at.slice(0, 10))}` : ""}
              </span>
            )}
          </p>
          {!closed && t.can_edit && (
            <span className="task-acts">
              <Link href={setup ? flag({}) : flag({ setup: "1" })}
                className={`task-act${setup ? " on" : ""}`}>{setup ? "Done editing" : "Edit"}</Link>
              <Link href={remove ? flag({}) : flag({ remove: "1" })}
                className={`task-act danger${remove ? " on" : ""}`}>{remove ? "Keep it" : "Remove"}</Link>
            </span>
          )}
        </div>

        {/* What done looks like, said where the name is, when somebody wrote
            it. It used to hide behind the i. */}
        {!closed && t.can_edit && t.desired_outcome && !setup && (
          <p className="small" style={{ margin: "-4px 0 0" }}>
            <span className="text-muted">Done looks like:</span> {t.desired_outcome}
          </p>
        )}

        {/* REMOVE, WITH THE QUESTION ASKED FIRST. Shahar (2026-09-17): "there
            are cases i can already see tasks are created but not required.
            i'd like to remove them - allow me to do so, but confirm before
            deletion is done." Two ways out, and the difference said plainly:
            calling it off keeps the record with the reason; deleting pretends
            it was never entered, and the database allows that only on a task
            nothing hangs off. The tick is the confirmation; without it the
            delete button does nothing but ask again. */}
        {!closed && t.can_edit && remove && (
          <form action={deleteTask} className="card pad stack" style={{ gap: 10, borderColor: "var(--color-danger)" }}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="back" value={to} />
            <div>
              <div className="small" style={{ fontWeight: 800 }}>Remove “{t.action}”?</div>
              <div className="tiny text-muted" style={{ marginTop: 2 }}>
                Nothing happens until you choose one of these. <Link href={flag({})}>Keep it</Link> puts this away.
              </div>
            </div>
            <label className="field">
              <span className="field-label">Why it will not happen <span className="text-muted">(optional, kept on the record if you call it off)</span></span>
              <input className="input" name="cancel_reason" placeholder="Scope changed · done by someone else · not needed" />
            </label>
            <button formAction={cancelTask} formNoValidate className="btn btn-secondary btn-block">
              Call it off — keep the record
            </button>
            <label className="gate-tick">
              <input type="checkbox" name="delete_confirm" value="1" />
              <span className="grow">
                <span className="t">Delete it for good</span>
                <span className="m">
                  It was entered by mistake and there is nothing to keep. Refused once a note, a file, a step or a
                  payment hangs off it — call it off instead.
                </span>
              </span>
            </label>
            <button formNoValidate className="btn btn-ghost btn-block btn-danger">Delete this task</button>
          </form>
        )}

        {/* WHAT IS ATTACHED. Shahar (2026-09-15), opening a task he had just
            made with a photograph on it: "why don't you show it here on the
            task?"

            Because nothing ever has. The files linked straight to the action
            were counted - that count is what satisfies the photo gate - and
            never drawn. Notes render theirs; the task's own have been
            invisible since the new-task screen learned to take attachments.

            Near the top, because a photograph of the thing is the fastest
            sentence on the screen. The caption under each one is what was
            typed when it was attached: a picture called "the panel, showing
            the amperage" is worth reading, the same picture called
            IMG_5915.png is not. */}
        {t.evidence.length > 0 && (
          <section className="stack" style={{ gap: 6 }}>
            <div className="divider-label" style={{ padding: 0 }}>
              Attached · {t.evidence.length}
            </div>
            <div className="proofs">
              {t.evidence.map((f) => {
                const url = noteUrls[f.path];
                const label = f.caption?.trim() || f.file_name || "Attachment";
                return (
                  <figure className="proof-card" key={f.id}>
                    {f.kind === "photo" && url ? (
                      <a href={url} target="_blank" rel="noreferrer" className="shot-link">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt={label} />
                      </a>
                    ) : f.kind === "audio" && url ? (
                      <audio src={url} controls preload="metadata" style={{ width: "100%", height: 34 }} />
                    ) : (
                      <a href={url ?? "#"} target="_blank" rel="noreferrer" className="file-link">
                        <span aria-hidden>{f.kind === "video" ? "🎬" : f.kind === "document" ? "📄" : "📎"}</span>
                        <span className="grow" style={{ minWidth: 0 }}>{f.file_name ?? "File"}</span>
                      </a>
                    )}
                    <figcaption>
                      {f.caption?.trim()
                        ? f.caption
                        : <span className="text-muted">{f.file_name}</span>}
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          </section>
        )}

        {/* WHAT IS IN IT. Shahar (2026-09-15): "when showing tasks as
            containers, the top part of the task should list all its kids
            tasks."

            It used to say "1 step still open beneath this" and stop there - a
            count is the one fact about a container that cannot be acted on. On
            a task whose NAME is a sequence, "design, permit, order", that is
            absurd. The list is in the blueprint's own order with the finished
            ones in place, because that is how a checklist is read.

            The gate sentence is only said where there is a gate, and it names
            it. It used to be said under every count, about no child in
            particular. */}
        {t.children.length > 0 && (
          <section className="stack" style={{ gap: 6 }}>
            <div className="bucket">
              <span className="h">
                {t.children.length === 1 ? "The step in this" : `The ${t.children.length} steps in this`}
              </span>
              <span className="n">
                {t.open_children === 0
                  ? "all done"
                  : `${t.open_children} open`}
              </span>
            </div>
            <div className="bucket-rows">
              {t.children.map((k) => (
                <Link key={k.id} href={`/task/${k.id}?back=${encodeURIComponent(flag({}))}`}
                  className={k.open ? undefined : "done"}>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="t">{k.action}</span>
                    <span className="m">
                      {[
                        k.holder,
                        k.open ? (k.status !== "Not Started" ? k.status : null) : k.status.toLowerCase(),
                        k.open && k.target_date ? `due ${shortDate(k.target_date)}` : null,
                        !k.open && k.completed_on ? shortDate(k.completed_on) : null,
                        k.open_children > 0 ? `${k.open_children} beneath` : null,
                        k.is_gate ? "blocks this one" : null,
                      ].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </span>
                  {k.open && k.target_date && k.target_date < todayISO() && (
                    <span className="tag tag-status" style={{ whiteSpace: "nowrap" }}>late</span>
                  )}
                </Link>
              ))}
            </div>
            {t.children.some((k) => k.open && k.is_gate) && (
              <p className="tiny text-muted" style={{ margin: 0 }}>
                This task cannot close while a step marked <strong>blocks this one</strong> is open — the database
                refuses it, not the screen.
              </p>
            )}
          </section>
        )}

        {/* A STEP UNDER THIS ONE (Shahar, 2026-09-14: "inside each task, add
            an option to create sub-task") lives in the Assigned to · Payment ·
            Steps row inside the form now (2026-09-17), where it can go quiet
            while the form has unsaved edits. A simple task says so on the
            same button rather than in a paragraph here. */}

        {/* HOW IT FITS. Shahar (2026-09-15): "allow to create dependencies
            between tasks : after ... or before ... / allow a task to point to
            a parent task."

            Three facts, in the words somebody standing on a site would use:
            what this is a step OF, what it waits ON, and what is waiting on
            IT. After and before are one edge seen from two ends - the
            database decides which row it writes (migration 130) - so the
            screen can offer both without pretending they are different kinds
            of link.

            These forms post to linkTask, not to the page's own save, so they
            sit outside the big form below: a form inside a form is not a
            thing, and each of these is one decision that takes effect at
            once. */}
        {(fits || (!closed && t.can_edit)) && (
          <Card soft pad>
            <div className="between" style={{ alignItems: "baseline", gap: 10 }}>
              <span className="kicker" style={{ margin: 0 }}>Dependencies in project</span>
              {!closed && t.can_edit && (
                <Link href={fit ? flag({}) : flag({ fit: "1" })} className="small" style={{ fontWeight: 700 }}>
                  {fit ? "Close" : fits ? "Change" : "Set it"}
                </Link>
              )}
            </div>

            {fits ? (
              <div className="stack" style={{ gap: 3, marginTop: 6 }}>
                {/* PART OF answers two things, and the scope line is the more
                    useful one on a real job: the priced item this task exists
                    to deliver (Shahar, 2026-09-16). It has been on
                    actions.scope_item_id all along and this screen never
                    asked. */}
                {t.scope && (
                  <div className="fit-line">
                    <span className="k">Part of scope</span>
                    <span className="v">
                      {[t.scope.trade, t.scope.item ?? t.scope.category].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                )}
                {t.parent && <FitLine label="Part of" x={t.parent} back={to} />}
                {t.follows && <FitLine label="Comes after" x={t.follows} back={to} />}
                {t.blocks.map((b) => <FitLine key={b.id} label="Comes before" x={b} back={to} />)}
              </div>
            ) : (
              <p className="tiny text-muted" style={{ margin: "4px 0 0" }}>
                {t.scope
                  ? <>Part of the scope line <strong>{[t.scope.trade, t.scope.item ?? t.scope.category].filter(Boolean).join(" · ")}</strong>. It waits on nothing and nothing waits on it.</>
                  : <>It waits on nothing and nothing waits on it.</>}
              </p>
            )}

            {fit && !closed && t.can_edit && (
              <div className="stack" style={{ gap: 12, marginTop: 12 }}>
                {t.link_options.length === 0 ? (
                  <p className="tiny text-muted" style={{ margin: 0 }}>
                    There is nothing else on this job to link to yet.
                  </p>
                ) : (
                  <>
                    <LinkPicker id={id} back={to} rel="parent" label="Part of"
                      hint="The task this one is a step of. It then sits under it in every list."
                      current={t.parent?.id ?? ""} options={t.link_options} clearable />
                    <LinkPicker id={id} back={to} rel="after" label="Comes after"
                      hint="The one thing that has to happen before this can start."
                      current={t.follows?.id ?? ""} options={t.link_options} clearable />
                    <LinkPicker id={id} back={to} rel="before" label="Comes before"
                      hint="Something that cannot start until this is done. Add as many as you like."
                      current="" options={t.link_options.filter((o) => !t.blocks.some((b) => b.id === o.id))} />
                    {/* CANCEL THE SETUP (Shahar, 2026-09-16). Each row above
                        saves on its own, so leaving the panel never un-saved
                        anything - undoing an arrangement meant clearing each
                        link in turn. One button, one move. */}
                    {(t.parent || t.follows || t.blocks.length > 0) && (
                      <form action={linkTask} className="between" style={{ gap: 8, alignItems: "center" }}>
                        <input type="hidden" name="id" value={id} />
                        <input type="hidden" name="back" value={to} />
                        <input type="hidden" name="rel" value="clear" />
                        <span className="tiny text-muted grow" style={{ minWidth: 0 }}>
                          Take it all off — what it is part of, what it waits on, and everything waiting on it.
                        </span>
                        <button className="btn btn-secondary small" style={{ minHeight: 34, flex: "none" }}>
                          Clear all
                        </button>
                      </form>
                    )}

                    {t.blocks.length > 0 && (
                      <div className="stack" style={{ gap: 4 }}>
                        <div className="divider-label" style={{ padding: 0 }}>Waiting on this</div>
                        {t.blocks.map((b) => (
                          <form key={b.id} action={linkTask} className="between" style={{ gap: 8 }}>
                            <input type="hidden" name="id" value={id} />
                            <input type="hidden" name="back" value={to} />
                            <input type="hidden" name="rel" value="unbefore" />
                            <input type="hidden" name="other" value={b.id} />
                            <span className="small grow" style={{ minWidth: 0 }}>{b.action}</span>
                            <button className="btn btn-ghost small" style={{ minHeight: 32 }}>Unlink</button>
                          </form>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </Card>
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

        {(closed || !t.can_edit) && t.status_note && (
          <Notice kind="info" title="Where this stands">{t.status_note}</Notice>
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
          <form id="task-form" action={saveTask} className="stack" style={{ gap: 18 }}>
            <input type="hidden" name="id" value={t.id} />
            <input type="hidden" name="back" value={to} />

            {/* ---- THE SET-UP DRAWER, behind the gear ------------------
                What the task IS, rather than where it has got to: its name,
                what done looks like, and the two ways it can end. Shahar
                (2026-09-14): "have a gear icon next to it to allow enter the
                task setup, define what good looks like, cancel and delete
                it." Out of the way, because you set it once and then spend
                weeks on the lines below. */}
            {t.can_edit && (
              <>
                <input type="hidden" name="has_fields" value="1" />
                {setup && (
                  <section className="stack" style={{ gap: 10 }}>
                    {/* Tells the action the name and the outcome are actually
                        on the page. Without it a closed drawer would send them
                        blank and wipe both. */}
                    <input type="hidden" name="has_setup" value="1" />
                    <div className="divider-label">Task set-up</div>
                    <label className="field">
                      <span className="field-label">Task</span>
                      <input className="input" name="action" defaultValue={t.action} required maxLength={300} />
                    </label>
                    <label className="field">
                      <span className="field-label">Done looks like <span className="text-muted">(the end state, not the work)</span></span>
                      <textarea className="input" name="desired_outcome" rows={3} defaultValue={t.desired_outcome ?? ""} />
                    </label>
                    {/* Cancelling and deleting moved out from under the gear
                        to the Remove card by the name (2026-09-17). */}
                  </section>
                )}
              </>
            )}

            {/* ---- WHERE IT HAS GOT TO --------------------------------
                One line per thing, label on the left and the control on the
                right. Status is where it stands and stays on the task; Log
                progress is what happened today and posts to the record. */}
            <section className="stack" style={{ gap: 0 }}>
              {/* SET-UP IS SET-UP, not the day's work. Shahar (2026-09-14):
                  "update task settings, remove Log a payment section, Status
                  & Log process." The gear is for what the task IS - its name,
                  what done looks like, how it ends - and the three things
                  you do to it every day would only be noise in there. They
                  come back the moment the gear closes; what stays on both
                  views is what you SET on a task: its stage, priority, who
                  holds it and when it is due. */}
              {t.can_edit && !setup && (
                <Row label="Status" hint="where it stands">
                  {/* Says the Status box is actually on the page. Without it
                      the set-up view would post an empty status_note and wipe
                      whatever was there - the same trap as the name and the
                      outcome above. */}
                  <input type="hidden" name="has_status" value="1" />
                  <input className="input" name="status_note" defaultValue={t.status_note ?? ""}
                    placeholder="Waiting on Steve at Andersen for the revised quote" />
                </Row>
              )}

              {/* LOG PROGRESS TAKES THE WHOLE WIDTH. Shahar (2026-09-17):
                  "show the text above the window, but make the window all
                  the width with 3 buttons under." A box you write a
                  paragraph in was sharing its row with its own label; the
                  label now sits above, and the box and the three ways to
                  attach proof under it - camera, file or image, voice - run
                  edge to edge. A div, not a label: Evidence carries buttons,
                  and a click on a button inside a label goes to the label's
                  control. */}
              {!setup && (
                <div className="task-row stacked">
                  <span className="task-row-label">
                    Log progress
                    <span className="text-muted" style={{ display: "inline", fontWeight: 400 }}> · posts to the record</span>
                  </span>
                  <div className="task-row-value">
                    <NoteBox projectId={t.project_id} />
                  </div>
                </div>
              )}

              {t.can_edit && (
                <>
                  {/* THREE ACROSS (Shahar, 2026-09-16: "Stage and priority on
                      one line"; 2026-09-17: "remove [the left label], it is
                      listed already above the drop down. instead have 3 items
                      in the same row, adding target completion date"). Each
                      cell wears its own name; the row needs none. */}
                  <div className="task-row" style={{ gridTemplateColumns: "1fr" }}>
                    <div className="task-row-value triple">
                      <label className="field">
                        <span className="field-label">Stage</span>
                        <select className="input" name="status" defaultValue={stageShown}>
                          {STAGES.map((x) => <option key={x} value={x}>{x}</option>)}
                        </select>
                      </label>
                      <label className="field">
                        <span className="field-label">Priority</span>
                        <select className="input" name="priority" defaultValue={prioShown}>
                          {PRIORITIES.map((x) => <option key={x} value={x}>{x === "Missing" ? "Not set" : x}</option>)}
                        </select>
                      </label>
                      <label className="field">
                        <span className="field-label">Completion target</span>
                        <input className="input" name="target_date" type="date" defaultValue={t.target_date ?? ""} />
                      </label>
                    </div>
                  </div>

                  {/* WHO · PAYMENT · STEPS, one row; the payment box opens under
                      it. The step button goes quiet while the form is dirty
                      (TaskActionsRow). */}
                  <TaskActionsRow formId="task-form"
                    stepHref={!closed && t.project_id
                      ? `/project/${t.project_id}/task/new?parent=${t.id}&back=${encodeURIComponent(`/task/${t.id}?back=${encodeURIComponent(to)}`)}`
                      : null}
                    acceptsSteps={t.accepts_steps}
                    canLogPayment={t.can_log_payment && !setup}
                    payOpen={money === "1"}
                    payment={t.can_log_payment && !setup
                      ? <PaymentBox projectId={t.project_id} methods={t.methods} accounts={accounts}
                          people={people.map((x) => ({ contact_id: x.contact_id, name: x.name }))} />
                      : null}>
                    <select className="input" name="assignee" defaultValue={t.assignee?.id ?? ""}>
                      <option value="">Nobody yet</option>
                      {people.map((x) => (
                        <option key={x.contact_id} value={x.contact_id}>{x.me ? `${x.name} (me)` : x.name}{x.seat ? ` · ${x.seat}` : ""}</option>
                      ))}
                    </select>
                  </TaskActionsRow>
                </>
              )}
            </section>

            {/* Only when the database has actually refused - see askWhy.
                Choosing Completed in Stage is what closes a task now, so this
                is where the "nothing attached" question lands. */}
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

            {/* ONE LINE OF BUTTONS. Commit takes the WHOLE screen with it -
                the status, the progress note and its files, the dropdowns and
                the payment below. Shahar (2026-09-14): "Post the update and
                Post it & mark complete becomes a duplicate if i understand
                correctly and can be removed." He was right on both. Marking
                complete is Stage → Completed, which goes through the same
                gate the button used to, so a second button only offered a
                second way to do one thing. Cancel changes stays and the
                bar's Exit went (2026-09-17): the two were one thing, and
                this is the one that says what it does to the form. */}
            <div className="row" style={{ gap: 8 }}>
              <button name="do" value="save" className="btn btn-primary grow">Commit updates</button>
              <Link href={`/task/${t.id}?back=${encodeURIComponent(to)}`} className="btn btn-ghost grow">Cancel changes</Link>
            </div>

            {/* WHAT IT COST (migration 065) is the payment box under the
                Assigned to · Payment · Steps row above - still inside this
                form, so an amount in it goes with whichever button is pressed. */}
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
