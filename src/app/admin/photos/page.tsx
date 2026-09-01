import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PhotoManager } from "./PhotoManager";

type PublicProject = {
  project_name: string;
  public_slug: string | null;
  hero_photo_url?: string | null;
};

// Superadmin-only: set the hero photo each public project shows on the
// landing and its /p/<slug> page. Uploads go to the public-media bucket
// (world-readable by design; writes are superadmin-gated by storage policy).
export default async function AdminPhotosPage() {
  const supabase = await createClient();
  const [{ data: me }, { data: company }] = await Promise.all([
    supabase.rpc("me"),
    supabase.rpc("public_company"),
  ]);

  if (!me?.is_superadmin) {
    return (
      <main className="wrap" style={{ paddingTop: 64, maxWidth: 560 }}>
        <h1>Project photos</h1>
        <p className="muted">This screen is for administrators.</p>
        <Link href="/">&larr; Back home</Link>
      </main>
    );
  }

  const rows = [
    ...(company?.projects ?? []),
    ...(company?.completed ?? []),
  ]
    .filter((p: PublicProject) => p.public_slug)
    .map((p: PublicProject) => ({
      project_name: p.project_name,
      public_slug: p.public_slug as string,
      hero_photo_url: p.hero_photo_url ?? null,
    }));

  return (
    <main className="wrap" style={{ paddingTop: 48, paddingBottom: 96, maxWidth: 640 }}>
      <span className="kicker">Admin</span>
      <h1 style={{ fontSize: 26, margin: "6px 0 4px" }}>Project photos</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Pick an image per project — it appears immediately on the landing page
        and the project&apos;s public page.
      </p>
      <PhotoManager rows={rows} />
      <p style={{ marginTop: 20 }}>
        <Link href="/">&larr; Back home</Link>
      </p>
    </main>
  );
}
