import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { setGodMode } from "../admin/actions";
import { rpcRetry } from "@/lib/rpc";
import { getWeather, getForecast, type WeatherIcon } from "@/lib/weather";
import { createHome, setTown, toggleDeal, requestMoreHomes, respondInvite, dismissInviteOutcome, joinClusterDeal, leaveClusterDeal, setProjectPriority } from "./actions";
import { StartProjectForm } from "./StartProjectForm";
import { WelcomeVideo } from "@/components/WelcomeVideo";
import { tradeInSeason } from "@/lib/seasons";
import { HireTilesGrid, HIRE_TILES } from "@/components/HireTiles";
import { CardTxRow, CardTxHead, type CardTx } from "./CardTxRow";
import { CardTaskRow } from "./CardTaskRow";

export const maxDuration = 60;


type Vendor = {
  id: string;
  name: string;
  phone: string | null;
  website: string | null;
  rating: number | null;
  provisional: boolean | null;
};

type Lead = {
  id: string;
  action: string;
  project_name: string | null;
  created_at: string;
  name: string;
  phone: string | null;
  email: string | null;
  kind: string;
  message: string | null;
  preferred_date: string | null;
};

type Deal = {
  id: string;
  title: string;
  summary: string | null;
  trade: string | null;
  company: string | null;
  offer_terms: string | null;
  min_signups: number;
  max_signups: number | null;
  signups: number;
  joined: boolean;
  closing_soon: boolean;
  ends_on: string | null;
  // Clustered pricing: the ladder, and where my signup stands in its run.
  pricing_mode?: "flat" | "cluster";
  window_days?: number;
  radius_miles?: number;
  tiers?: { id: string; min_houses: number; price_cents: number; label: string | null }[];
  mine?: {
    address: string | null; window_start: string | null; window_end: string | null; status: string;
    cluster_status: string | null; houses: number; scheduled_start: string | null;
    tier: { label: string | null; min_houses: number; price_cents: number } | null;
  } | null;
};

type HomeProject = {
  id: string;
  name: string;
  address: string | null;
  status: string;
  live: boolean;
};

function dayName(date: string, i: number) {
  if (i === 0) return "Today";
  return new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" });
}

function WxIcon({ icon, size = 26 }: { icon: WeatherIcon; size?: number }) {
  const p = {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: 1.8,
    strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
  };
  switch (icon) {
    case "sun":
      return <svg {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" /></svg>;
    case "partly":
      return <svg {...p}><circle cx="8.5" cy="8" r="3.2" /><path d="M8.5 2.5v1.7M2.5 8h1.7M4.3 3.8l1.2 1.2" /><path d="M7 19h9.5a3.5 3.5 0 0 0 .6-6.95A5 5 0 0 0 7.5 13.5 2.8 2.8 0 0 0 7 19z" /></svg>;
    case "cloud":
      return <svg {...p}><path d="M6 18h11a4 4 0 0 0 .7-7.94A5.5 5.5 0 0 0 6.9 8.7 3.9 3.9 0 0 0 6 18z" /></svg>;
    case "fog":
      return <svg {...p}><path d="M5 9h14M3 13h18M5 17h14" /></svg>;
    case "rain":
      return <svg {...p}><path d="M6 14h11a4 4 0 0 0 .7-7.94A5.5 5.5 0 0 0 6.9 4.7 3.9 3.9 0 0 0 6 14z" /><path d="M8 17l-1 3M12 17l-1 3M16 17l-1 3" /></svg>;
    case "snow":
      return <svg {...p}><path d="M6 14h11a4 4 0 0 0 .7-7.94A5.5 5.5 0 0 0 6.9 4.7 3.9 3.9 0 0 0 6 14z" /><path d="M8 18h0M12 20h0M16 18h0M10 21h0M14 21h0" strokeWidth="2.4" /></svg>;
    case "storm":
      return <svg {...p}><path d="M6 13h11a4 4 0 0 0 .7-7.94A5.5 5.5 0 0 0 6.9 3.7 3.9 3.9 0 0 0 6 13z" /><path d="m12 13-2.5 4h3L10 21" /></svg>;
  }
}

// The owner's landing. New owner with nothing: claim your address is the
// hero; the magnet band (weather, trash, tasks, pros, deals, hourly, invite)
// fills with honest ask-for-something empty states until the data exists.
export default async function MyPage({
  searchParams,
}: {
  searchParams: Promise<{ panel?: string; error?: string; ok?: string; t?: string; all?: string; allp?: string }>;
}) {
  const { panel, error: flashError, ok: flashOk, t: tileKey, all: showAll, allp } = await searchParams;
  const showClosedProjects = allp === "1";
  // God mode cookie (set from Admin → Overview). Only honored for a superadmin.
  const godOn = (await cookies()).get("gb_god")?.value === "1";
  const supabase = await createClient();
  const { data: boot, error: bootErr } = await rpcRetry(supabase, "portal_home");

  // Middleware only lets authenticated sessions reach /my - so a null
  // identity here is a transient auth-settling moment (first load right
  // after sign-in), never a real anonymous. Hold and retry instead of
  // rendering the misleading "no agreement" state.
  if (!boot?.me && !bootErr) {
    return (
      <main className="wrap" style={{ paddingTop: 48, maxWidth: 560, textAlign: "center" }}>
        <meta httpEquiv="refresh" content="1" />
        <p className="muted">Setting up your account…</p>
      </main>
    );
  }
  const home = boot?.home ?? null;
  const meErr = bootErr;
  const homeErr = null as { message: string } | null;
  const banner0 = (boot?.banner ?? null) as { text: string; url: string | null } | null;
  const leads: Lead[] = (boot?.leads as Lead[]) ?? [];

  const town: string | null = home?.town_name ?? null;
  const townServices = home?.town ?? null;
  const services: Record<string, Vendor[]> = home?.services ?? {};
  const deals: Deal[] = (home?.promotions as Deal[]) ?? [];
  const projects: HomeProject[] = (home?.projects as HomeProject[]) ?? [];
  const hasHome = projects.length > 0;
  const banner = banner0;
  const welcomeVideo: string | null = boot?.welcome_video ?? null;
  const canCreate: boolean = home?.can_create ?? false;
  const godMode = godOn && !!boot?.me?.is_superadmin;

  // Projects this user holds a seat on, with the seat itself.
  type Membership = {
    role: string;
    project_role: string | null;
    projects: { id: string; project_name: string; address: string | null; status: string; parent_project_id: string | null; is_template: boolean; asset_id: string | null } | null;
  };
  type ProjectOverviewRow = {
    id: string; project_name: string; address: string | null; status: string;
    parent_project_id: string | null; is_template: boolean;
    open_count: number; last_activity: string;
  };

  const membershipRows = boot?.memberships ?? [];
  const bandOverviewData = boot?.overview ?? [];
  const weather = hasHome ? null : await getWeather(town);
  const onMe: number = boot?.counts?.on_me ?? 0;
  const total: number = boot?.counts?.total ?? 0;
  const myMemberships = ((membershipRows ?? []) as unknown as Membership[])
    .filter((m) => m.projects && !(m.projects as { trashed_at?: string | null }).trashed_at);
  const ownerProjects = myMemberships
    .filter((m) => m.role === "owner")
    .map((m) => m.projects!)
    .filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i)
    .sort((a, b) => a.project_name.localeCompare(b.project_name));

  // Seats that carry authority rank >= 50 (owner or site-PM manager) - the
  // audience for payment logging. RLS re-checks on every write.
  const pmProjects = myMemberships
    .filter((m) => (m.role === "owner" || m.role === "manager") && !m.projects!.is_template)
    .map((m) => m.projects!)
    .filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i)
    .sort((a, b) => a.project_name.localeCompare(b.project_name));

  const onOthers = Math.max(0, total - onMe - leads.length);
  const pendingOnMe = onMe + leads.length;

  const ownerIdSet = new Set(ownerProjects.map((p) => p.id));
  let bandOverviewAll = (((bandOverviewData ?? []) as ProjectOverviewRow[]))
    .filter((p) => ownerIdSet.has(p.id) && !p.is_template);
  if (godMode) {
    // God mode: every project on the platform, as if invited to all of them.
    // Counts come from the (p_all) cards; the overview rows just shape the tree.
    const { data: allRows } = await supabase
      .from("projects")
      .select("id, project_name, address, status, parent_project_id, is_template")
      .is("trashed_at", null)
      .eq("is_template", false)
      .order("project_name");
    bandOverviewAll = (((allRows ?? []) as Omit<ProjectOverviewRow, "open_count" | "last_activity">[]))
      .map((p) => ({ ...p, open_count: 0, last_activity: "" }));
  }
  const bandOverview = showClosedProjects
    ? bandOverviewAll
    : bandOverviewAll.filter((p) => p.status === "In Progress");
  const hiddenClosedProjects = bandOverviewAll.length - bandOverview.length;
  const bandIds = new Set(bandOverview.map((p) => p.id));
  // Full tree: roots are projects whose parent is absent from the list;
  // children nest recursively under their parent at any depth.
  const bandRoots = bandOverview.filter((p) => !p.parent_project_id || !bandIds.has(p.parent_project_id));
  const bandChildren = new Map<string, ProjectOverviewRow[]>();
  for (const p of bandOverview) {
    if (p.parent_project_id && bandIds.has(p.parent_project_id)) {
      const list = bandChildren.get(p.parent_project_id) ?? [];
      list.push(p);
      bandChildren.set(p.parent_project_id, list);
    }
  }
  const homeGlyph = (
    <span className="tile-icon" style={{ width: 34, height: 34, flex: "none" }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M10 21v-6h4v6" /></svg>
    </span>
  );
  const jobGlyph = (
    <span className="tile-icon" style={{ width: 34, height: 34, flex: "none", background: "#fdf4e3", color: "#a8842c" }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="m14.5 9.5 6 6L18 18l-6-6" /><path d="M3.3 6.8 6 4l4.4 4.4a2 2 0 0 1 0 2.8l-.2.2a2 2 0 0 1-2.8 0z" /><path d="m5 21 5.5-5.5" /></svg>
    </span>
  );
  // A Mon–Sun window: open tasks due in it, and planned payments due in it.
  type WeekBlock = {
    start: string; end: string;
    tasks: { id: string; action: string; target_date: string; priority: string | null; assignee: string | null }[];
    payments: { id: string; paid_to: string; amount: number | null; on_date: string | null; status: string }[];
  };
  // Per-project dashboard bundle for the cards (dates, task counts, recent
  // transactions, urgent tasks, this/next week) — one call, scoped to the caller.
  type ProjectCard = {
    id: string; project_name: string; address: string | null; status: string; parent_project_id: string | null;
    start_date: string | null; est_complete: string | null;
    open: number; done: number; stuck: number;
    transactions: CardTx[];
    pending: CardTx[];
    week: WeekBlock;
    next_week: WeekBlock;
    urgent: { id: string; action: string; priority: string | null; target_date: string | null; status: string }[];
  };
  // Card bundle plus the status / method lists the inline transaction editor needs.
  const [{ data: cardData }, { data: txStatusRows }, { data: txMethodRows }, { data: invitesData }, { data: prefRows }] = await Promise.all([
    supabase.rpc("portal_project_cards", { p_all: godMode }),
    supabase.from("transaction_statuses").select("status"),
    supabase.from("payment_methods").select("id, name").eq("is_active", true)
      .order("display_order", { ascending: true, nullsFirst: false }),
    supabase.rpc("portal_my_invites"),
    supabase.from("user_project_prefs").select("project_id").eq("is_priority", true),
  ]);
  // Tiles I flagged as priority sort first (RLS returns only my rows).
  const priority = new Set(((prefRows ?? []) as { project_id: string }[]).map((r) => r.project_id));
  const txStatuses = ((txStatusRows ?? []) as { status: string }[]).map((r) => r.status);
  const txMethods = ((txMethodRows ?? []) as { id: string; name: string }[]);
  // Project invitations addressed to me (answer here) and answers to the ones
  // I sent (shown until dismissed).
  type Invites = {
    incoming: { id: string; project_id: string; project_name: string; address: string | null; by: string | null; seat: string | null; message: string | null }[];
    outcomes: { id: string; project_id: string; project_name: string; who: string | null; status: string; at: string | null }[];
  };
  const invites: Invites = { incoming: invitesData?.incoming ?? [], outcomes: invitesData?.outcomes ?? [] };
  // "Add a profile photo" nudge until one exists (photos show on task panels).
  const { data: myContact } = boot?.me?.contact_id
    ? await supabase.from("contacts").select("avatar_path").eq("id", boot.me.contact_id).maybeSingle()
    : { data: null as { avatar_path: string | null } | null };
  const needsPhoto = !!boot?.me?.contact_id && !myContact?.avatar_path;
  const cardsById = new Map<string, ProjectCard>();
  for (const c of ((cardData ?? []) as ProjectCard[])) cardsById.set(c.id, c);

  const money = (n: number | null) => (n == null ? "—" : n >= 1000 ? `$${Math.round(n).toLocaleString()}` : `$${Math.round(n * 100) / 100}`);
  const fmtDate = (d: string | null) => (d ? new Date(d + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");
  // Weekday + short date for the schedule rows, e.g. "Tue 9/8".
  const fmtDay = (d: string | null) => (d ? new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" }) : "—");
  const fmtRange = (s: string, e: string) => `${fmtDay(s)} – ${fmtDay(e)}`;
  // Brand-normalize the portfolio root's display name (e.g. "Green Bergen
  // Development" -> "GreenBergen development").
  const fmtRoot = (n: string) => n.replace(/green\s*bergen/i, "GreenBergen").replace(/development/i, "development");
  const inviteGlyph = (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3.4" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><path d="M18 8v6M15 11h6" /></svg>
  );

  // Landing view: one tile per project, four to a row; the tile itself opens
  // the project. Counts are plain text (no nested links inside the tile).
  const projectTile = (p: ProjectOverviewRow, isRoot: boolean) => {
    const c = cardsById.get(p.id);
    const urgent = c?.urgent[0];
    const starred = priority.has(p.id);
    return (
      <div key={p.id} className="card ptile"
        style={{ position: "relative", borderLeft: isRoot ? "3px solid var(--brand)" : "3px solid #a8842c", borderColor: starred ? "var(--brand)" : undefined }}>
        {/* Priority star: mine only, sits outside the link so the tile stays one click. */}
        <form action={setProjectPriority} style={{ position: "absolute", top: 6, right: 8 }}>
          <input type="hidden" name="project" value={p.id} />
          <input type="hidden" name="on" value={starred ? "0" : "1"} />
          <input type="hidden" name="back" value={showClosedProjects ? "/my?allp=1" : "/my"} />
          <button title={starred ? "Priority — click to unflag" : "Flag as priority (moves it up)"} aria-label={starred ? "Unflag priority" : "Flag as priority"}
            style={{ border: 0, background: "none", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 2, color: starred ? "#d4a017" : "#c9ccc4" }}>
            {starred ? "★" : "☆"}
          </button>
        </form>
      <Link href={`/my/project/${p.id}`} style={{ display: "grid", gap: 6, textDecoration: "none", color: "inherit", minWidth: 0 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0, paddingRight: 22 }}>
          {isRoot ? homeGlyph : jobGlyph}
          <strong style={{ fontSize: 15, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis" }}>{p.project_name}</strong>
        </div>
        <div className="muted small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {isRoot ? (p.address ?? "Home") : "Project"} · {p.status}
        </div>
        <div className="muted small">
          {fmtDate(c?.start_date ?? null)} → <span style={{ color: "var(--ink)" }}>{fmtDate(c?.est_complete ?? null)}</span>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span className="extra-chip"><strong>{c?.open ?? p.open_count}</strong> open</span>
          <span className="extra-chip"><strong>{c?.done ?? 0}</strong> done</span>
          {(c?.stuck ?? 0) > 0 && <span className="extra-chip" style={{ background: "#fdecec", color: "#c0262d" }}><strong>{c?.stuck}</strong> stuck</span>}
        </div>
        {urgent && (
          <div className="small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {urgent.priority === "High" && <span style={{ color: "#c0262d" }}>● </span>}{urgent.action}
          </div>
        )}
      </Link>
      </div>
    );
  };

  const overviewCard = (p: ProjectOverviewRow, isRoot: boolean, depth: number) => {
    const c = cardsById.get(p.id);
    return (
      <div key={p.id} className="card"
        style={{
          padding: "14px 16px", display: "grid", gap: 10,
          marginLeft: Math.min(depth, 3) * 24,
          borderLeft: isRoot ? "3px solid var(--brand)" : "3px solid #a8842c",
        }}>
        {/* Header: name + address/status, with per-project invite on the panel. */}
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          {isRoot ? homeGlyph : jobGlyph}
          <Link href={`/my/project/${p.id}`}
            style={{ flex: 1, minWidth: 0, textDecoration: "none", color: "inherit" }}>
            <strong style={{ fontSize: 16 }}>{p.project_name}</strong>
            <div className="muted small">
              {isRoot ? (p.address ? "Your home" : "Portfolio") : "Project"}
              {p.address && depth === 0 && <> · {p.address}</>} · {p.status}
            </div>
          </Link>
          <Link href={`/my/invite?project=${p.id}`} className="btn ghost small"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}
            title="Invite someone to this project">
            {inviteGlyph} Invite
          </Link>
        </div>

        {/* Dates */}
        <div className="small" style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
          <span className="muted">Started <strong style={{ color: "var(--ink)" }}>{fmtDate(c?.start_date ?? null)}</strong></span>
          <span className="muted">Est. complete <strong style={{ color: "var(--ink)" }}>{fmtDate(c?.est_complete ?? null)}</strong></span>
        </div>

        {/* Task status counts */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {/* Each count opens the project's task list pre-filtered to that bucket. */}
          <Link href={`/my/project/${p.id}?tasks=open`} className="extra-chip" style={{ textDecoration: "none" }}>
            <strong>{c?.open ?? p.open_count}</strong> open
          </Link>
          <Link href={`/my/project/${p.id}?tasks=done`} className="extra-chip" style={{ textDecoration: "none" }}>
            <strong>{c?.done ?? 0}</strong> done
          </Link>
          {(c?.stuck ?? 0) > 0 && (
            <Link href={`/my/project/${p.id}?tasks=stuck`} className="extra-chip"
              style={{ background: "#fdecec", color: "#c0262d", textDecoration: "none" }}>
              <strong>{c?.stuck}</strong> stuck
            </Link>
          )}
        </div>

        {/* Most urgent tasks — visible, part of the bird's-eye view. */}
        {c && c.urgent.length > 0 && (
          <div style={{ display: "grid", gap: 3 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span className="small" style={{ fontWeight: 700 }}>Most urgent tasks</span>
              <Link href={`/my/project/${p.id}?tasks=open`} className="small">All →</Link>
            </div>
            {c.urgent.map((u) => (
              <Link key={u.id} href={`/my/task/${u.id}`} className="small"
                style={{ display: "flex", justifyContent: "space-between", gap: 10, textDecoration: "none", color: "inherit" }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                  {u.priority === "High" && <span style={{ color: "#c0262d" }}>● </span>}{u.action}
                </span>
                <span className="muted" style={{ whiteSpace: "nowrap" }}>{u.target_date ?? "—"}</span>
              </Link>
            ))}
          </div>
        )}

        {/* Schedule: this week and next week (Mon–Sun) — tasks due in the
            window, plus any planned payments falling in it. */}
        {c && ([["This week", c.week], ["Next week", c.next_week]] as const).map(([label, w]) => (
          <div key={label} style={{ display: "grid", gap: 4, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <span className="small" style={{ fontWeight: 700 }}>{label}</span>
              <span className="muted" style={{ fontSize: 11, whiteSpace: "nowrap" }}>{fmtRange(w.start, w.end)}</span>
            </div>
            {w.tasks.length === 0 && w.payments.length === 0 ? (
              <span className="muted small">Nothing scheduled.</span>
            ) : (
              <table className="tasktable" style={{ width: "100%", tableLayout: "fixed" }}>
                <thead>
                  <tr>
                    <th style={{ width: 82 }}>Day</th>
                    <th>What</th>
                    <th className="col-who" style={{ width: 96 }}>Who</th>
                    <th style={{ width: 84, textAlign: "right" }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Click a task to open it beneath the row (detail, Edit, evidence). */}
                  {w.tasks.map((t) => (
                    <CardTaskRow key={t.id} task={t} day={fmtDay(t.target_date)} />
                  ))}
                  {w.payments.map((t) => (
                    <tr key={t.id}>
                      <td className="muted" style={{ whiteSpace: "nowrap" }}>{fmtDay(t.on_date)}</td>
                      <td style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {t.paid_to}
                        <span className="extra-chip" style={{ marginLeft: 6, fontSize: 10, padding: "0 6px" }}>{t.status}</span>
                      </td>
                      <td className="muted col-who">payment</td>
                      <td style={{ textAlign: "right", fontWeight: 600, color: "#a8842c", whiteSpace: "nowrap" }}>{money(t.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ))}

        {/* Recent 10 PAID transactions (date · amount · paid to, newest
            first), then the next few pending ones — kept separate so
            future-dated scheduled rows can't crowd out real payments. */}
        {c && c.transactions.length > 0 && (
          <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span className="small" style={{ fontWeight: 700 }}>Recent transactions</span>
              <Link href="/my/payments" className="small">All →</Link>
            </div>
            {/* Click a row to open its fields beneath it and update / close. */}
            <table className="tasktable" style={{ width: "100%", tableLayout: "fixed" }}>
              <CardTxHead />
              <tbody>
                {/* Rows past the first 5 are hidden on narrow screens (CSS .tx-extra). */}
                {c.transactions.map((t, i) => (
                  <CardTxRow key={t.id} tx={t} statuses={txStatuses} methods={txMethods} pending={false} className={i >= 5 ? "tx-extra" : undefined} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {c && c.pending.length > 0 && (
          <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
            <span className="small" style={{ fontWeight: 700 }}>Pending · next up</span>
            <table className="tasktable" style={{ width: "100%", tableLayout: "fixed" }}>
              <CardTxHead />
              <tbody>
                {c.pending.map((t) => (
                  <CardTxRow key={t.id} tx={t} statuses={txStatuses} methods={txMethods} pending />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };
  const renderTree = (p: ProjectOverviewRow, depth: number): React.ReactNode => (
    <div key={p.id} style={{ display: "grid", gap: 8 }}>
      {overviewCard(p, depth === 0, depth)}
      {(bandChildren.get(p.id) ?? []).map((c) => renderTree(c, depth + 1))}
    </div>
  );

  // ---- Panel detail ----
  let detail: React.ReactNode = null;
  if (panel === "town") {
    detail = (
      <>
        <h2 className="section-title">Your town</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          Weather, trash days, local pros and deals are all town-based.
        </p>
        <form action={setTown} className="btn-row">
          <input name="town" className="input" placeholder="e.g. Tenafly" style={{ maxWidth: 240 }} required />
          <button className="btn">Set my town</button>
        </form>
      </>
    );
  } else if (panel === "weather") {
    const days = await getForecast(town);
    detail = (
      <>
        <h2 className="section-title">{town ? `Five days · ${town}` : "Five days"}</h2>
        {!days && <p className="muted">Forecast unavailable right now.</p>}
        {days && (
          <div className="forecast">
            {days.map((d, i) => (
              <div key={d.date} className="card stat" style={{ padding: "10px 14px" }}>
                <span className="stat-kicker">{dayName(d.date, i)}</span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--brand)" }}>
                  <WxIcon icon={d.icon} size={22} />
                  <span style={{ fontSize: 18, fontWeight: 700, color: "var(--ink)" }}>
                    {d.hi}° <span className="muted" style={{ fontWeight: 400 }}>/ {d.lo}°</span>
                  </span>
                </span>
                <span className="muted small">{d.label}</span>
              </div>
            ))}
          </div>
        )}
      </>
    );
  } else if (panel === "trash") {
    detail = (
      <>
        <h2 className="section-title">{town ? `Collection · ${town}` : "Collection"}</h2>
        {!townServices && <p className="muted">No collection details for your town yet.</p>}
        {townServices && (
          <div style={{ display: "grid", gap: 10, fontSize: 15 }}>
            {townServices.garbage_note && <p style={{ margin: 0 }}><strong>Garbage:</strong> {townServices.garbage_note}</p>}
            {townServices.recycling_note && <p style={{ margin: 0 }}><strong>Recycling:</strong> {townServices.recycling_note}</p>}
            {townServices.bulk_note && <p style={{ margin: 0 }}><strong>Bulk pickup:</strong> {townServices.bulk_note}</p>}
            {townServices.schedule_url && (
              <a href={townServices.schedule_url} target="_blank" rel="noreferrer">Full schedule</a>
            )}
          </div>
        )}
      </>
    );
  } else if (panel === "local") {
    const trades = Object.keys(services).filter((t) => tradeInSeason(t)).sort();
    const tile = HIRE_TILES.find((h) => h.key === tileKey);
    const tileVendors = tile
      ? tile.trades
          .flatMap((tr) => services[tr] ?? [])
          .filter((v, i, arr) => arr.findIndex((x) => x.id === v.id) === i)
      : [];
    detail = (
      <>
        <h2 className="section-title">{town ? `Hire a pro · ${town}` : "Hire a pro"}</h2>
        <HireTilesGrid active={tile?.key} />
        {tile && (
          <div style={{ marginTop: 14 }}>
            <h3 style={{ fontSize: 15, margin: "0 0 8px" }}>{tile.label}</h3>
            {tileVendors.length === 0 && (
              <p className="muted small" style={{ margin: 0 }}>
                No {tile.label.toLowerCase()} providers listed near you yet — check{" "}
                <Link href="/my?panel=local&all=1">every trade</Link> or ask us.
              </p>
            )}
            <div style={{ display: "grid", gap: 6 }}>
              {tileVendors.slice(0, 8).map((v) => (
                <div key={v.id} className="card" style={{ padding: "8px 12px", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <span>
                    {v.name}
                    {v.rating != null && (
                      <span className="muted small"> · {Number(v.rating).toFixed(1)}★{v.provisional ? " (new)" : ""}</span>
                    )}
                  </span>
                  <span className="small">
                    {v.phone && <a href={`tel:${v.phone}`}>{v.phone}</a>}
                    {v.phone && v.website && " · "}
                    {v.website && <a href={v.website} target="_blank" rel="noreferrer">site</a>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        {showAll && (
          <div style={{ marginTop: 14 }}>
            {trades.length === 0 && <p className="muted">No local providers listed for your town yet.</p>}
            {trades.map((trade) => (
              <details key={trade} className="tradefold">
                <summary>
                  {trade}
                  <span className="muted small" style={{ fontWeight: 400 }}>
                    {services[trade].length} provider{services[trade].length > 1 ? "s" : ""}
                  </span>
                </summary>
                <div style={{ display: "grid", gap: 6, padding: "2px 0 12px 18px" }}>
                  {services[trade].slice(0, 8).map((v) => (
                    <div key={v.id} className="card" style={{ padding: "8px 12px", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <span>
                        {v.name}
                        {v.rating != null && (
                          <span className="muted small"> · {Number(v.rating).toFixed(1)}★{v.provisional ? " (new)" : ""}</span>
                        )}
                      </span>
                      <span className="small">
                        {v.phone && <a href={`tel:${v.phone}`}>{v.phone}</a>}
                        {v.phone && v.website && " · "}
                        {v.website && <a href={v.website} target="_blank" rel="noreferrer">site</a>}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            ))}
          </div>
        )}
      </>
    );
  } else if (panel === "deals") {
    detail = (
      <>
        <h2 className="section-title">{town ? `Local deals · ${town}` : "Local deals"}</h2>
        <p className="small" style={{ marginTop: 0 }}>
          <Link href="/deals">See all bookable deals →</Link>
        </p>
        {deals.length === 0 && (
          <p className="muted">
            No deals in {town ?? "your town"} yet. Deals unlock when neighbors
            band together — <Link href="/my/invite">invite a few</Link> and
            we&apos;ll negotiate the first one.
          </p>
        )}
        <div style={{ display: "grid", gap: 10 }}>
          {deals.map((d) => (
            <div key={d.id} className="card" style={{ padding: "14px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <strong style={{ fontSize: 15 }}>{d.title}</strong>
                {d.closing_soon && <span className="extra-chip">closing soon</span>}
              </div>
              <div className="muted small" style={{ margin: "2px 0 6px" }}>
                {[d.company, d.trade].filter(Boolean).join(" · ")}
              </div>
              {d.summary && <p className="small" style={{ margin: "0 0 6px" }}>{d.summary}</p>}
              {d.offer_terms && <p className="muted small" style={{ margin: "0 0 8px" }}>{d.offer_terms}</p>}
              {d.pricing_mode === "cluster" ? (
                <div style={{ display: "grid", gap: 8 }}>
                  {/* The ladder: what each house pays as the run grows. */}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    {(d.tiers ?? []).map((t) => (
                      <span key={t.id} className="extra-chip"
                        style={d.mine?.tier && d.mine.tier.min_houses === t.min_houses ? { background: "#2f6b4f", color: "#fff" } : undefined}>
                        {t.min_houses === 1 ? "1 house" : `${t.min_houses}+ houses`} · ${(t.price_cents / 100).toLocaleString()}{t.label ? ` · ${t.label}` : ""}
                      </span>
                    ))}
                    <span className="muted small">back-to-back, within {d.radius_miles ?? 0.5} mi</span>
                  </div>
                  {d.mine ? (
                    <div className="small" style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center", padding: "8px 10px", background: "#eef5f0", borderRadius: 8 }}>
                      <span>
                        ✅ You&apos;re in for <strong>{d.mine.address}</strong> · window {d.mine.window_start} → {d.mine.window_end}
                        <br />
                        Your run: <strong>{d.mine.houses}</strong> house{d.mine.houses === 1 ? "" : "s"}
                        {d.mine.tier ? <> · quoted <strong>${(d.mine.tier.price_cents / 100).toLocaleString()}</strong>{d.mine.tier.label ? ` (${d.mine.tier.label})` : ""}</> : " · no tier yet"}
                        {d.mine.cluster_status === "locked" || d.mine.cluster_status === "scheduled"
                          ? <> · <strong>locked</strong>{d.mine.scheduled_start ? `, starts ${d.mine.scheduled_start}` : ""}</>
                          : " · price final when the run locks"}
                      </span>
                      {d.mine.cluster_status !== "locked" && d.mine.cluster_status !== "scheduled" && (
                        <form action={leaveClusterDeal.bind(null, d.id)}>
                          <button className="btn ghost small">Withdraw</button>
                        </form>
                      )}
                    </div>
                  ) : (
                    <form action={joinClusterDeal} style={{ display: "grid", gap: 8 }}>
                      <input type="hidden" name="promotion" value={d.id} />
                      <div className="form-2col">
                        <div className="field" style={{ marginBottom: 0 }}>
                          <label>Which house</label>
                          {ownerProjects.filter((p) => !p.parent_project_id && p.address).length > 0 ? (
                            <select name="project" className="input" defaultValue={ownerProjects.filter((p) => !p.parent_project_id && p.address)[0]?.id ?? ""}>
                              {ownerProjects.filter((p) => !p.parent_project_id && p.address).map((p) => (
                                <option key={p.id} value={p.id}>{p.address}</option>
                              ))}
                            </select>
                          ) : (
                            <input name="address" className="input" required placeholder="Street address" />
                          )}
                        </div>
                        <div className="field" style={{ marginBottom: 0 }}>
                          <label>Dates that work (window)</label>
                          <div style={{ display: "flex", gap: 6 }}>
                            <input name="window_start" type="date" className="input" defaultValue={new Date().toISOString().slice(0, 10)} />
                            <input name="window_end" type="date" className="input" defaultValue={new Date(Date.now() + (d.window_days ?? 3) * 86400000).toISOString().slice(0, 10)} />
                          </div>
                        </div>
                      </div>
                      <label className="radio-opt small">
                        <input type="checkbox" name="consent" required />{" "}
                        Book me with neighbours in one run. I pay the tier my run reaches — never more than the 1-house price — and the price is final only when the run locks. I can withdraw free until then.
                      </label>
                      <div><button className="btn" style={{ padding: "6px 12px" }}>Count me in</button></div>
                    </form>
                  )}
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                  <span className="small">
                    <strong>{d.signups}</strong> of {d.min_signups} neighbors in
                    {d.max_signups ? ` · ${d.max_signups} spots total` : ""}
                  </span>
                  <form action={toggleDeal.bind(null, d.id, !d.joined)}>
                    <button className={d.joined ? "btn ghost" : "btn"} style={{ padding: "6px 12px" }}>
                      {d.joined ? "Leave" : "Count me in"}
                    </button>
                  </form>
                </div>
              )}
            </div>
          ))}
        </div>
      </>
    );
  } else if (panel === "hourly") {
    detail = (
      <>
        <h2 className="section-title">Hire by the hour</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Coming soon: when local contractors have idle time, they&apos;ll post
          an hourly rate here — grab a pro for the small stuff without a full
          project. Meanwhile, <Link href="/my?panel=local">local support</Link>{" "}
          has the phone numbers.
        </p>
      </>
    );
  } else if (panel === "projects") {
    detail = (
      <>
        <h2 className="section-title">Your projects — as owner</h2>
        <p className="small" style={{ marginTop: 0 }}>
          <Link href="/my/new-project">＋ Start a new project</Link>
        </p>
        <div style={{ display: "grid", gap: 8 }}>
          {bandRoots.map((r) => renderTree(r, 0))}
          {bandOverview.length === 0 && <p className="muted small">No projects yet — claim your address above.</p>}
        </div>
      </>
    );
  } else if (panel === "addproject" && hasHome) {
    // Candidate parents: your PROPERTIES - projects carrying a claimed
    // asset (an address), wherever they sit in the tree. Corporate
    // containers without an asset never belong in this picker. Fallback:
    // open root projects with an address.
    let parentHomes = ownerProjects.filter(
      (p) => p.asset_id && !p.is_template && p.status === "In Progress"
    );
    if (parentHomes.length === 0) {
      parentHomes = ownerProjects.filter(
        (p) => !p.parent_project_id && !p.is_template && p.address && p.status === "In Progress"
      );
    }
    const rootOf = (id: string): string => {
      const proj = ownerProjects.find((p) => p.id === id);
      return proj?.parent_project_id ? rootOf(proj.parent_project_id) : id;
    };
    let defaultParent = parentHomes[0]?.id ?? projects[0].id;
    const treeIds = ownerProjects.filter((p) => !p.is_template).map((p) => p.id);
    if (treeIds.length > 0) {
      const { data: lastTouched } = await supabase
        .from("actions")
        .select("project_id")
        .in("project_id", treeIds)
        .order("last_modified_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastTouched?.project_id) {
        const root = rootOf(lastTouched.project_id as string);
        if (parentHomes.some((p) => p.id === root)) defaultParent = root;
      }
    }
    detail = (
      <>
        <h2 className="section-title">Start a project</h2>
        <StartProjectForm
          homes={parentHomes.map((p) => ({ id: p.id, name: p.project_name, address: p.address }))}
          defaultParent={defaultParent}
          error={flashError}
        />
      </>
    );
  }

  return (
    <main className="wrap" style={{ paddingTop: 16, paddingBottom: 64 }}>
      {flashError && (
        <div className="error small" style={{ marginTop: 0, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span>{flashError}</span>
          {/extend it/i.test(flashError) && (
            <form action={requestMoreHomes}>
              <button className="btn small">Request another address</button>
            </form>
          )}
        </div>
      )}
      {(meErr || homeErr) && (
        <p className="error small" style={{ marginTop: 0 }}>
          Home data failed to load{meErr && <> — me(): {meErr.message}</>}
          {homeErr && <> — consumer_home(): {homeErr.message}</>}
        </p>
      )}
      {flashOk && <p className="banner" style={{ background: "#2f6b4f", marginTop: 0 }}>{flashOk}</p>}
      {hasHome && needsPhoto && (
        <p className="small" style={{ margin: "0 0 10px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span>📷 Add a profile photo — it shows on your task panels.</span>
          <Link href="/my/settings" className="btn ghost small">Add one →</Link>
        </p>
      )}
      {godMode && (
        <p className="banner" style={{ background: "#7a1f2b", marginTop: 0, display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span>⚡ <strong>God mode is on</strong> — showing every project on the platform as if you were invited to all.</span>
          <form action={setGodMode} style={{ display: "inline" }}>
            <input type="hidden" name="back" value="/my" />
            <input type="hidden" name="on" value="0" />
            <button className="btn small" style={{ background: "#fff", color: "#7a1f2b" }}>Turn off</button>
          </form>
        </p>
      )}
      {banner?.text && (
        <section className="hero-banner">
          <p style={{ margin: 0, fontSize: 17, fontWeight: 700, lineHeight: 1.35 }}>{banner.text}</p>
          {banner.url && (
            <a className="btn" href={banner.url} target="_blank" rel="noreferrer"
              style={{ background: "#fff", color: "var(--brand)", whiteSpace: "nowrap" }}>
              Learn more →
            </a>
          )}
        </section>
      )}

      {/* Invitations waiting for my answer, and answers to the ones I sent. */}
      {/* One line per thing waiting on you, right above the project tiles.
          The inbox icon in the top bar carries the same count. */}
      {(invites.incoming.length > 0 || invites.outcomes.length > 0) && (
        <div id="inbound" style={{ display: "grid", gap: 4, marginBottom: 10 }}>
          {invites.incoming.map((i) => (
            <div key={i.id} className="small" style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, padding: "6px 10px", borderRadius: 8, background: "#eef5f0", borderLeft: "3px solid var(--brand)" }}>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={i.message ?? undefined}>
                ✉️ Invited to <strong>{i.project_name}</strong> by {i.by ?? "someone"}{i.seat ? ` as ${i.seat}` : ""}{i.message ? ` — “${i.message}”` : ""}
              </span>
              <form action={respondInvite} style={{ display: "inline", flex: "none" }}>
                <input type="hidden" name="id" value={i.id} /><input type="hidden" name="accept" value="1" />
                <button className="btn small" style={{ padding: "2px 10px" }}>Accept</button>
              </form>
              <form action={respondInvite} style={{ display: "inline", flex: "none" }}>
                <input type="hidden" name="id" value={i.id} /><input type="hidden" name="accept" value="0" />
                <button className="btn ghost small" style={{ padding: "2px 10px" }}>Decline</button>
              </form>
            </div>
          ))}
          {invites.outcomes.map((o) => (
            <div key={o.id} className="small" style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, padding: "6px 10px", borderRadius: 8, background: "#f4f5f2" }}>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {o.status === "accepted" ? "✅" : "🚫"} <strong>{o.who ?? "Someone"}</strong> {o.status} your invitation to{" "}
                <Link href={`/my/project/${o.project_id}`}>{o.project_name}</Link>
              </span>
              <form action={dismissInviteOutcome} style={{ display: "inline", flex: "none" }}>
                <input type="hidden" name="id" value={o.id} />
                <button className="btn ghost small" style={{ padding: "2px 10px" }}>Dismiss</button>
              </form>
            </div>
          ))}
        </div>
      )}

      {/* First run: welcome + step-by-step until the first project exists. */}
      {!hasHome && (
        <section className="card" style={{ marginBottom: 14, display: "grid", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 24, margin: "0 0 4px" }}>
              Welcome to <span style={{ color: "var(--brand)" }}>green</span>bergen
            </h1>
            <p className="muted" style={{ margin: 0 }}>
              Your home gets a page of its own — projects, people, paperwork
              and money, all in one place. Three steps and you&apos;re running:
            </p>
          </div>
          {welcomeVideo && <WelcomeVideo url={welcomeVideo} />}
          <ol className="welcome-steps">
            <li className="active">
              <strong>Claim your address</strong>
              <span className="muted small">Tell us where home is — that&apos;s where everything lives.</span>
              {canCreate ? (
                <form action={createHome} style={{ display: "grid", gap: 8, marginTop: 8, maxWidth: 380 }}>
                  <input name="name" className="input" required autoComplete="off" placeholder="What should we call it? e.g. Our house" />
                  <input name="address" className="input" required placeholder="Address — 12 Maple Ave, Tenafly NJ" />
                  <div><button className="btn">Claim it</button></div>
                </form>
              ) : (
                <span className="muted small">Your account has no active agreement yet — ask us for an invitation.</span>
              )}
            </li>
            <li>
              <strong>Start your first project</strong>
              <span className="muted small">A generator, a water heater, a leak — say it, snap it, or type it.</span>
            </li>
            <li>
              <strong>We take it from there</strong>
              <span className="muted small">Tasks, the right pros, and every payment tracked in one place.</span>
            </li>
          </ol>
        </section>
      )}

      {hasHome && bandOverviewAll.length > 0 && !bandOverviewAll.some((p) => p.parent_project_id) && (
        <section className="card" style={{ marginBottom: 14, display: "grid", gap: 10 }}>
          <strong>Your home is in ✓ — now start your first project</strong>
          {welcomeVideo && <WelcomeVideo url={welcomeVideo} />}
          <p className="muted small" style={{ margin: 0 }}>
            A generator, a water heater, a leak — describe it once and it
            becomes a project with tasks, people and money attached.
          </p>
          <div><Link className="btn" href="/my/new-project">Start your first project</Link></div>
        </section>
      )}

      {false && (
        <section className="card hero-claim">
          <div>
            <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Claim your address</h1>
            <p className="muted" style={{ margin: 0, fontSize: 15 }}>
              Your home gets a page of its own — projects, people, paperwork
              and money, all in one place.
            </p>
            {!canCreate && (
              <p className="muted small" style={{ margin: "6px 0 0" }}>
                Your account has no active agreement yet — ask us for an invitation.
              </p>
            )}
          </div>
          {canCreate && (
            <form action={createHome} style={{ display: "grid", gap: 8, minWidth: "min(300px, 100%)" }}>
              <input name="name" className="input" required placeholder="What should we call it? e.g. Our house" />
              <input name="address" className="input" required placeholder="Address — 12 Maple Ave, Tenafly NJ" />
              <button className="btn">Claim it</button>
            </form>
          )}
        </section>
      )}

      {hasHome && bandOverviewAll.length > 0 && (
        // Keyed on the flash params: an action redirecting back here with
        // ?ok= / ?error= must remount the client rows (Saving… / Uploading…
        // would otherwise stick — Next keeps client state on a same-route
        // searchParams change).
        <section key={`${flashOk ?? ""}|${flashError ?? ""}`} style={{ display: "grid", gap: 8, marginBottom: 18 }}>
          {(() => {
            // Single portfolio root with projects under it: the root is a
            // heading line and the tiles are its projects. Otherwise every
            // project in the list gets a tile, roots first.
            const singleRoot = bandRoots.length === 1 && (bandChildren.get(bandRoots[0].id) ?? []).length > 0 ? bandRoots[0] : null;
            const flatten = (list: ProjectOverviewRow[]): ProjectOverviewRow[] =>
              list.flatMap((p) => [p, ...flatten(bandChildren.get(p.id) ?? [])]);
            const inOrder = singleRoot ? flatten(bandChildren.get(singleRoot.id) ?? []) : flatten(bandRoots);
            // Priority tiles first, each group keeping its usual order.
            const tiles = [...inOrder.filter((p) => priority.has(p.id)), ...inOrder.filter((p) => !priority.has(p.id))];
            return (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap", margin: "0 0 2px" }}>
                  {singleRoot ? (
                    <Link href={`/my/project/${singleRoot.id}`} className="muted" style={{ fontWeight: 600 }}>
                      🏠 {fmtRoot(singleRoot.project_name)}
                      {singleRoot.address && <> · {singleRoot.address}</>}
                    </Link>
                  ) : <span />}
                  <Link href="/my/new-project" className="small" style={{ fontWeight: 700, whiteSpace: "nowrap" }}>＋ Create a project</Link>
                </div>
                <div className="ptiles">
                  {tiles.map((p) => projectTile(p, !p.parent_project_id || !bandIds.has(p.parent_project_id)))}
                </div>
              </>
            );
          })()}

          {/* The detailed panels (transactions, this/next week, urgent tasks)
              stay available under one fold. */}
          <details style={{ marginTop: 4 }}>
            <summary className="small muted" style={{ cursor: "pointer", fontWeight: 600 }}>Activity — transactions and this/next week, per project</summary>
            <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
              {bandRoots.length === 1 && (bandChildren.get(bandRoots[0].id) ?? []).length > 0
                ? (bandChildren.get(bandRoots[0].id) ?? []).map((c) => (
                    <div key={c.id} style={{ display: "grid", gap: 8 }}>
                      {overviewCard(c, false, 0)}
                      {(bandChildren.get(c.id) ?? []).map((g) => renderTree(g, 1))}
                    </div>
                  ))
                : bandRoots.map((r) => renderTree(r, 0))}
            </div>
          </details>
          {!showClosedProjects && hiddenClosedProjects > 0 && (
            <p className="small" style={{ margin: 0 }}>
              <Link href="/my?allp=1">Show all projects ({hiddenClosedProjects} closed hidden)</Link>
            </p>
          )}
          {showClosedProjects && (
            <p className="small" style={{ margin: 0 }}>
              <Link href="/my">Show open projects only</Link>
            </p>
          )}
        </section>
      )}

      {!hasHome && (
      <section className="youband" style={{ marginTop: 14 }}>
        {([
          {
            href: town ? "/my?panel=weather" : "/my?panel=town",
            key: town ? "weather" : "town",
            label: "Weather",
            sub: weather ? `${weather.tempF}° · ${weather.label}` : "Set your town →",
            icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="10" cy="10" r="3.5" /><path d="M10 3v1.5M10 15.5V17M3 10h1.5M15.5 10H17M5 5l1 1M15 5l-1 1" /><path d="M14 19a4 4 0 0 1 3.5-6 4.5 4.5 0 0 1 4.4 3.6A2.7 2.7 0 0 1 21 21h-7z" /></svg>,
          },
          {
            href: town ? "/my?panel=trash" : "/my?panel=town",
            key: "trash",
            label: "Trash days",
            sub: townServices?.garbage_note ?? (town ? "Not on file yet" : "Set your town →"),
            icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16" /><path d="M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2" /><path d="M6 7l1 13a2 2 0 0 0 2 1.8h6A2 2 0 0 0 17 20l1-13" /><path d="M10 11v6M14 11v6" /></svg>,
          },
          {
            href: "/my?panel=deals",
            key: "deals",
            label: "Local deals",
            sub: `${deals.length} open near you`,
            icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8Z" /><circle cx="7" cy="7" r="1.4" /></svg>,
          },
          {
            href: "/my?panel=local",
            key: "local",
            label: "Hire a pro",
            sub: "Plumbers, electricians, more",
            icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15a8 8 0 0 1 16 0v2H4z" /><path d="M10 7.5V5a2 2 0 0 1 4 0v2.5" /><path d="M2 20h20" /></svg>,
          },
          {
            href: "/my/tasks",
            key: "tasks",
            label: "Tasks",
            sub: `${pendingOnMe} on you · ${onOthers} on others`,
            icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6h12M9 12h12M9 18h12" /><path d="m3.5 5.5 1 1 2-2M3.5 11.5l1 1 2-2M3.5 17.5l1 1 2-2" /></svg>,
          },
          {
            href: "/my/invite",
            key: "invite",
            label: "Invite",
            sub: "Neighbors make the deals",
            icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3.4" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><path d="M18 8v6M15 11h6" /></svg>,
          },
        ]).map((t) => (
          <Link key={t.key} href={t.href} className={panel === t.key ? "tile selected" : "tile"}>
            <span className="tile-icon">{t.icon}</span>
            <span className="tile-label">{t.label}</span>
            <span className="tile-sub">{t.sub}</span>
          </Link>
        ))}
      </section>
      )}

      {detail && (
        <section className="card" style={{ marginTop: 12, padding: "16px 20px" }}>
          {detail}
        </section>
      )}
    </main>
  );
}

