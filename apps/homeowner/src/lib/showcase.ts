import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@shared/supabase/keys";
import { timed } from "@shared/perf";

// THE HOUSES ON THE FRONT DOOR. public_company() is the portal's anon-safe
// read of what Green Bergen has built and is building; its `showcase` list
// is the projects Shahar flagged for the public (projects.showcase), live
// ones first. Read the same way as the catalogue - a cached fetch with the
// publishable key, no cookie, one call per five minutes for everyone.
export type House = {
  slug: string | null;
  title: string;     // the address's street line, else the project name
  town: string | null;
  completed: boolean;
  photo: string | null;
};

type Row = { project_name: string; address: string | null; public_slug: string | null; completed: boolean; hero_photo_url: string | null };

export async function loadShowcase(): Promise<House[]> {
  try {
    const res = await timed("showcase", () =>
      fetch(`${SUPABASE_URL}/rest/v1/rpc/public_company`, {
        method: "POST",
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json" },
        body: "{}",
        cache: "force-cache",
        next: { revalidate: 300, tags: ["showcase"] },
      }));
    if (!res.ok) return [];
    const company = (await res.json()) as { showcase?: Row[] } | null;
    const rows = Array.isArray(company?.showcase) ? company!.showcase! : [];
    return rows.map((r) => {
      const parts = (r.address ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      return {
        slug: r.public_slug,
        title: parts[0] || r.project_name,
        town: parts[1] ?? null,
        completed: !!r.completed,
        photo: r.hero_photo_url,
      };
    });
  } catch (e) {
    console.error("public_company:", e instanceof Error ? e.message : e);
    return [];
  }
}
