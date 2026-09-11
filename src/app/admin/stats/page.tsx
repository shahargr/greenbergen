import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Usage · Admin" };

// ADMIN > USAGE. Who uses the system and what they do in it, read from the
// record the system already keeps (migration 059): sign-ins, the change log
// (every write, with the person who made it), tasks made and closed,
// bookings, messages, files, payments. Superadmin only; the function refuses
// everyone else. Website visitors who never sign in are Vercel Web
// Analytics' to count - the card at the end says where.

type Daily = { day: string; active_users: number; writes: number; tasks_created: number; tasks_completed: number; bookings: number; messages: number; files: number };
type Person = {
  id: string; name: string | null; email: string | null; joined: string; last_seen: string | null; logins: number;
  is_superadmin: boolean; active: boolean; plan: string | null; homes: number; seats: number; contractor: boolean;
  last_activity: string | null; writes: number; tasks_created: number; tasks_closed: number; messages: number;
  files: number; bookings: number; payments: number;
};
type Stats = {
  ok: true; days: number; since: string;
  users: { total: number; active: number; new: number; seen_7d: number; seen_30d: number; never_signed_in: number; superadmins: number };
  doors: { homeowners: number; contractors: number; approved_contractors: number; pending_contractors: number };
  invitations: { sent: number; accepted: number; pending: number; in_period: number };
  bookings: { total: number; in_period: number; by_state: Record<string, number>; by_package: { code: string; n: number }[] };
  tasks: { open: number; created_in_period: number; completed_in_period: number; created_by_people: number; created_by_system: number;
           by_domain: { domain: string; open: number; created: number; completed: number }[] };
  engagement: { messages: number; files: number; payments: number; checkins: number; video_plays: number; writes: number };
  daily: Daily[];
  people: Person[];
  tables: { table: string; writes: number; people: number }[];
} | { ok: false; reason: string };

const PERIODS = [7, 30, 90] as const;
const n = (v: number | null | undefined) => (v ?? 0).toLocaleString("en-US");
const day = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";
const ago = (iso: string | null | undefined) => {
  if (!iso) return "never";
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 60 ? `${d}d ago` : day(iso);
};

// Vercel Web Analytics lives per project; these are the three.
const VERCEL = [
  { name: "Portal (greenbergen.vercel.app)", href: "https://vercel.com/shahargrs-projects/greenbergen/analytics" },
  { name: "Homeowner app (/home)", href: "https://vercel.com/shahargrs-projects/greenbergen-homeowner/analytics" },
  { name: "Professionals app (/pro)", href: "https://vercel.com/shahargrs-projects/greenbergen-pro/analytics" },
];

export default async function AdminStatsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { days: dq } = await searchParams;
  const days = (PERIODS as readonly number[]).includes(Number(dq)) ? Number(dq) : 30;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_usage_stats", { p_days: days });
  const s = (data ?? null) as Stats | null;

  if (error || !s || !s.ok) {
    return (
      <main style={{ paddingTop: 8 }}>
        <span className="kicker">Admin</span>
        <h1 style={{ fontSize: 26, margin: "6px 0 16px" }}>Usage</h1>
        <div className="card"><p className="muted" style={{ margin: 0 }}>{s && !s.ok ? s.reason : error?.message ?? "Could not read the usage."}</p></div>
      </main>
    );
  }

  const people = s.people.filter((p) => p.active);
  const gone = s.people.length - people.length;
  const stateOrder = ["planned", "posted", "accepted", "done", "closed"];
  const states = Object.entries(s.bookings.by_state).sort((a, b) => stateOrder.indexOf(a[0]) - stateOrder.indexOf(b[0]));

  return (
    <main style={{ paddingTop: 8, paddingBottom: 64 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap" }}>
        <div>
          <span className="kicker">Admin</span>
          <h1 style={{ fontSize: 26, margin: "6px 0 4px" }}>Usage</h1>
          <p className="muted small" style={{ margin: 0 }}>Who signs in, what they do, and what gets made. Counts in the period are since {day(s.since)}.</p>
        </div>
        <div className="btn-row" role="group" aria-label="Period">
          {PERIODS.map((p) => (
            <Link key={p} href={`/admin/stats?days=${p}`} className={`btn${p === days ? "" : " btn-ghost"}`} aria-current={p === days ? "page" : undefined}>{p} days</Link>
          ))}
        </div>
      </div>

      {/* PEOPLE - the headline numbers. */}
      <h2 className="section-title" style={{ marginTop: 20 }}>Accounts</h2>
      <div className="usage-kpis">
        <Kpi label="Accounts" value={s.users.active} note={s.users.total !== s.users.active ? `${n(s.users.total - s.users.active)} disabled` : undefined} />
        <Kpi label={`New in ${days} days`} value={s.users.new} />
        <Kpi label="Seen in 7 days" value={s.users.seen_7d} />
        <Kpi label="Seen in 30 days" value={s.users.seen_30d} />
        <Kpi label="Never signed in" value={s.users.never_signed_in} />
        <Kpi label="Homeowners with a home" value={s.doors.homeowners} />
        <Kpi label="Contractors" value={s.doors.contractors} note={`${n(s.doors.approved_contractors)} approved${s.doors.pending_contractors ? `, ${n(s.doors.pending_contractors)} pending` : ""}`} />
        <Kpi label="Invitations" value={s.invitations.sent} note={`${n(s.invitations.accepted)} accepted · ${n(s.invitations.pending)} open`} />
      </div>

      {/* WHAT GETS DONE in the period. */}
      <h2 className="section-title" style={{ marginTop: 24 }}>In the last {days} days</h2>
      <div className="usage-kpis">
        <Kpi label="Tasks made" value={s.tasks.created_in_period} note={`${n(s.tasks.created_by_people)} by people · ${n(s.tasks.created_by_system)} by the system`} />
        <Kpi label="Tasks closed" value={s.tasks.completed_in_period} note={`${n(s.tasks.open)} open now`} />
        <Kpi label="Bookings" value={s.bookings.in_period} note={`${n(s.bookings.total)} all time`} />
        <Kpi label="Messages" value={s.engagement.messages} />
        <Kpi label="Files uploaded" value={s.engagement.files} />
        <Kpi label="Payments logged" value={s.engagement.payments} />
        <Kpi label="Site check-ins" value={s.engagement.checkins} />
        <Kpi label="Writes by people" value={s.engagement.writes} note="every saved change, any app" />
      </div>

      {/* DAY BY DAY. One small chart per measure - single series, one hue,
          the peak labelled, the rest in the tooltip and the table below. */}
      <h2 className="section-title" style={{ marginTop: 24 }}>Day by day</h2>
      <div className="card" style={{ display: "grid", gap: 18 }}>
        <Spark title="People active" rows={s.daily} pick={(d) => d.active_users} />
        <Spark title="Writes" rows={s.daily} pick={(d) => d.writes} />
        <Spark title="Tasks made" rows={s.daily} pick={(d) => d.tasks_created} />
        <Spark title="Tasks closed" rows={s.daily} pick={(d) => d.tasks_completed} />
        <Spark title="Bookings" rows={s.daily} pick={(d) => d.bookings} />
        <Spark title="Messages" rows={s.daily} pick={(d) => d.messages} />
        <details>
          <summary className="small muted" style={{ cursor: "pointer" }}>The same numbers as a table</summary>
          <div style={{ overflowX: "auto", marginTop: 8 }}>
            <table className="tasktable">
              <thead><tr><th>Day</th><th>People</th><th>Writes</th><th>Tasks made</th><th>Tasks closed</th><th>Bookings</th><th>Messages</th><th>Files</th></tr></thead>
              <tbody>
                {[...s.daily].reverse().map((d) => (
                  <tr key={d.day}><td>{day(d.day)}</td><td>{d.active_users}</td><td>{d.writes}</td><td>{d.tasks_created}</td><td>{d.tasks_completed}</td><td>{d.bookings}</td><td>{d.messages}</td><td>{d.files}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>

      {/* TASKS BY DOMAIN and WHERE THE WRITES GO. */}
      <div className="usage-two">
        <div className="card">
          <h2 className="section-title" style={{ marginTop: 0 }}>Tasks by domain</h2>
          <table className="tasktable">
            <thead><tr><th>Domain</th><th>Open</th><th>Made</th><th>Closed</th></tr></thead>
            <tbody>
              {s.tasks.by_domain.map((d) => (
                <tr key={d.domain}><td>{d.domain}</td><td>{n(d.open)}</td><td>{n(d.created)}</td><td>{n(d.completed)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2 className="section-title" style={{ marginTop: 0 }}>What people touch</h2>
          {s.tables.length === 0 ? <p className="muted small" style={{ margin: 0 }}>No writes by people in the period.</p> : (
            <table className="tasktable">
              <thead><tr><th>Table</th><th>Writes</th><th>People</th></tr></thead>
              <tbody>
                {s.tables.map((t) => (
                  <tr key={t.table}><td>{t.table.replaceAll("_", " ")}</td><td>{n(t.writes)}</td><td>{n(t.people)}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          {(states.length > 0 || s.bookings.by_package.length > 0) && (
            <p className="muted small" style={{ margin: "12px 0 0" }}>
              Bookings: {states.map(([k, v]) => `${v} ${k}`).join(" · ")}.
              {s.bookings.by_package.length > 0 && <> By package: {s.bookings.by_package.map((p) => `${p.code} ${p.n}`).join(", ")}.</>}
            </p>
          )}
        </div>
      </div>

      {/* EVERY ACCOUNT, most recently active first. */}
      <h2 className="section-title" style={{ marginTop: 24 }}>People · {people.length}</h2>
      <div className="card" style={{ padding: "8px 12px" }}>
        <div style={{ overflowX: "auto" }}>
          <table className="tasktable usage-people">
            <thead>
              <tr>
                <th>Who</th><th>Joined</th><th>Last seen</th><th>Logins</th><th>Homes</th>
                <th title={`Saved changes in the last ${days} days`}>Writes</th>
                <th>Tasks made</th><th>Tasks closed</th><th>Msgs</th><th>Files</th><th>Bookings</th><th>Paid</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{p.name ?? p.email ?? "—"}{p.is_superadmin && <span className="muted small"> · admin</span>}{p.contractor && <span className="muted small"> · pro</span>}</div>
                    {p.name && p.email && <div className="muted small">{p.email}</div>}
                  </td>
                  <td>{day(p.joined)}</td>
                  <td title={p.last_seen ?? ""}>{ago(p.last_seen)}{p.last_activity && (!p.last_seen || p.last_activity > p.last_seen) ? <div className="muted small">active {ago(p.last_activity)}</div> : null}</td>
                  <td>{n(p.logins)}</td>
                  <td>{p.homes || (p.seats ? <span className="muted">{p.seats} seat{p.seats === 1 ? "" : "s"}</span> : "—")}</td>
                  <td>{n(p.writes)}</td>
                  <td>{n(p.tasks_created)}</td>
                  <td>{n(p.tasks_closed)}</td>
                  <td>{n(p.messages)}</td>
                  <td>{n(p.files)}</td>
                  <td>{n(p.bookings)}</td>
                  <td>{n(p.payments)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {gone > 0 && <p className="muted small" style={{ margin: "8px 0 0" }}>{gone} disabled {gone === 1 ? "account is" : "accounts are"} not listed.</p>}
      </div>

      {/* WEBSITE - the visitors who never sign in. */}
      <h2 className="section-title" style={{ marginTop: 24 }}>Website visitors</h2>
      <div className="card">
        <p className="small" style={{ margin: "0 0 8px" }}>
          Visitors who never sign in leave nothing in the database - the public surface is read-only by rule. The three apps
          carry Vercel Web Analytics; switch it on under each project&apos;s Analytics tab (free on Hobby) and visitors, page
          views, routes and referrers appear there within a few minutes of the next visit.
        </p>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          {VERCEL.map((v) => <li key={v.href}><a href={v.href} target="_blank" rel="noreferrer">{v.name}</a></li>)}
        </ul>
      </div>
    </main>
  );
}

function Kpi({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="card stat">
      <span className="stat-kicker">{label}</span>
      <span className="stat-big">{n(value)}</span>
      {note && <span className="muted small">{note}</span>}
    </div>
  );
}

// One measure over the period: columns no thicker than 24px, a rounded
// data-end on a square baseline, the peak labelled, everything else in the
// tooltip. One series, so no legend - the title names it.
function Spark({ title, rows, pick }: { title: string; rows: Daily[]; pick: (d: Daily) => number }) {
  const vals = rows.map(pick);
  const max = Math.max(0, ...vals);
  const total = vals.reduce((a, b) => a + b, 0);
  const peakAt = max > 0 ? vals.indexOf(max) : -1;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span className="small" style={{ fontWeight: 600 }}>{title}</span>
        <span className="muted small">{n(total)} in the period{max > 0 ? ` · peak ${n(max)} on ${day(rows[peakAt]!.day)}` : ""}</span>
      </div>
      <div className="usage-chart" role="img" aria-label={`${title} per day`}>
        {rows.map((d, i) => {
          const v = pick(d);
          const h = max > 0 ? Math.max(v > 0 ? 3 : 0, Math.round((v / max) * 56)) : 0;
          return (
            <div key={d.day} className="usage-col" title={`${day(d.day)}: ${n(v)}`}>
              {i === peakAt && v > 0 && <span className="usage-peak">{n(v)}</span>}
              <span className="usage-bar" style={{ height: h }} />
            </div>
          );
        })}
      </div>
      <div className="muted" style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
        <span>{day(rows[0]?.day)}</span><span>{day(rows[rows.length - 1]?.day)}</span>
      </div>
    </div>
  );
}
