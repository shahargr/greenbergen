import Link from "next/link";
import { createClient } from "@shared/supabase/server";
import { COMMUNITY_SERVICES, isOpen, loadTiles } from "@shared/catalogue";
import { isSignedIn } from "@shared/supabase/session";
import { AppBar, ChevronIcon, Screen, ShellIcons, StepKicker } from "@shared/ui";
import { dollars } from "@shared/format";
import { Scene } from "@/components/Scene";

export const dynamic = "force-dynamic";
export const metadata = { title: "Packages" };

// Screen 4a - the grid IS the catalogue, and it is the same two groups the
// home screen uses: what we can do now, and what we cannot do yet. Split once,
// in the same words, in both places - a visitor who joins should not have to
// re-learn the shelf.
export default async function PackagesPage() {
  const supabase = await createClient();
  const [{ tiles }, signedIn] = await Promise.all([loadTiles(), isSignedIn(supabase)]);
  // THE ENABLED ONES FIRST (Shahar): within the headline row, what you can
  // act on today before what is coming soon, each group in its own order.
  const headline = tiles.filter((t) => t.tile_group === "front")
    .sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || a.sort_order - b.sort_order);
  const rest = tiles.filter((t) => t.tile_group !== "front");
  // Open, not merely bookable: a covered quote package (the general
  // contractor) is a live door with a person behind it.
  const live = rest.filter(isOpen);
  const dim = rest.filter((t) => !isOpen(t));
  return (
    <Screen>
      <AppBar brand right={signedIn ? <ShellIcons  homeHref="/project" /> : <Link href="/login" className="btn btn-ghost">Sign in</Link>} />
      <div className="body">
        <StepKicker>Step 1 of 3</StepKicker>
        <div className="hero">
          <h1>What would you like to get done?</h1>
          <p className="lead">We negotiate and price these services on behalf of our community.</p>
        </div>
        {headline.length > 0 && (
          <div className="scene-grid">
            {headline.map((p) => <Scene key={p.code} t={p} />)}
          </div>
        )}
        {live.length > 0 && (
          <section className="stack" style={{ gap: 8, marginTop: 4 }}>
            <div className="divider-label">Renovation</div>
            <div className="scene-grid">
              {live.map((p) => <Scene key={p.code} t={p} />)}
            </div>
          </section>
        )}
        {/* COMING SOON, folded. Shahar: hide it under a dropdown. The grid of
            things you cannot book yet was taking more of the screen than the
            things you can; it opens on a tap, counted, and the tiles inside
            say "Coming soon" rather than describing our staffing to a
            customer. What is dim is still decided
            by coverage in the database, not here. */}
        {dim.length > 0 && (
          <details className="home-panel" style={{ marginTop: 4 }}>
            <summary className="home-row">
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="t">Coming soon · {dim.length}</span>
                <span className="m" style={{ display: "block" }}>Not bookable yet. Open one to read what it involves.</span>
              </span>
              <span className="chev"><ChevronIcon /></span>
            </summary>
            <div className="drawer" style={{ paddingTop: 12 }}>
              <div className="scene-grid">
                {dim.map((p) => <Scene key={p.code} t={p} />)}
              </div>
            </div>
          </details>
        )}

        {/* GROUP PURCHASES (community services in the data), folded the same way: a list in place rather
            than a hop to another screen. Each row opens the service. */}
        <details className="home-panel">
          <summary className="home-row">
            <span className="grow" style={{ minWidth: 0 }}>
              <span className="t">Group purchases · {COMMUNITY_SERVICES.length}</span>
              <span className="m" style={{ display: "block" }}>Things we can purchase together to save time and money.</span>
            </span>
            <span className="chev"><ChevronIcon /></span>
          </summary>
          <div className="drawer stack" style={{ gap: 8, paddingTop: 12 }}>
            {COMMUNITY_SERVICES.map((s) => (
              <Link key={s.code} href={`/services/${s.code}`} className="home-row"
                    style={{ background: "var(--color-soft-2)", boxShadow: "none" }}>
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="t">{s.name}</span>
                  <span className="m" style={{ display: "block" }}>{dollars(s.price_cents)} · {s.price_label}</span>
                </span>
                <ChevronIcon />
              </Link>
            ))}
          </div>
        </details>
        <p className="small text-muted" style={{ margin: 0 }}>Every price carries the same label: <em>estimate pending contractor confirmation</em>. One number, same for every neighbor.</p>
      </div>
    </Screen>
  );
}
