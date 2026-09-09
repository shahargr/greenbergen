import Link from "next/link";
import { createClient } from "@shared/supabase/server";
import { isBookable, loadTagline, loadTiles } from "@shared/catalogue";
import { isSignedIn } from "@shared/supabase/session";
import { AppBar, Screen, ShellIcons, StepKicker } from "@shared/ui";
import { PackageTile } from "@/components/PackageTile";
import { HomeTabs } from "@/components/HomeTabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "Packages" };

// Screen 4a - the grid IS the catalogue, and it is the same two groups the
// home screen uses: what we can do now, and what we cannot do yet. Split once,
// in the same words, in both places - a visitor who joins should not have to
// re-learn the shelf.
export default async function PackagesPage() {
  const supabase = await createClient();
  const [{ tiles }, signedIn, tagline] = await Promise.all([loadTiles(), isSignedIn(supabase), loadTagline()]);
  const headline = tiles.filter((t) => t.tile_group === "front").sort((a, b) => a.sort_order - b.sort_order);
  const rest = tiles.filter((t) => t.tile_group !== "front");
  const live = rest.filter(isBookable);
  const dim = rest.filter((t) => !isBookable(t));
  return (
    <Screen>
      <AppBar brand door={signedIn ? "homeowner" : undefined} tagline={tagline} right={signedIn ? <ShellIcons /> : <Link href="/login" className="btn btn-ghost">Sign in</Link>} />
      <div className="body">
        <StepKicker>Step 1 of 3</StepKicker>
        <div className="hero">
          <h1>What would you like to get done?</h1>
          <p className="lead">Every package is pre-priced. Tap one to see what&apos;s included.</p>
        </div>
        {headline.length > 0 && (
          <div className="tiles quad">
            {headline.map((p) => <PackageTile key={p.code} pkg={p} />)}
          </div>
        )}
        {live.length > 0 && (
          <section className="stack" style={{ gap: 8, marginTop: 4 }}>
            <div className="divider-label">Also ready now</div>
            <div className="tiles quad">
              {live.map((p) => <PackageTile key={p.code} pkg={p} />)}
            </div>
          </section>
        )}
        {dim.length > 0 && (
          <section className="stack" style={{ gap: 8, marginTop: 4 }}>
            <div className="divider-label">Not yet</div>
            <p className="tiny text-muted" style={{ margin: "-4px 0 2px" }}>
              Priced, but nobody approved covers it yet — or it needs a look first. Open one to read
              what it involves.
            </p>
            <div className="tiles quad">
              {dim.map((p) => <PackageTile key={p.code} pkg={p} />)}
            </div>
          </section>
        )}
        <Link href="/packages/more" className="home-row">
          <span className="grow">
            <span className="t">Community services</span>
            <span className="m" style={{ display: "block" }}>Things a whole street buys together — priced when enough neighbors are in.</span>
          </span>
          <span aria-hidden>›</span>
        </Link>
        <p className="small text-muted" style={{ margin: 0 }}>Every price carries the same label: <em>estimate pending contractor confirmation</em>. One number, same for every neighbor.</p>
      </div>
      {signedIn && <HomeTabs current="packages" />}
    </Screen>
  );
}
