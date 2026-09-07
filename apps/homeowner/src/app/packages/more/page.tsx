import Link from "next/link";
import { createClient } from "@shared/supabase/server";
import { COMMUNITY_SERVICES, loadCatalogue } from "@shared/catalogue";
import { AppBar, Screen } from "@shared/ui";
import { PackageTile } from "@/components/PackageTile";
import { Illustration } from "@shared/Illustrations";

export const dynamic = "force-dynamic";
export const metadata = { title: "More packages" };

// Screen 4b - More: priced, coming soon (greyed, unclickable), the quote
// track (kitchen, bath), the something-else escape hatch, and the
// community-services slot.
export default async function MorePage() {
  const supabase = await createClient();
  const { packages } = await loadCatalogue(supabase);
  const more = packages
    .filter((p) => p.tile_group === "more" || p.availability === "coming_soon")
    .sort((a, b) => rank(a.availability) - rank(b.availability) || a.sort_order - b.sort_order);
  return (
    <Screen>
      <AppBar back="/packages" title="More packages" />
      <div className="body">
        <div className="tiles">
          {more.map((p) => <PackageTile key={p.code} pkg={p} />)}
        </div>
        <div className="divider-label">Community services</div>
        {COMMUNITY_SERVICES.map((s) => (
          <Link key={s.code} href={`/services/${s.code}`} className="tile wide">
            <div className="art"><Illustration name={s.illustration} /></div>
            <div className="grow">
              <div className="card-title">{s.name}</div>
              <div className="small text-muted">{s.summary}</div>
            </div>
            <span className="tag tag-accent">{s.cadence}</span>
          </Link>
        ))}
      </div>
    </Screen>
  );
}

const rank = (a: string) => (a === "priced" ? 0 : a === "coming_soon" ? 1 : a === "quote" ? 2 : 3);
