import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PhotoManager, type AdminRow } from "./PhotoManager";

// Superadmin-only: everything a project shows publicly - hero photo, gallery
// (elevations, floor plans, photos), about text and the scope facts. Empty
// text fields fall back to the Master Template per field.
export default async function AdminPhotosPage() {
  const supabase = await createClient();
  const { data: me } = await supabase.rpc("me");

  if (!me?.is_superadmin) {
    return (
      <main className="wrap" style={{ paddingTop: 64, maxWidth: 560 }}>
        <h1>Public pages</h1>
        <p className="muted">This screen is for administrators.</p>
        <Link href="/">&larr; Back home</Link>
      </main>
    );
  }

  const { data: projects } = await supabase
    .from("projects")
    .select("id, project_name, public_slug")
    .not("public_slug", "is", null)
    .order("project_name");

  const ids = (projects ?? []).map((p) => p.id);
  const { data: abouts } = await supabase
    .from("project_about_pages")
    .select("project_id, hero_photo_url, headline, body, scope_note, garage_note, total_sqft, built_year")
    .in("project_id", ids);

  const rows: AdminRow[] = (projects ?? []).map((p) => {
    const a = (abouts ?? []).find((x) => x.project_id === p.id);
    return {
      project_name: p.project_name as string,
      public_slug: p.public_slug as string,
      hero_photo_url: (a?.hero_photo_url as string) ?? null,
      headline: (a?.headline as string) ?? "",
      body: (a?.body as string) ?? "",
      scope_note: (a?.scope_note as string) ?? "",
      garage_note: (a?.garage_note as string) ?? "",
      total_sqft: a?.total_sqft ? String(a.total_sqft) : "",
      built_year: a?.built_year ? String(a.built_year) : "",
    };
  });

  return (
    <main className="wrap" style={{ paddingTop: 40, paddingBottom: 96, maxWidth: 680 }}>
      <span className="kicker">Admin</span>
      <h1 style={{ fontSize: 26, margin: "6px 0 4px" }}>Public pages</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Everything a project shows the world: hero photo, plans &amp; photos,
        the about text and the scope facts. Changes go live immediately.
      </p>
      <PhotoManager rows={rows} />
    </main>
  );
}
