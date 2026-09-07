import Link from "next/link";
import { createClient } from "@shared/supabase/server";
import { loadTiles } from "@shared/catalogue";
import { isSignedIn } from "@shared/supabase/session";
import { AppBar, Screen, StepKicker } from "@shared/ui";
import { MoreTile, PackageTile } from "@/components/PackageTile";
import { HomeTabs } from "@/components/HomeTabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Packages" };

// Screen 4a - the grid IS the catalogue. Ordered by what can be priced
// instantly; a More tile holds the rest.
export default async function PackagesPage() {
  const supabase = await createClient();
  const [{ tiles }, signedIn] = await Promise.all([loadTiles(), isSignedIn(supabase)]);
  const front = tiles.filter((p) => p.tile_group === "front" && p.availability !== "coming_soon");
  const more = tiles.filter((p) => p.tile_group === "more" || p.availability === "coming_soon");
  return (
    <Screen>
      <AppBar brand right={signedIn ? undefined : <Link href="/login" className="btn btn-ghost">Sign in</Link>} />
      <div className="body">
        <StepKicker>Step 1 of 3</StepKicker>
        <div className="hero">
          <h1>What would you like to get done?</h1>
          <p className="lead">Every package is pre-priced. Tap one to see what&apos;s included.</p>
        </div>
        <div className="tiles">
          {front.map((p) => <PackageTile key={p.code} pkg={p} />)}
          <MoreTile count={more.length} />
        </div>
        <p className="small text-muted" style={{ margin: 0 }}>Every price carries the same label: <em>estimate pending contractor confirmation</em>. One number, same for every neighbor.</p>
      </div>
      {signedIn && <HomeTabs current="packages" />}
    </Screen>
  );
}
