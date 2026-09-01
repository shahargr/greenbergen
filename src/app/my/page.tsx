import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getWeather, getForecast, type WeatherIcon } from "@/lib/weather";

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

function dayName(date: string, i: number) {
  if (i === 0) return "Today";
  return new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" });
}

// Weather glyphs keyed by condition.
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

// The personalized landing: a community banner (admin-set), four compact
// panels, and a detail window that exists only while a panel is selected.
export default async function MyPage({
  searchParams,
}: {
  searchParams: Promise<{ panel?: string }>;
}) {
  const { panel } = await searchParams;
  const supabase = await createClient();
  const [{ data: me }, { data: home }, { data: banners }] = await Promise.all([
    supabase.rpc("me"),
    supabase.rpc("consumer_home"),
    supabase
      .from("community_banners")
      .select("text, url")
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  const town: string | null = home?.town_name ?? null;
  const townServices = home?.town ?? null;
  const services: Record<string, Vendor[]> = home?.services ?? {};
  const myContact: string | null = me?.contact_id ?? null;
  const banner = banners?.[0] ?? null;

  const openFilter = `(${CLOSED_STATUSES.join(",")})`;
  const [weather, onMe, total] = await Promise.all([
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
  const onOthers = Math.max(0, total - onMe);

  // Detail for the selected panel; no selection = no window at all.
  let detail: React.ReactNode = null;
  if (panel === "tasks") {
    const base = () =>
      supabase
        .from("actions")
        .select("id, action, status, priority, target_date, projects(project_name)")
        .not("status", "in", openFilter)
        .order("target_date", { ascending: true, nullsFirst: false });
    const [mineRes, othersRes] = await Promise.all([
      myContact ? base().eq("assigned_to_contact_id", myContact).limit(50) : Promise.resolve({ data: [] }),
      myContact
        ? base().or(`assigned_to_contact_id.is.null,assigned_to_contact_id.neq.${myContact}`).limit(50)
        : base().limit(50),
    ]);
    const mine = (mineRes.data ?? []) as unknown as TaskRow[];
    const others = (othersRes.data ?? []) as unknown as TaskRow[];
    const renderList = (tasks: TaskRow[]) => (
      <div style={{ display: "grid", gap: 8 }}>
        {tasks.map((t) => (
          <div key={t.id} className="card" style={{ padding: "10px 14px" }}>
            <strong style={{ fontSize: 15 }}>{t.action}</strong>
            <div className="muted small">
              {t.projects?.project_name ?? "No project"} · {t.status}
              {t.priority && t.priority !== "Missing" && <> · {t.priority}</>}
              {t.target_date && <> · due {t.target_date}</>}
            </div>
          </div>
        ))}
      </div>
    );
    detail = (
      <>
        <h2 className="section-title">On you · {mine.length}</h2>
        {mine.length === 0 ? <p className="muted small">Nothing open on you.</p> : renderList(mine)}
        <h2 className="section-title" style={{ marginTop: 18 }}>On others · {onOthers}</h2>
        {others.length === 0 ? <p className="muted small">Nothing open on others.</p> : renderList(others)}
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
    detail = (
      <>
        <h2 className="section-title">{town ? `Local support · ${town}` : "Local support"}</h2>
        {trades.length === 0 && <p className="muted">No local providers listed for your town yet.</p>}
        {trades.map((trade) => (
          <div key={trade} style={{ marginBottom: 14 }}>
            <strong style={{ fontSize: 15 }}>{trade}</strong>
            <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
              {services[trade].slice(0, 5).map((v) => (
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
        ))}
      </>
    );
  }

  const sel = (p: string) => (panel === p ? "card stat statlink selected" : "card stat statlink");

  return (
    <main className="wrap" style={{ paddingTop: 16, paddingBottom: 64 }}>
      {/* Community banner - admin-set text with a link behind it. */}
      {banner?.text &&
        (banner.url ? (
          <a href={banner.url} className="banner" target="_blank" rel="noreferrer">{banner.text}</a>
        ) : (
          <p className="banner">{banner.text}</p>
        ))}

      <section className="youband">
        <Link href="/my?panel=weather" className={sel("weather")}>
          <span className="stat-kicker">{town ? `Weather · ${town}` : "Weather"}</span>
          {weather ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: "var(--brand)" }}><WxIcon icon={weather.icon} /></span>
              <span className="stat-big">{weather.tempF}°</span>
              <span className="muted small">{weather.label}</span>
            </span>
          ) : (
            <span className="stat-big muted">—</span>
          )}
        </Link>

        <Link href="/my?panel=trash" className={sel("trash")}>
          <span className="stat-kicker">Trash days</span>
          {townServices?.garbage_note ? (
            <span className="small" style={{ lineHeight: 1.4 }}>{townServices.garbage_note}</span>
          ) : (
            <span className="stat-big muted">—</span>
          )}
        </Link>

        <Link href="/my?panel=tasks" className={sel("tasks")}>
          <span className="stat-kicker">Tasks</span>
          <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6 }}>
            <span className="stat-big">{onMe}</span>
            <span className="muted small">on you · {onOthers} on others</span>
          </span>
        </Link>

        <Link href="/my?panel=local" className={sel("local")}>
          <span className="stat-kicker">Hire local support</span>
          <span className="small" style={{ lineHeight: 1.4 }}>
            {Object.keys(services).length > 0
              ? `${Object.keys(services).length} trades near you`
              : "Plumbers, electricians, more"}
          </span>
        </Link>
      </section>

      {detail && (
        <section className="card" style={{ marginTop: 14, padding: "16px 20px" }}>
          {detail}
        </section>
      )}
    </main>
  );
}
