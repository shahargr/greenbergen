import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";
import { stopwatch } from "@shared/perf";
import { getMe } from "@/lib/me";
import { ago, shortDate } from "@shared/format";
import { AppBar, Card, ChevronIcon, Notice, Screen, ShellIcons } from "@shared/ui";
import { Illustration } from "@shared/Illustrations";
import { PhotoBanner } from "@/components/PhotoBanner";
import { TaskDone } from "@/components/TaskDone";
import { Messages } from "@shared/inbox/Inbox";
import { loadInbox } from "@shared/inbox/data";
import { OfferQuestions } from "@shared/offer/Questions";
import { loadQuestions } from "@shared/offer/questions";
import { respondInvite } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inbox" };

// One inbox across every home and job: invitations waiting for an answer,
// conversations with unread messages first, then every open task on a
// project the member is on. All read through existing functions
// (homeowner_me, portal_my_invites, homeowner_tasks); nothing is stored
// twice. Tasks are the construction domain only - a member's business
// projects stay in the portal - and homeowner_tasks returns just the five
// fields drawn below (7 kB for 25, where portal_tasks' whole rows were
// 23 kB for the same 25). Done opens a confirm sheet (TaskDone), never one tap.
type Invite = { id: string; project_id: string; project_name: string; address: string | null; by: string; seat: string; message: string | null; created_at: string };
type Outcome = { id: string; project_id: string; project_name: string; who: string; status: string; at: string };
type Task = { id: string; action: string; status: string; target_date: string | null; project: string; project_id: string; assignee: string | null };

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { error, ok } = await searchParams;
  const w = stopwatch("/inbox");
  const supabase = await createClient();
  // All three reads leave together - the invitations and tasks do not depend
  // on the profile, so waiting for it first only added its latency to theirs.
  const [me, { data: inv }, { data: tasks }, portal, questions] = await Promise.all([
    w.step("me", () => getMe()),
    w.step("invites", () => rpc<{ incoming: Invite[]; outcomes: Outcome[] }>(supabase, "portal_my_invites")),
    w.step("tasks", () => rpc<Task[]>(supabase, "homeowner_tasks", { p_limit: 25 })),
    // The portal's messages, ADDED to this inbox rather than replacing it -
    // booking conversations and open tasks above are not in portal_my_messages
    // and would be lost by a swap.
    w.step("messages", () => loadInbox()),
    // A contractor asking before they accept is a job standing still, so it
    // travels with the rest rather than waiting on any of them.
    w.step("questions", () => loadQuestions()),
  ]);
  w.done();
  if (!me.signed_in) redirect("/login?next=/inbox");
  const incoming = inv?.incoming ?? [];
  const outcomes = inv?.outcomes ?? [];
  const open = tasks ?? []; // homeowner_tasks returns the open ones only
  const threads = me.bookings.filter((b) => b.last_message || b.unread > 0).sort((a, b) => (b.unread > 0 ? 1 : 0) - (a.unread > 0 ? 1 : 0) || (b.last_message?.sent_at ?? "").localeCompare(a.last_message?.sent_at ?? ""));
  const unread = me.bookings.reduce((a, b) => a + (b.unread ?? 0), 0);
  const empty = incoming.length === 0 && outcomes.length === 0 && threads.length === 0 && open.length === 0;

  return (
    <Screen>
      <AppBar brand door="homeowner" right={<ShellIcons unread={unread}  homeHref="/project" />} />
      <div className="body">
        <div className="hero">
          <h1>Inbox</h1>
          <p className="lead">Invitations, conversations and open tasks across every home. Nothing here means nothing needs you.</p>
        </div>
        {me.missing && <Notice title="Preview mode">The database migration has not been applied yet, so conversations cannot be read. Invitations and tasks still can.</Notice>}
        {error && <Notice kind="error">{error}</Notice>}
        {ok === "accepted" && <div className="banner-ok">You&apos;re on the project. It&apos;s under My home.</div>}
        {ok === "declined" && <div className="banner-ok">Declined. They&apos;ll see that.</div>}
        <PhotoBanner bookings={me.bookings} />

        {/* Above everything: someone wants your job and needs one answer. */}
        <OfferQuestions questions={questions} base="/inbox" />

        {incoming.length > 0 && (
          <section className="stack" style={{ gap: 10 }}>
            <div className="divider-label">Invitations</div>
            {incoming.map((i) => (
              <Card pad key={i.id}>
                <div className="card-title">{i.by} invited you to {i.project_name}</div>
                <div className="small text-muted">{i.address?.split(",")[0] ?? ""} · as {seatLabel(i.seat)} · {ago(i.created_at)}</div>
                {i.message && <blockquote>{i.message}</blockquote>}
                <div className="row" style={{ marginTop: 6 }}>
                  <form action={respondInvite}><input type="hidden" name="id" value={i.id} /><input type="hidden" name="accept" value="1" /><button className="btn btn-primary">Accept</button></form>
                  <form action={respondInvite}><input type="hidden" name="id" value={i.id} /><button className="btn btn-ghost">Decline</button></form>
                </div>
              </Card>
            ))}
          </section>
        )}

        {outcomes.length > 0 && (
          <section className="stack" style={{ gap: 8 }}>
            <div className="divider-label">Answers to your invitations</div>
            {outcomes.map((o) => (
              <Link key={o.id} href={`/project/${o.project_id}/people`} className="home-row">
                <span className="grow"><span className="t">{o.who} {o.status} · {o.project_name}</span><span className="m" style={{ display: "block" }}>{shortDate(o.at)}</span></span>
                <ChevronIcon />
              </Link>
            ))}
          </section>
        )}

        {threads.length > 0 && (
          <section className="stack" style={{ gap: 10 }}>
            <div className="divider-label">Conversations</div>
            {threads.map((b) => (
              <Link key={b.project_id} href={`/project/${b.project_id}/timeline`} className="home-row">
                <span className="ic"><Illustration name={b.illustration} /></span>
                <span className="grow">
                  <span className="t">{b.name}{b.unread > 0 && <span className="tag tag-status" style={{ marginLeft: 6, padding: "1px 7px" }}>{b.unread}</span>}</span>
                  <span className="m" style={{ display: "block" }}>{b.last_message ? `${b.last_message.mine ? "You" : b.last_message.who}: ${b.last_message.body}` : "No messages yet"}</span>
                </span>
                <span className="pill-time">{b.last_message ? ago(b.last_message.sent_at) : ""}</span>
              </Link>
            ))}
          </section>
        )}

        {open.length > 0 && (
          <section className="stack" style={{ gap: 10 }}>
            <div className="divider-label">Open tasks · {open.length}</div>
            {open.map((t) => (
              <Card pad key={t.id} className="tight">
                <div className="between">
                  <div className="grow">
                    <div className="card-title" style={{ fontSize: 15 }}>{t.action}</div>
                    <div className="small text-muted"><Link href={`/project/${t.project_id}`}>{t.project}</Link>{t.assignee ? ` · ${t.assignee}` : ""}{t.target_date ? ` · due ${shortDate(t.target_date)}` : ""}{t.status !== "Not Started" ? ` · ${t.status}` : ""}</div>
                  </div>
                  <TaskDone projectId={t.project_id} actionId={t.id} title={t.action} />
                </div>
              </Card>
            ))}
          </section>
        )}

        {empty && portal.messages.length === 0 && (
          <Card soft pad><div className="small">All clear. When a contractor writes, a neighbor invites you, or a job needs a hand from you, it lands here.</div></Card>
        )}

        <Messages data={portal} base="/inbox" projectHref={(id) => `/project/${id}`} heading="From your projects" />
      </div>
    </Screen>
  );
}

const seatLabel = (seat: string | null) => (seat === "asset owner" ? "a co-owner" : seat === "contractor" ? "the contractor" : "a viewer");
