import Link from "next/link";
import { Card, Notice } from "../ui";
import { Compose } from "./Compose";
import { messageDelete, messageSeen, messageSet, messageToTask } from "./actions";
import type { InboxData, Msg } from "./data";

// One inbox, four apps. The portal's model, in Warm Ink: what came to you and
// what you sent in one thread of time, the invitations still waiting on an
// answer, and a way to write back. Everything reads and writes through the
// portal_message_* functions, so a message marked done in the builder app is
// done in the homeowner app too - there is one inbox, seen through four
// doors, not four inboxes.
const CHANNEL: Record<string, string> = {
  phone: "Call", sms: "Text", email: "Email", whatsapp: "WhatsApp",
  "in app": "In app", "in person": "In person", other: "Note",
};

const when = (t: string) =>
  new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function InboxScreen({
  data, base, taskBase, projectHref,
}: {
  data: InboxData;
  base: string;                              // this app's inbox path
  taskBase?: string;                         // where a task made here lives
  projectHref?: (id: string) => string;      // how this app links a project
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

      <Messages data={data} base={base} taskBase={taskBase} projectHref={projectHref} />
    </>
  );
}

// The message half on its own, for an app whose inbox already has a shape of
// its own. The homeowner app is the case: its inbox carries booking
// conversations, invitations and open tasks, none of which live in
// portal_my_messages - so the portal's messages are ADDED there rather than
// swapped in, and nothing that was working stops working.
export function Messages({
  data, base, taskBase, projectHref, heading = "Messages",
}: {
  data: InboxData; base: string; taskBase?: string;
  projectHref?: (id: string) => string; heading?: string;
}) {
  const { messages, targets } = data;
  const waiting = messages.filter((m) => m.pending);
  return (
    <>
      {waiting.length > 0 && (
        <section className="stack" style={{ gap: 8 }}>
          <div className="divider-label">Waiting on you · {waiting.length}</div>
          {waiting.map((m) => <Row key={m.id} m={m} base={base} taskBase={taskBase} projectHref={projectHref} />)}
        </section>
      )}

      <section className="stack" style={{ gap: 8 }}>
        <div className="divider-label">{heading} · {messages.length}</div>
        {messages.length === 0 && (
          <Card soft pad><div className="small">No messages yet.</div></Card>
        )}
        {messages.filter((m) => !m.pending).map((m) => (
          <Row key={m.id} m={m} base={base} taskBase={taskBase} projectHref={projectHref} />
        ))}
      </section>

      <section className="stack" style={{ gap: 8 }}>
        <div className="divider-label">Write to someone</div>
        <Card pad><Compose targets={targets} base={base} /></Card>
      </section>
    </>
  );
}

function Row({
  m, base, taskBase, projectHref,
}: {
  m: Msg; base: string; taskBase?: string; projectHref?: (id: string) => string;
}) {
  const meta = [
    m.mine ? `You → ${m.who}` : m.who,
    m.channel ? CHANNEL[m.channel] ?? m.channel : null,
    when(m.sent_at),
  ].filter(Boolean) as string[];

  return (
    <Card pad className="tight">
      <div className="between">
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="small text-muted">{meta.join(" · ")}</div>
          <p className="small" style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{m.body}</p>
          {m.project_name && (
            <div className="tiny text-muted" style={{ marginTop: 4 }}>
              {m.project_id && projectHref
                ? <Link href={projectHref(m.project_id)}>{m.project_name}</Link>
                : m.project_name}
              {m.action ? ` · became: ${m.action}` : ""}
            </div>
          )}
        </div>
        {m.pending && <span className="tag tag-status" style={{ whiteSpace: "nowrap" }}>New</span>}
      </div>

      {/* Three ways a message stops waiting on you: you have read it, you
          have dealt with it, or it becomes a task that has not been. */}
      <div className="row" style={{ gap: 6, marginTop: 10, flexWrap: "wrap" }}>
        {m.pending && (
          <form action={messageSeen}>
            <input type="hidden" name="base" value={base} />
            <input type="hidden" name="id" value={m.id} />
            <input type="hidden" name="handled" value="0" />
            <button className="btn btn-secondary small">Mark read</button>
          </form>
        )}
        {!m.handled_at && (
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
          <button className="btn btn-ghost small">Archive</button>
        </form>
        <form action={messageDelete}>
          <input type="hidden" name="base" value={base} />
          <input type="hidden" name="id" value={m.id} />
          <button className="btn btn-ghost small">Delete</button>
        </form>
      </div>

      {!m.action_id && (
        <details style={{ marginTop: 8 }}>
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
    </Card>
  );
}
