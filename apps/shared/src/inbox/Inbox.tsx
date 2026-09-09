import Link from "next/link";
import { Card, ChevronIcon, Notice } from "../ui";
import { shortDate } from "../format";
import { TaskSheet } from "../TaskSheet";
import { Compose } from "./Compose";
import { messageSeen, messageSend, messageSet, messageToTask } from "./actions";
import type { InboxData, InboxTask, Msg, MsgKind } from "./data";

// ONE INBOX, EVERY DOOR.
//
// Shahar: "all inbox views across the board for every door needs to look
// similar unless i say otherwise" - and, on tasks and messages: "are you
// thinking that a task and a message look alike? if so, next to every email
// we need: update, reply, archive, complete."
//
// Yes: they look alike, because to the person reading them they ARE alike.
// Both are a line in a list that says someone or something needs you, and
// both open to show more and offer a few verbs. So a task and a message
// render as the same row - one closed line, Outlook-style; expand for the
// body, the picture and the buttons - and the buttons are drawn from one
// set, shown when they apply:
//
//   Update    it is a task, or a message about one: the sheet, with proof
//   Reply     it is from a person you can write back to
//   Archive   file it; it is not deleted and not lost
//   Complete  it is a task, or a message about one: the sheet, closing it
//
// Delete is not in the set. It destroyed our record of things that are still
// live elsewhere in the database, and archiving does what a person wants.
//
// Everything reads and writes through the same functions from every app, so
// a message archived here is archived everywhere - one inbox seen through
// several doors, not several inboxes.
const when = (t: string) =>
  new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function InboxScreen({
  data, base, tasks = [], taskBase, projectHref, offerHref,
}: {
  data: InboxData;
  base: string;                              // this app's inbox path
  tasks?: InboxTask[];                       // open tasks, as rows in the same list
  taskBase?: string;                         // where a task made here lives
  projectHref?: (id: string) => string;      // how this app links a project
  offerHref?: (id: string) => string;        // how this app opens an offer
}) {
  const { messages, invites, failed } = data;
  // The headline counts what CAME to you. What you sent is a folder below.
  const received = messages.filter((m) => !m.mine);
  const waiting = received.filter((m) => m.pending);
  const invitations = invites.incoming.length + invites.outcomes.length;
  const n = received.length + tasks.length;

  return (
    <>
      {failed && <Notice kind="error" title="We couldn&apos;t load your messages.">Try again in a moment.</Notice>}

      <div className="hero">
        <h1>Inbox</h1>
        <p className="lead">
          {n === 0
            ? "Nothing waiting. Messages and tasks about your projects land here."
            : [
                received.length ? `${received.length} ${received.length === 1 ? "message" : "messages"}` : null,
                tasks.length ? `${tasks.length} open ${tasks.length === 1 ? "task" : "tasks"}` : null,
                waiting.length ? `${waiting.length} waiting on you` : null,
              ].filter(Boolean).join(" · ") + "."}
        </p>
      </div>

      {/* Invitations first: they are the only thing here that expires. */}
      {invitations > 0 && (
        <section className="stack" style={{ gap: 8 }}>
          <div className="divider-label">Invitations · {invitations}</div>
          {invites.incoming.map((i) => (
            <Card pad key={i.id} className="tight">
              <div className="card-title" style={{ fontSize: 15 }}>{i.project_name}</div>
              <div className="small text-muted">
                {i.by ?? "Someone"} invited you as {i.seat ?? "a member"}.
              </div>
              {i.message && <p className="small" style={{ margin: "6px 0 0" }}>{i.message}</p>}
            </Card>
          ))}
          {invites.outcomes.map((o) => (
            <Card soft pad key={o.id} className="tight">
              <div className="small text-muted">
                {o.who ?? "They"} {o.status} your invitation to <strong>{o.project_name}</strong>.
              </div>
            </Card>
          ))}
        </section>
      )}

      <Messages data={data} base={base} tasks={tasks} taskBase={taskBase} projectHref={projectHref} offerHref={offerHref} />
    </>
  );
}

// The list half on its own, for an app whose inbox already has a shape of
// its own around it. The homeowner app is the case: its inbox carries photo
// nags, offer questions and invitations of its own above this - so the list
// is ADDED there rather than swapped in, and nothing that was working stops.
export function Messages({
  data, base, tasks = [], taskBase, projectHref, offerHref, heading = "Messages",
}: {
  data: InboxData; base: string; tasks?: InboxTask[]; taskBase?: string;
  projectHref?: (id: string) => string; offerHref?: (id: string) => string; heading?: string;
}) {
  const { messages, targets } = data;
  const offers = new Set(data.offers ?? []);
  const urls = data.fileUrls ?? {};
  // AN INBOX IS FOR WHAT CAME TO YOU. Sent messages were mixed into the same
  // list, so a person opening the inbox read their own words back first -
  // and on a quiet account that was the ONLY thing in it. They keep their
  // record, behind a folder, the way every mail client has done it for
  // thirty years.
  const received = messages.filter((m) => !m.mine);
  const sent = messages.filter((m) => m.mine);
  const waitingR = received.filter((m) => m.pending);
  const restR = received.filter((m) => !m.pending);

  const row = (m: Msg) => (
    <Row key={m.id} m={m} base={base} taskBase={taskBase} projectHref={projectHref}
      offer={offerHref && m.project_id && offers.has(m.project_id) ? offerHref(m.project_id) : null}
      url={m.file ? urls[m.file.path] ?? null : null} />
  );

  return (
    <>
      {waitingR.length > 0 && (
        <section className="stack" style={{ gap: 8 }}>
          <div className="divider-label">Waiting on you · {waitingR.length}</div>
          {waitingR.map(row)}
        </section>
      )}

      {/* OPEN TASKS, as rows in the same list, in the same clothes. Late
          first, then soonest, then the undated - and the ones assigned to
          nobody read as unassigned rather than pretending to be yours. */}
      {tasks.length > 0 && (
        <section className="stack" style={{ gap: 8 }}>
          <div className="divider-label">Open tasks · {tasks.length}</div>
          {[...tasks]
            .sort((a, b) => (a.target_date ?? "9999").localeCompare(b.target_date ?? "9999") || a.action.localeCompare(b.action))
            .map((t) => <TaskRow key={t.id} t={t} taskBase={taskBase} projectHref={projectHref} />)}
        </section>
      )}

      <section className="stack" style={{ gap: 8 }}>
        <div className="divider-label">{heading}{received.length ? ` · ${received.length}` : ""}</div>
        {received.length === 0 && (
          <Card soft pad><div className="small">Nothing in your inbox. Messages about your projects land here.</div></Card>
        )}
        {restR.map(row)}
      </section>

      {/* Sent: a folder, not a section of the inbox. Shut, counted, and one
          tap away when you want to check what you actually said. */}
      {sent.length > 0 && (
        <details className="home-panel">
          <summary className="home-row">
            <span className="ic" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12l16-8-6 16-2.5-6z" />
              </svg>
            </span>
            <span className="grow" style={{ minWidth: 0 }}>
              <span className="t">Sent</span>
              <span className="m" style={{ display: "block" }}>{sent.length} {sent.length === 1 ? "message" : "messages"} you wrote</span>
            </span>
            <span className="chev"><ChevronIcon /></span>
          </summary>
          <div className="drawer stack" style={{ gap: 8, paddingTop: 12 }}>
            {sent.map(row)}
          </div>
        </details>
      )}

      <Card pad><Compose targets={targets} base={base} /></Card>
    </>
  );
}

// A TASK, AS A ROW. Same closed line as a message - what, where, when, a dot
// if it is late - and the same two task verbs a message about a task gets.
function TaskRow({ t, taskBase, projectHref }: { t: InboxTask; taskBase?: string; projectHref?: (id: string) => string }) {
  const today = new Date().toISOString().slice(0, 10);
  const late = !!t.target_date && t.target_date < today;
  const meta = [
    t.project,
    t.assignee ?? "unassigned",
    t.target_date ? `${late ? "was due" : "due"} ${shortDate(t.target_date)}` : null,
    t.status !== "Not Started" ? t.status : null,
  ].filter(Boolean).join(" · ");

  return (
    <Card pad={false} className={late ? "msg unread" : "msg"}>
      <details>
        <summary className="msg-head">
          <span className="grow" style={{ minWidth: 0 }}>
            <span className="msg-from">
              Task<span className="tag tag-neutral" style={{ marginLeft: 8 }}>{late ? "Late" : "Open"}</span>
            </span>
            <span className="msg-subject">{t.action}</span>
            <span className="msg-meta">{meta}</span>
          </span>
          {late && <span className="msg-dot" aria-label="Late" />}
        </summary>
        <div className="msg-body">
          {t.project_id && projectHref && (
            <p className="tiny text-muted" style={{ margin: "0 0 10px" }}>
              On <Link href={projectHref(t.project_id)}>{t.project ?? "a project"}</Link>
              {taskBase && <> · <Link href={`${taskBase}/${t.id}`}>Open the task</Link></>}
            </p>
          )}
          {/* UPDATE and COMPLETE: the same sheet, entered from either end.
              No Reply - a task is not from anyone - and no Archive: a task
              that is open is open, and closing it is what Complete is for. */}
          {t.project_id && (
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              <TaskSheet projectId={t.project_id} actionId={t.id} title={t.action}
                trigger={<button type="button" className="btn btn-primary small">Update</button>} />
              <TaskSheet projectId={t.project_id} actionId={t.id} title={t.action} completeFirst
                trigger={<button type="button" className="btn btn-secondary small">Complete</button>} />
            </div>
          )}
        </div>
      </details>
    </Card>
  );
}

// A MESSAGE, AS A ROW. Closed: who it is with, the subject line, when.
// Everything else - the body, the picture, the verbs - waits behind the
// disclosure, because an inbox is a list you scan and only sometimes read.
const KIND_TAG: Record<MsgKind, { label: string; tone: string } | null> = {
  bid: { label: "Offer", tone: "tag-status" },
  question: { label: "Question", tone: "tag-outline" },
  task: { label: "Task", tone: "tag-neutral" },
  system: { label: "Green Bergen", tone: "tag-neutral" },
  note: null,
};

function Row({
  m, base, taskBase, projectHref, offer, url,
}: {
  m: Msg; base: string; taskBase?: string; projectHref?: (id: string) => string;
  // Where this app opens an offer, when the message is about one.
  offer?: string | null;
  // A signed URL for an attached image, already fetched for the whole page.
  url?: string | null;
}) {
  const tag = KIND_TAG[m.kind];
  const rest = m.body.slice(m.subject.length).trim();
  const canReply = !m.mine && !!m.with_contact_id && !!m.project_id && (m.kind === "note" || m.kind === "task");
  // A message ABOUT a task gets the task's verbs too: Update and Complete
  // open the same sheet a task row does, on the task it names.
  const aboutTask = !!m.action_id && !!m.project_id;

  return (
    <Card pad={false} className={m.pending ? "msg unread" : "msg"}>
      <details>
        <summary className="msg-head">
          <span className="grow" style={{ minWidth: 0 }}>
            <span className="msg-from">
              {m.mine ? `To ${m.who}` : m.who}
              {tag && <span className={`tag ${tag.tone}`} style={{ marginLeft: 8 }}>{tag.label}</span>}
            </span>
            <span className="msg-subject">{m.subject || "(no subject)"}</span>
            <span className="msg-meta">
              {[m.project_name, when(m.sent_at), m.file ? "1 attachment" : null].filter(Boolean).join(" · ")}
            </span>
          </span>
          {m.pending && <span className="msg-dot" aria-label="Unread" />}
        </summary>

        <div className="msg-body">
          {rest && <p className="small" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{rest}</p>}
          {m.action && <p className="tiny text-muted" style={{ margin: "8px 0 0" }}>About the task: {m.action}</p>}

          {/* The picture, when there is one. A document is a filename. */}
          {m.file && (url
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={url} alt={m.file.name ?? "Attachment"} style={{ width: "100%", borderRadius: 10, marginTop: 10, display: "block" }} />
            : <p className="tiny text-muted" style={{ margin: "8px 0 0" }}>Attached: {m.file.name ?? m.file.kind ?? "a file"}</p>)}

          {m.project_name && m.project_id && projectHref && !offer && (
            <p className="tiny text-muted" style={{ margin: "8px 0 0" }}>
              <Link href={projectHref(m.project_id)}>{m.project_name}</Link>
            </p>
          )}

          <div className="row" style={{ gap: 6, marginTop: 12, flexWrap: "wrap" }}>
            {m.mine ? (
              // Yours: you sent it. Filing it is the only thing left.
              <form action={messageSet}>
                <input type="hidden" name="base" value={base} />
                <input type="hidden" name="id" value={m.id} />
                <input type="hidden" name="status" value="dismissed" />
                <button className="btn btn-ghost small">Archive</button>
              </form>
            ) : (
              <>
                {offer && <Link href={offer} className="btn btn-primary small">
                  {m.kind === "question" ? "Open the job" : "Open the offer"}
                </Link>}
                {aboutTask && (
                  <>
                    <TaskSheet projectId={m.project_id!} actionId={m.action_id!} title={m.action ?? m.subject}
                      trigger={<button type="button" className="btn btn-primary small">Update</button>} />
                    <TaskSheet projectId={m.project_id!} actionId={m.action_id!} title={m.action ?? m.subject} completeFirst
                      trigger={<button type="button" className="btn btn-secondary small">Complete</button>} />
                  </>
                )}
                {m.pending && !aboutTask && (
                  <form action={messageSeen}>
                    <input type="hidden" name="base" value={base} />
                    <input type="hidden" name="id" value={m.id} />
                    <input type="hidden" name="handled" value="0" />
                    <button className="btn btn-secondary small">Mark read</button>
                  </form>
                )}
                <form action={messageSet}>
                  <input type="hidden" name="base" value={base} />
                  <input type="hidden" name="id" value={m.id} />
                  <input type="hidden" name="status" value="dismissed" />
                  <button className="btn btn-ghost small">{offer ? "Ignore" : "Archive"}</button>
                </form>
              </>
            )}
          </div>

          {/* Reply, to a person, about the project you already share. An
              offer is not replied to here - it is answered on the offer. */}
          {canReply && (
            <form action={messageSend} className="stack" style={{ gap: 8, marginTop: 10 }}>
              <input type="hidden" name="base" value={base} />
              <input type="hidden" name="project" value={m.project_id!} />
              <input type="hidden" name="to" value={m.with_contact_id!} />
              {/* A reply about a task stays about that task. */}
              {m.action_id && <input type="hidden" name="action_id" value={m.action_id} />}
              <textarea className="input" name="body" rows={2} required placeholder={`Reply to ${m.who}…`} />
              <button className="btn btn-secondary btn-block">Reply</button>
            </form>
          )}

          {!offer && m.kind !== "bid" && !m.action_id && (
            <details style={{ marginTop: 10 }}>
              <summary className="tiny text-muted" style={{ cursor: "pointer" }}>Turn this into a task</summary>
              <form action={messageToTask} className="stack" style={{ gap: 8, marginTop: 8 }}>
                <input type="hidden" name="base" value={base} />
                {taskBase && <input type="hidden" name="taskBase" value={taskBase} />}
                <input type="hidden" name="id" value={m.id} />
                <input className="input" name="action" placeholder="What has to be done?" required />
                <input className="input" name="due" type="date" aria-label="Due date" />
                <button className="btn btn-secondary btn-block">Create the task</button>
              </form>
            </details>
          )}
        </div>
      </details>
    </Card>
  );
}
