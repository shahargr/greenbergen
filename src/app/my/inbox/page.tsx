import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { markMessage } from "./actions";

export const dynamic = "force-dynamic";

type Msg = {
  id: string; direction: "inbound" | "outbound" | "internal"; channel: string | null;
  body: string; sent_at: string; status: string; read_at: string | null; handled_at: string | null;
  project_id: string | null; project_name: string | null;
  action_id: string | null; action: string | null;
  who: string; mine: boolean; pending: boolean;
};
type Invites = {
  incoming: { id: string; project_id: string; project_name: string; by: string | null; seat: string | null; message: string | null }[];
  outcomes: { id: string; project_id: string; project_name: string; who: string | null; status: string; at: string | null }[];
};

const CHANNEL: Record<string, string> = {
  phone: "📞", sms: "💬", email: "✉️", whatsapp: "💬", "in app": "🔔", "in person": "🤝", other: "•",
};
const when = (t: string) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// The inbox for whatever seat you hold: what came to you and what you sent,
// in one thread of time. Anything inbound still unread is called out, and it
// is the same count the nav icon carries.
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; show?: string }>;
}) {
  const { ok, error, show } = await searchParams;
  const supabase = await createClient();
  const [{ data: msgData }, { data: invData }] = await Promise.all([
    supabase.rpc("portal_my_messages", { p_limit: 100 }),
    supabase.rpc("portal_my_invites"),
  ]);
  const all = ((msgData ?? []) as Msg[]);
  const invites: Invites = { incoming: invData?.incoming ?? [], outcomes: invData?.outcomes ?? [] };
  const pending = all.filter((m) => m.pending);
  const filter = show === "in" ? "in" : show === "out" ? "out" : "all";
  const shown = filter === "all" ? all
    : filter === "in" ? all.filter((m) => m.direction === "inbound")
    : all.filter((m) => m.direction === "outbound" || m.mine);

  const tab = (key: string, label: string, n: number) => (
    <Link href={key === "all" ? "/my/inbox" : `/my/inbox?show=${key}`}
      className={filter === key ? "btn small" : "btn ghost small"}>{label} · {n}</Link>
  );

  return (
    <main className="wrap" style={{ paddingTop: 32, paddingBottom: 96, maxWidth: 720 }}>
      <span className="kicker">Inbox</span>
      <h1 style={{ fontSize: 26, margin: "6px 0 12px" }}>
        Messages{pending.length > 0 ? ` · ${pending.length} waiting on you` : ""}
      </h1>
      {ok && <p className="banner" style={{ background: "#2f6b4f" }}>{ok}</p>}
      {error && <p className="error small">{error}</p>}

      <div style={{ display: "grid", gap: 14 }}>
        {/* Invitations answer themselves on the home page; they are listed
            here so one icon means one place to look. */}
        {(invites.incoming.length > 0 || invites.outcomes.length > 0) && (
          <div className="card" style={{ display: "grid", gap: 6 }}>
            <h2 className="section-title" style={{ margin: 0 }}>
              Invitations · {invites.incoming.length + invites.outcomes.length}
            </h2>
            {invites.incoming.map((i) => (
              <div key={i.id} className="small" style={{ display: "flex", justifyContent: "space-between", gap: 10, borderTop: "1px solid #eef0ec", paddingTop: 6 }}>
                <span style={{ minWidth: 0 }}>
                  <strong>{i.project_name}</strong>
                  <span className="muted"> · {i.by ?? "someone"} invited you as {i.seat ?? "a member"}</span>
                </span>
                <Link href="/my#inbound" className="btn ghost small" style={{ whiteSpace: "nowrap" }}>Answer →</Link>
              </div>
            ))}
            {invites.outcomes.map((o) => (
              <div key={o.id} className="small" style={{ borderTop: "1px solid #eef0ec", paddingTop: 6 }}>
                <span className="muted">{o.who ?? "They"} {o.status} your invitation to </span>
                <strong>{o.project_name}</strong>
              </div>
            ))}
          </div>
        )}

        <div className="card" style={{ display: "grid", gap: 10, minWidth: 0 }}>
          <div className="btn-row" style={{ gap: 6 }}>
            {tab("all", "Everything", all.length)}
            {tab("in", "Inbound", all.filter((m) => m.direction === "inbound").length)}
            {tab("out", "Outbound", all.filter((m) => m.direction === "outbound" || m.mine).length)}
          </div>

          {shown.length === 0 && (
            <p className="muted small" style={{ margin: 0 }}>
              Nothing here yet. Calls, texts and emails logged against your projects show up in this list.
            </p>
          )}

          {shown.map((m) => (
            <div key={m.id} style={{
              display: "grid", gap: 4, borderTop: "1px solid #eef0ec", paddingTop: 8, minWidth: 0,
              borderLeft: m.pending ? "3px solid #c0262d" : undefined,
              paddingLeft: m.pending ? 8 : undefined,
            }}>
              <div className="small" style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={{ minWidth: 0 }}>
                  <span style={{ marginRight: 6 }}>{m.direction === "inbound" ? "↙" : "↗"}</span>
                  <strong>{m.who}</strong>
                  <span className="muted"> · {m.direction === "inbound" ? "to you" : "from you"}</span>
                  {m.channel && <span className="muted"> · {CHANNEL[m.channel] ?? "•"} {m.channel}</span>}
                </span>
                <span className="muted" style={{ whiteSpace: "nowrap" }}>{when(m.sent_at)}</span>
              </div>
              <p className="small" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                {m.body.length > 600 ? `${m.body.slice(0, 600)}…` : m.body}
              </p>
              <div className="small" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {m.project_id && <Link href={`/my/project/${m.project_id}`} className="extra-chip" style={{ textDecoration: "none" }}>{m.project_name}</Link>}
                {m.action_id && <Link href={`/my/task/${m.action_id}`} className="extra-chip" style={{ textDecoration: "none" }}>{m.action ?? "task"}</Link>}
                {m.pending ? (
                  <>
                    <span className="extra-chip" style={{ background: "#fdecec", color: "#c0262d" }}>needs review</span>
                    <form action={markMessage.bind(null, m.id, false)}><button className="btn ghost small" style={{ padding: "1px 8px" }}>Mark read</button></form>
                    <form action={markMessage.bind(null, m.id, true)}><button className="btn ghost small" style={{ padding: "1px 8px" }}>Done</button></form>
                  </>
                ) : (
                  <span className="muted" style={{ fontSize: 11 }}>{m.status}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
