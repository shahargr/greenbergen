import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getWeather, getForecast, type WeatherIcon } from "@/lib/weather";
import { createHome, setTown, toggleDeal } from "./actions";
import { StartProjectForm } from "./StartProjectForm";
import { TasksTable } from "./TasksTable";
import { HireTilesGrid, HIRE_TILES } from "@/components/HireTiles";

const CLOSED_STATUSES = ["Completed", "Cancelled", "Force Cancelled"];

type TaskRow = {
  id: string;
  action: string | null;
  status: string;
  priority: string | null;
  target_date: string | null;
  projects: { project_name: string | null } | null;
};

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
  searchParams: Promise<{ panel?: string; error?: string; t?: string; all?: string }>;
}) {
  const { panel, error: flashError, t: tileKey, all: showAll } = await searchParams;
  const supabase = await createClient();
  const [{ data: me }, { data: home }, { data: banners }, { data: leadData }] = await Promise.all([
    supabase.rpc("me"),
    supabase.rpc("consumer_home"),
    supabase
      .from("community_banners")
      .select("text, url")
      .order("created_at", { ascending: false })
      .limit(1),
    supabase.rpc("my_lead_actions"),
  ]);
  const leads: Lead[] = (leadData as Lead[]) ?? [];

  const town: string | null = home?.town_name ?? null;
  const townServices = home?.town ?? null;
  const services: Record<string, Vendor[]> = home?.services ?? {};
  const deals: Deal[] = (home?.promotions as Deal[]) ?? [];
  const projects: HomeProject[] = (home?.projects as HomeProject[]) ?? [];
  const hasHome = projects.length > 0;
  const myContact: string | null = me?.contact_id ?? null;
  const banner = banners?.[0] ?? null;
  const canCreate: boolean = home?.can_create ?? false;

  // Projects this user holds a seat on, with the seat itself.
  type Membership = {
    role: string;
    project_role: string | null;
    projects: { id: string; project_name: string; address: string | null; status: string; parent_project_id: string | null; is_template: boolean } | null;
  };
  const openFilter = `(${CLOSED_STATUSES.join(",")})`;
  const [{ data: membershipRows }, weather, onMe, total] = await Promise.all([
    me?.app_user_id
      ? supabase
          .from("project_members")
          .select("role, project_role, projects(id, project_name, address, status, parent_project_id, is_template)")
          .eq("app_user_id", me.app_user_id)
          .eq("status", "active")
      : Promise.resolve({ data: [] }),
    getWeather(town),
    myContact
      ? supabase
          .from("actions")
          .select("id", { count: "exact", head: true })
          .not("status", "in", openFilter)
          .eq("assigned_to_contact_id", myContact)
          .then((r) => r.count ?? 0)
      : Promise.resolve(0),
    supabase
      .from("actions")
      .select("id", { count: "exact", head: true })
      .not("status", "in", openFilter)
      .then((r) => r.count ?? 0),
  ]);
  const myMemberships = ((membershipRows ?? []) as unknown as Membership[]).filter((m) => m.projects);
  const ownerProjects = myMemberships
    .filter((m) => m.role === "owner")
    .map((m) => m.projects!)
    .filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i)
    .sort((a, b) => a.project_name.localeCompare(b.project_name));

  const onOthers = Math.max(0, total - onMe - leads.length);
  const pendingOnMe = onMe + leads.length;

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
  } else if (panel === "tasks") {
    const base = () =>
      supabase
        .from("actions")
        .select("id, action, status, priority, target_date, notes, projects(project_name)")
        .not("status", "in", openFilter)
        .order("target_date", { ascending: true, nullsFirst: false });
    const [mineRes, othersRes] = await Promise.all([
      myContact ? base().eq("assigned_to_contact_id", myContact).limit(100) : Promise.resolve({ data: [] }),
      myContact
        ? base().or(`assigned_to_contact_id.is.null,assigned_to_contact_id.neq.${myContact}`).limit(100)
        : base().limit(100),
    ]);
    type PanelTaskRow = TaskRow & { notes: string | null };
    const toTable = (rows: unknown, who: "you" | "others") =>
      ((rows ?? []) as PanelTaskRow[]).map((t) => ({
        id: t.id,
        action: t.action ?? "(untitled)",
        status: t.status,
        priority: t.priority,
        target_date: t.target_date,
        notes: t.notes,
        project: t.projects?.project_name ?? null,
        who,
      }));
    const tableTasks = [...toTable(mineRes.data, "you"), ...toTable(othersRes.data, "others")];
    detail = (
      <>
        {leads.length > 0 && (
          <>
            <h2 className="section-title">Leads pending your review · {leads.length}</h2>
            <div style={{ display: "grid", gap: 8, marginBottom: 18 }}>
              {leads.map((l) => (
                <Link key={l.id} href={`/my/task/${l.id}`} className="card statlink" style={{ padding: "12px 14px", borderLeft: "3px solid var(--brand)", display: "block" }}>
                  <strong style={{ fontSize: 15 }}>{l.action}</strong>
                  <div className="small" style={{ marginTop: 4, display: "grid", gap: 2 }}>
                    <span>
                      {l.name}
                      {l.phone && <> · <a href={`tel:${l.phone}`}>{l.phone}</a></>}
                      {l.email && <> · <a href={`mailto:${l.email}`}>{l.email}</a></>}
                    </span>
                    {l.preferred_date && <span className="muted">Preferred date: {l.preferred_date}</span>}
                    {l.message && <span className="muted">&ldquo;{l.message}&rdquo;</span>}
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
        <h2 className="section-title">Open tasks</h2>
        <TasksTable tasks={tableTasks} />
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
    const trades = Object.keys(services).sort();
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
          <Link href="/my?panel=addproject">＋ Start a new project</Link>
        </p>
        <div style={{ display: "grid", gap: 8 }}>
          {ownerProjects.map((p) => (
            <Link key={p.id} href={`/my/project/${p.id}`} className="card statlink" style={{ padding: "10px 14px", display: "block" }}>
              <strong style={{ fontSize: 15 }}>{p.project_name}</strong>
              <div className="muted small">
                {p.parent_project_id ? "Job" : "Home"}
                {p.address && <> · {p.address}</>} · {p.status}
              </div>
            </Link>
          ))}
          {ownerProjects.length === 0 && <p className="muted small">No projects yet — claim your address above.</p>}
        </div>
      </>
    );
  } else if (panel === "addproject" && hasHome) {
    // Candidate parents: your open homes. Default: the home whose tree you
    // touched last (latest task activity anywhere under it).
    const parentHomes = ownerProjects.filter(
      (p) => !p.parent_project_id && !p.is_template && p.status === "In Progress"
    );
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

  const sel = (p: string) => (panel === p ? "card stat statlink selected" : "card stat statlink");

  return (
    <main className="wrap" style={{ paddingTop: 16, paddingBottom: 64 }}>
      {banner?.text &&
        (banner.url ? (
          <a href={banner.url} className="banner" target="_blank" rel="noreferrer">{banner.text}</a>
        ) : (
          <p className="banner">{banner.text}</p>
        ))}

      {/* New owner: claiming the address is the whole point of the page. */}
      {!hasHome && (
        <section className="card hero-claim">
          <div>
            <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Claim your address</h1>
            <p className="muted" style={{ margin: 0, fontSize: 15 }}>
              Your home gets a page of its own — projects, people, paperwork
              and money, all in one place.
            </p>
            {flashError && <p className="error small" style={{ margin: "6px 0 0" }}>{flashError}</p>}
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

      <section className="youband" style={{ marginTop: hasHome ? 0 : 14 }}>
        <Link href={town ? "/my?panel=weather" : "/my?panel=town"} className={sel(town ? "weather" : "town")}>
          <span className="stat-kicker">{town ? `Weather · ${town}` : "Weather"}</span>
          {weather ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "var(--brand)" }}><WxIcon icon={weather.icon} /></span>
              <span className="stat-big">{weather.tempF}°</span>
              <span className="muted small">{weather.label}</span>
            </span>
          ) : (
            <span className="small" style={{ color: "var(--brand)", fontWeight: 600 }}>Set your town →</span>
          )}
        </Link>

        <Link href={town ? "/my?panel=trash" : "/my?panel=town"} className={sel("trash")}>
          <span className="stat-kicker">Trash days</span>
          {townServices?.garbage_note ? (
            <span className="small" style={{ lineHeight: 1.4 }}>{townServices.garbage_note}</span>
          ) : town ? (
            <span className="muted small">Not on file for {town} yet.</span>
          ) : (
            <span className="small" style={{ color: "var(--brand)", fontWeight: 600 }}>Set your town →</span>
          )}
        </Link>

        <Link href="/my?panel=tasks" className={sel("tasks")}>
          <span className="stat-kicker">Tasks</span>
          <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}>
            <span className="stat-big">{pendingOnMe}</span>
            <span className="muted small">
              on you{leads.length > 0 ? ` (${leads.length} lead${leads.length > 1 ? "s" : ""})` : ""} · {onOthers} on others
            </span>
          </span>
        </Link>

        <Link href="/my?panel=local" className={sel("local")}>
          <span className="stat-kicker">Hire a pro</span>
          <span className="small" style={{ lineHeight: 1.4 }}>
            {Object.keys(services).length > 0
              ? `${Object.keys(services).length} trades near you`
              : "Plumbers, electricians, more"}
          </span>
        </Link>

        <Link href="/my?panel=deals" className={sel("deals")}>
          <span className="stat-kicker">Local deals</span>
          {deals.length > 0 ? (
            <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}>
              <span className="stat-big">{deals.length}</span>
              <span className="muted small">open near you</span>
            </span>
          ) : (
            <span className="muted small">Neighbors unlock group deals.</span>
          )}
        </Link>

        <Link href="/my?panel=hourly" className={sel("hourly")}>
          <span className="stat-kicker">Hire by the hour</span>
          <span className="muted small">Idle pros, small jobs — soon.</span>
        </Link>

        {hasHome || ownerProjects.length > 0 ? (
          <Link href="/my?panel=projects" className={sel("projects")}>
            <span className="stat-kicker">Your projects</span>
            <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}>
              <span className="stat-big">{ownerProjects.length}</span>
              <span className="muted small">as owner · start a new one</span>
            </span>
          </Link>
        ) : (
          <span className="card stat" style={{ opacity: 0.65 }}>
            <span className="stat-kicker">Your projects</span>
            <span className="muted small">Claim your address first.</span>
          </span>
        )}

        <Link href="/my/invite" className="card stat statlink">
          <span className="stat-kicker">Invite friends</span>
          <span className="muted small">Neighbors make the deals happen.</span>
        </Link>
      </section>

      {detail && (
        <section className="card" style={{ marginTop: 12, padding: "16px 20px" }}>
          {detail}
        </section>
      )}
    </main>
  );
}

