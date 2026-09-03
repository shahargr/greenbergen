import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { rpcRetry } from "@/lib/rpc";
import { getWeather, getForecast, type WeatherIcon } from "@/lib/weather";
import { createHome, setTown, toggleDeal, requestMoreHomes } from "./actions";
import { StartProjectForm } from "./StartProjectForm";
import { WelcomeVideo } from "@/components/WelcomeVideo";
import { tradeInSeason } from "@/lib/seasons";
import { HireTilesGrid, HIRE_TILES } from "@/components/HireTiles";

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
  const bandOverviewAll = (((bandOverviewData ?? []) as ProjectOverviewRow[]))
    .filter((p) => ownerIdSet.has(p.id) && !p.is_template);
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
  const overviewCard = (p: ProjectOverviewRow, isRoot: boolean, depth: number) => (
    <Link key={p.id} href={`/my/project/${p.id}`} className="card statlink"
      style={{
        padding: "10px 14px", display: "flex", gap: 10, alignItems: "center",
        marginLeft: Math.min(depth, 3) * 24,
        borderLeft: isRoot ? "3px solid var(--brand)" : "3px solid #a8842c",
      }}>
      {isRoot ? homeGlyph : jobGlyph}
      <span style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ fontSize: 15 }}>{p.project_name}</strong>
        <div className="muted small">
          {isRoot ? (p.address ? "Your home" : "Portfolio") : "Project"}
          {p.address && depth === 0 && <> · {p.address}</>} · {p.status}
        </div>
      </span>
      <span className="extra-chip" style={{ whiteSpace: "nowrap" }}>{p.open_count} open</span>
    </Link>
  );
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
        <section style={{ display: "grid", gap: 8, marginBottom: 18 }}>
          {bandRoots.length === 1 && (bandChildren.get(bandRoots[0].id) ?? []).length > 0 ? (
            <>
              {/* One home: its card is noise - the projects ARE the page.
                  A quiet line keeps the home itself reachable. */}
              <p className="small" style={{ margin: "0 0 2px" }}>
                <Link href={`/my/project/${bandRoots[0].id}`} className="muted">
                  🏠 {bandRoots[0].project_name}
                  {bandRoots[0].address && <> · {bandRoots[0].address}</>}
                </Link>
              </p>
              {(bandChildren.get(bandRoots[0].id) ?? []).map((c) => (
                <div key={c.id} style={{ display: "grid", gap: 8 }}>
                  {overviewCard(c, false, 0)}
                  {(bandChildren.get(c.id) ?? []).map((g) => renderTree(g, 1))}
                </div>
              ))}
            </>
          ) : (
            bandRoots.map((r) => renderTree(r, 0))
          )}
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
          <p className="small" style={{ margin: "2px 0 0" }}>
            <Link href="/my/new-project" style={{ fontWeight: 700 }}>＋ Create a project</Link>
          </p>
        </section>
      )}

      <section className={hasHome ? "youband square" : "youband"} style={{ marginTop: hasHome ? 0 : 14 }}>
        {(hasHome ? [
          {
            href: "/my/tasks",
            key: "tasks",
            label: "Tasks",
            sub: `${pendingOnMe} on you · ${onOthers} on others`,
            icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6h12M9 12h12M9 18h12" /><path d="m3.5 5.5 1 1 2-2M3.5 11.5l1 1 2-2M3.5 17.5l1 1 2-2" /></svg>,
          },
          ...(pmProjects.length > 0 ? [{
            href: "/my/payments",
            key: "payments",
            label: "Financials",
            sub: "Payments, budget & balances",
            icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18" /><path d="M5 21V11l4 3 4-6 4 4 2-2v11" /></svg>,
          }] : []),
        ] : [
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

      {detail && (
        <section className="card" style={{ marginTop: 12, padding: "16px 20px" }}>
          {detail}
        </section>
      )}
    </main>
  );
}

