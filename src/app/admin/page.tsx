import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { saveBanner, savePublicTagline, saveTips, saveTrashRetention, saveWelcomeVideo, setGodMode } from "./actions";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

// Admin landing: one tile per section. Sections grow as their screens get
// built; the tiles say honestly which are live.
const SECTIONS = [
  { href: "/admin/photos", title: "Public pages", note: "Hero photos, galleries, about text, scope facts.", live: true, countKey: null },
  { href: "/admin/users", title: "User management", note: "Active accounts by type, invitations, seats.", live: true, countKey: "users" },
  { href: "/admin/stats", title: "Usage", note: "Who signs in, what they do, tasks made and closed, day by day.", live: true, countKey: null },
  { href: "/admin/finance", title: "Finance", note: "Agreements, billing, receivables.", live: false, countKey: null },
  { href: "/admin/projects", title: "Project management", note: "Every project on the platform, by kind.", live: true, countKey: "projects" },
  { href: "/admin/packages", title: "Packages", note: "The catalogue: basic setup, upgrades at cost, scope, photos, progress line.", live: true, countKey: null },
] as const;

export default async function AdminHome() {
  const supabase = await createClient();
  const { data: me } = await supabase.rpc("me");
  const godOn = (await cookies()).get("gb_god")?.value === "1";
  const { data: cfgRow } = await supabase.from("config").select("trash_retention_days, welcome_video_url, public_tagline").maybeSingle();
  const trashDays = cfgRow?.trash_retention_days ?? 14;
  const { data: bannerRows } = await supabase
    .from("community_banners")
    .select("text, url, is_active")
    .order("created_at", { ascending: false })
    .limit(1);
  const banner = bannerRows?.[0] ?? null;
  const { data: tipRows } = await supabase
    .from("seasonal_tips")
    .select("month, tip")
    .order("month");
  // The two numbers on the tiles: live projects and active accounts.
  const [{ count: projectCount }, { count: userCount }] = await Promise.all([
    supabase.from("projects").select("id", { count: "exact", head: true }).is("trashed_at", null).eq("is_template", false),
    supabase.from("app_users").select("id", { count: "exact", head: true }).eq("is_active", true),
  ]);
  const tileCount = { users: userCount ?? 0, projects: projectCount ?? 0 };

  if (!me?.is_superadmin) {
    return (
      <main className="wrap" style={{ paddingTop: 64, maxWidth: 560 }}>
        <h1>Admin</h1>
        <p className="muted">This area is for administrators.</p>
        <Link href="/">&larr; Back home</Link>
      </main>
    );
  }

  return (
    <main className="wrap" style={{ paddingTop: 32, paddingBottom: 96 }}>
      <span className="kicker">Admin</span>
      <h1 style={{ fontSize: 26, margin: "6px 0 16px" }}>Overview</h1>
      <div className="admin-tiles">
        {SECTIONS.map((s) => (
          <Link key={s.href} href={s.href} className="card statlink admin-tile">
            <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
              <strong>{s.title}</strong>
              {s.countKey && <span className="stat-big" style={{ fontSize: 22 }}>{tileCount[s.countKey]}</span>}
            </span>
            <span className="muted small">{s.note}</span>
            {!s.live && <span className="small" style={{ color: "var(--brand)" }}>To be developed</span>}
          </Link>
        ))}
      </div>

      <div className="card" style={{ display: "grid", gap: 8 }}>
        <h2 className="section-title">Public tagline</h2>
        <p className="muted small" style={{ margin: 0 }}>
          The line under the logo on public pages, in all four apps. Signed-in
          screens show the app&apos;s own name there instead, so this is what a
          stranger reads. Up to 120 characters; edits reach every app within
          five minutes.
        </p>
        <form action={savePublicTagline} className="btn-row">
          <input name="tagline" className="input" maxLength={120}
            defaultValue={cfgRow?.public_tagline ?? ""}
            placeholder="A real community, not just a marketplace." style={{ maxWidth: 420 }} />
          <button className="btn">Save</button>
        </form>
      </div>

      <div className="card" style={{ display: "grid", gap: 8 }}>
        <h2 className="section-title">Welcome video</h2>
        <p className="muted small" style={{ margin: 0 }}>
          Shown to first-run users on their welcome screen until they tick &ldquo;don&apos;t show this again&rdquo;.
          YouTube link or a direct MP4 URL; empty hides it for everyone.
        </p>
        <form action={saveWelcomeVideo} className="btn-row">
          <input name="url" className="input" defaultValue={cfgRow?.welcome_video_url ?? ""}
            placeholder="https://youtu.be/…" style={{ maxWidth: 340 }} />
          <button className="btn">Save</button>
        </form>
      </div>

      <div className="card" style={{ display: "grid", gap: 8 }}>
        <h2 className="section-title">Recycle bin policy</h2>
        <p className="muted small" style={{ margin: 0 }}>
          Deleted projects stay restorable this many days, then purge automatically (nightly).
        </p>
        <form action={saveTrashRetention} className="btn-row">
          <input name="days" className="input" inputMode="numeric" defaultValue={String(trashDays)} style={{ maxWidth: 100 }} />
          <button className="btn">Save</button>
        </form>
      </div>

      <div className="card" style={{ marginTop: 18, padding: "18px 20px", maxWidth: 560 }}>
        <h2 className="section-title">Community banner</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          The headline every signed-in user sees on their dashboard — use it
          for community deals. Link is optional; unchecking hides the banner.
        </p>
        <form action={saveBanner} style={{ display: "grid", gap: 10 }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="bn-text">Text</label>
            <input id="bn-text" name="text" className="input" defaultValue={banner?.text ?? ""}
              placeholder="e.g. Group deal: driveway sealing in Tenafly this month" />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="bn-url">Link (optional)</label>
            <input id="bn-url" name="url" className="input" defaultValue={banner?.url ?? ""}
              placeholder="https://..." />
          </div>
          <label className="radio-opt">
            <input type="checkbox" name="active" defaultChecked={banner?.is_active ?? true} /> Show the banner
          </label>
          <div>
            <button className="btn">Save banner</button>
          </div>
        </form>
      </div>

      <details className="card tradefold" style={{ marginTop: 14, maxWidth: 560 }}>
        <summary>Monthly home tips</summary>
        <p className="muted small" style={{ margin: "6px 0 10px" }}>
          The &ldquo;This month&rdquo; nudge on every dashboard — one per month.
        </p>
        <form action={saveTips} style={{ display: "grid", gap: 8 }}>
          {MONTHS.map((name, i) => (
            <div key={name} className="field" style={{ marginBottom: 0 }}>
              <label>{name}</label>
              <textarea
                name={`tip_${i + 1}`}
                className="input"
                rows={2}
                defaultValue={(tipRows ?? []).find((t) => t.month === i + 1)?.tip ?? ""}
              />
            </div>
          ))}
          <div>
            <button className="btn">Save tips</button>
          </div>
        </form>
      </details>

      {/* Last on purpose: a switch you flip rarely, below the things you edit. */}
      <div className="card" style={{ display: "grid", gap: 8, borderLeft: godOn ? "4px solid #7a1f2b" : undefined }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2 className="section-title" style={{ margin: 0 }}>⚡ God mode · {godOn ? "ON" : "off"}</h2>
          <form action={setGodMode}>
            <input type="hidden" name="back" value="/admin" />
            <input type="hidden" name="on" value={godOn ? "0" : "1"} />
            <button className="btn small" style={godOn ? undefined : { background: "#7a1f2b" }}>
              {godOn ? "Turn off" : "Turn on"}
            </button>
          </form>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          ON: your homepage lists <strong>every project on the platform</strong> as if you were invited to all of them,
          and every project page shows a god-mode banner. OFF: only projects you hold a seat on. Your admin rights
          themselves don&apos;t change — this only changes what is listed.
        </p>
      </div>

    </main>
  );
}
