import { createClient } from "@/lib/supabase/server";
import { saveBanner, savePublicTagline, saveTips, saveTrashRetention, saveWelcomeVideo } from "../actions";
import { LandingPhoto } from "../LandingPhoto";

export const dynamic = "force-dynamic";
export const metadata = { title: "Site design · Admin" };

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

// SITE DESIGN - everything a stranger or a member READS, in one place.
//
// All of this used to live on /admin itself, below the six section tiles, so
// the administration landing was a mile of forms you scrolled past to reach
// anything (Shahar, 2026-09-20: "admin page should focus only on
// administration and not visibility into projects" - the same complaint from
// the other side: the landing was not a console, it was a settings sheet with
// a console stapled to the top).
//
// It is one screen and not six because these are the same decision made seven
// times: what words and pictures the platform shows when nobody has asked it
// anything yet.
export default async function AdminSitePage() {
  const supabase = await createClient();

  const { data: cfgRow } = await supabase
    .from("config")
    .select("trash_retention_days, welcome_video_url, public_tagline, public_tagline_shown, landing_hero_url, bob_hero_url")
    .maybeSingle();
  const trashDays = cfgRow?.trash_retention_days ?? 14;

  const { data: bannerRows } = await supabase
    .from("community_banners")
    .select("text, url, is_active")
    .order("created_at", { ascending: false })
    .limit(1);
  const banner = bannerRows?.[0] ?? null;

  const { data: tipRows } = await supabase.from("seasonal_tips").select("month, tip").order("month");

  return (
    <main className="wrap" style={{ paddingTop: 32, paddingBottom: 96 }}>
      <span className="kicker">Admin</span>
      <h1 style={{ fontSize: 26, margin: "6px 0 4px" }}>Site design</h1>
      <p className="muted small" style={{ margin: "0 0 18px", maxWidth: 620 }}>
        The words and pictures every app shows before anyone asks it anything.
        Edits reach every visitor within five minutes.
      </p>

      <div className="card" style={{ display: "grid", gap: 8 }}>
        <h2 className="section-title">Public tagline</h2>
        <p className="muted small" style={{ margin: 0 }}>
          The line under the logo on public pages, in all four apps. Signed-in
          screens show the app&apos;s own name there instead, so this is what a
          stranger reads. Up to 120 characters.
        </p>
        <form action={savePublicTagline} className="btn-row">
          <input name="tagline" className="input" maxLength={120}
            defaultValue={cfgRow?.public_tagline ?? ""}
            placeholder="A real community, not just a marketplace." style={{ maxWidth: 420 }} />
          {/* Shahar (2026-09-14): "next to it, set a checkbox - click to
              display and remove to hide." The words and whether they are shown
              are one decision, so they save together. */}
          <label className="small" style={{ display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
            <input type="checkbox" name="shown" value="1" defaultChecked={!!cfgRow?.public_tagline_shown} />
            Show over the landing photo
          </label>
          <button className="btn">Save</button>
        </form>
      </div>

      <div className="card" style={{ display: "grid", gap: 8 }}>
        <h2 className="section-title">Landing photo</h2>
        <p className="muted small" style={{ margin: 0 }}>
          The first thing a stranger sees on the homeowner app — the top third of the page,
          before any words.
        </p>
        <LandingPhoto url={(cfgRow?.landing_hero_url as string | null) ?? null} />
      </div>

      <div className="card" style={{ display: "grid", gap: 8 }}>
        <h2 className="section-title">Bob&apos;s photo</h2>
        <p className="muted small" style={{ margin: 0 }}>
          Behind the Ask Bob box at the top of a member&apos;s home screen.
        </p>
        <LandingPhoto
          url={(cfgRow?.bob_hero_url as string | null) ?? null}
          which="bob"
          hint="Somebody who knows the work — a tradesman mid-job, hands on something real. The search box sits over the bottom half, so keep faces and detail in the top two thirds. Landscape, and the wider the better."
          removed="Removed. The Ask Bob band draws its own ground again." />
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
          <div><button className="btn">Save banner</button></div>
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

      <details className="card tradefold">
        <summary>Monthly home tips</summary>
        <p className="muted small" style={{ margin: "6px 0 10px" }}>
          The &ldquo;This month&rdquo; nudge on every dashboard — one per month.
        </p>
        <form action={saveTips} style={{ display: "grid", gap: 8 }}>
          {MONTHS.map((name, i) => (
            <div key={name} className="field" style={{ marginBottom: 0 }}>
              <label>{name}</label>
              <textarea name={`tip_${i + 1}`} className="input" rows={2}
                defaultValue={(tipRows ?? []).find((t) => t.month === i + 1)?.tip ?? ""} />
            </div>
          ))}
          <div><button className="btn">Save tips</button></div>
        </form>
      </details>
    </main>
  );
}
