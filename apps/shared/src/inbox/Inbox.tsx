import Link from "next/link";
import { Card, Notice } from "../ui";
import { Compose } from "./Compose";
import { messageSeen, messageSend, messageSet, messageToTask } from "./actions";
import type { InboxData, Msg, MsgKind } from "./data";

// One inbox, four apps. The portal's model, in Warm Ink: what came to you and
// what you sent in one thread of time, the invitations still waiting on an
// answer, and a way to write back. Everything reads and writes through the
// portal_message_* functions, so a message marked done in the builder app is
// done in the homeowner app too - there is one inbox, seen through four
// doors, not four inboxes.
const when = (t: string) =>
  new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function InboxScreen({
  data, base, taskBase, projectHref, offerHref,
}: {
  data: InboxData;
  base: string;                              // this app's inbox path
  taskBase?: string;                         // where a task made here lives
  projectHref?: (id: string) => string;      // how this app links a project
  offerHref?: (id: string) => string;        // how this app opens an offer
  show?: string;
}) {
  const { messages, invites, failed } = data;
  const waiting = messages.filter((m) => m.pending);
  const invitations = invites.incoming.length + invites.outcomes.length;

  return (
    <>
      {failed && <Notice kind="error" title="We couldn&apos;t load your messages.">Try again in a moment.</Notice>}

      <div className="hero">
        <h1>Inbox</h1>
        <p className="lead">
          {messages.length === 0
            ? "Nothing yet. Messages about your projects land here."
            : `${messages.length} ${messages.length === 1 ? "message" : "messages"}${waiting.length ? ` · ${waiting.length} waiting on you` : ""}.`}
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

      <Messages data={data} base={base} taskBase={taskBase} projectHref={projectHref} offerHref={offerHref} />
    </>
  );
}

// The message half on its own, for an app whose inbox already has a shape of
// its own. The homeowner app is the case: its inbox carries booking
// conversations, invitations and open tasks, none of which live in
// portal_my_messages - so the portal's messages are ADDED there rather than
// swapped in, and nothing that was working stops working.
export function Messages({
  data, base, taskBase, projectHref, offerHref, heading = "Messages",
}: {
  data: InboxData; base: string; taskBase?: string;
  projectHref?: (id: string) => string; offerHref?: (id: string) => string; heading?: string;
}) {
  const { messages, targets } = data;
  const offers = new Set(data.offers ?? []);
  const urls = data.fileUrls ?? {};
  const waiting = messages.filter((m) => m.pending);
  return (
    <>
      {waiting.length > 0 && (
        <section className="stack" style={{ gap: 8 }}>
          <div className="divider-label">Waiting on you · {waiting.length}</div>
          {waiting.map((m) => <Row key={m.id} m={m} base={base} taskBase={taskBase} projectHref={projectHref}
            offer={offerHref && m.project_id && offers.has(m.project_id) ? offerHref(m.project_id) : null}
            url={m.file ? urls[m.file.path] ?? null : null} />)}
        </section>
      )}

      <section className="stack" style={{ gap: 8 }}>
        <div className="divider-label">{heading} · {messages.length}</div>
        {messages.length === 0 && (
          <Card soft pad><div className="small">No messages yet.</div></Card>
        )}
        {messages.filter((m) => !m.pending).map((m) => (
          <Row key={m.id} m={m} base={base} taskBase={taskBase} projectHref={projectHref}
            offer={offerHref && m.project_id && offers.has(m.project_id) ? offerHref(m.project_id) : null}
            url={m.file ? urls[m.file.path] ?? null : null} />
        ))}
      </section>

      <section className="stack" style={{ gap: 8 }}>
        <div className="divider-label">Write to someone</div>
        <Card pad><Compose targets={targets} base={base} /></Card>
      </section>
    </>
  );
}

// ONE MESSAGE, AS AN EMAIL.
//
// Shahar: "show it like an email: to, first line message. options for
// outbound message: archive. options for inbound based on the type of
// message... when expanding see details of bid for example, and handle as
// bid, or reply."
//
// So the row is closed: who it is with, the subject line, when. Everything
// else - the body, the picture, the verbs - waits behind the disclosure,
// because an inbox is a list you scan and only sometimes a thing you read.
//
// THE VERBS FOLLOW THE KIND (migration 035), which is the whole point:
//
//   yours (outbound)  Archive. Nothing else is yours to do - you sent it.
//   bid               Open the offer. Accepting, asking and passing live
//                     there, on the screen with the job in front of you.
//   question          Open the offer too: the thread belongs to it.
//   task              Open the task.
//   note / system     Reply if there is someone to reply to, then Done.
//
// Delete is gone from every one of them. It destroyed our record of things
// that are still live elsewhere in the database, and archiving already does
// what a person actually wants.
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
          {m.action && <p className="tiny text-muted" style={{ margin: "8px 0 0" }}>Task: {m.action}</p>}

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
            {/* Yours: you sent it. Filing it is the only thing left. */}
            {m.mine ? (
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
                {!offer && m.kind === "task" && m.action_id && taskBase &&
                  <Link href={`${taskBase}/${m.action_id}`} className="btn btn-primary small">Open the task</Link>}
                {m.pending && (
                  <form action={messageSeen}>
                    <input type="hidden" name="base" value={base} />
                    <input type="hidden" name="id" value={m.id} />
                    <input type="hidden" name="handled" value="0" />
                    <button className="btn btn-secondary small">Mark read</button>
                  </form>
                )}
                {!m.handled_at && !offer && (
                  <form action={messageSet}>
                    <input type="hidden" name="base" value={base} />
                    <input type="hidden" name="id" value={m.id} />
                    <input type="hidden" name="status" value="done" />
                    <button className="btn btn-secondary small">Done</button>
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
