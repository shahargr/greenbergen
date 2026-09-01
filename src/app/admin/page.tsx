import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { saveBanner } from "./actions";

// Admin landing: one tile per section. Sections grow as their screens get
// built; the tiles say honestly which are live.
const SECTIONS = [
  { href: "/admin/photos", title: "Public pages", note: "Hero photos, galleries, about text, scope facts.", live: true },
  { href: "/admin/users", title: "User management", note: "Accounts, invitations, roles.", live: false },
  { href: "/admin/finance", title: "Finance", note: "Agreements, billing, receivables.", live: false },
  { href: "/admin/projects", title: "Project management", note: "Projects, members, inquiries.", live: false },
];

export default async function AdminHome() {
  const supabase = await createClient();
  const { data: me } = await supabase.rpc("me");
  const { data: bannerRows } = await supabase
    .from("community_banners")
    .select("text, url, is_active")
    .order("created_at", { ascending: false })
    .limit(1);
  const banner = bannerRows?.[0] ?? null;

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
            <strong>{s.title}</strong>
            <span className="muted small">{s.note}</span>
            {!s.live && <span className="small" style={{ color: "var(--brand)" }}>To be developed</span>}
          </Link>
        ))}
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
    </main>
  );
}
