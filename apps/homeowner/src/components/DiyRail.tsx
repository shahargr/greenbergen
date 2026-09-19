import Link from "next/link";
import { Illustration } from "@shared/Illustrations";
import type { Tile } from "@shared/catalogue";

// DO IT YOURSELF (Shahar, 2026-09-19): "Below have an area speaking on DIY
// for projects we want to promote in carousel. Starting with emergency power,
// washing machines and dry heaters replacement, etc."
//
// WHICH PROJECTS, decided by data rather than by a list typed here. A
// package carries blueprint_packages.promote - the flag Admin already uses to
// say "this is what we are pushing" - so the rail is what is promoted, in the
// catalogue's own order, and the way to change it is to change the flag, not
// to come back to this file. A photograph and a name are all a card needs;
// anything without a photograph draws its line art, same as the shop rail.
//
// WHERE A CARD GOES: /packages/<code>/how - the step-by-step, out of the same
// library the office follows, with the trades each step needs named. That
// page is honest when nothing has been written for a package yet, which is
// why a card can be shown before the walkthrough exists.
export function DiyRail({ tiles, more = true }: { tiles: Tile[]; more?: boolean }) {
  if (tiles.length === 0) return null;
  return (
    <section className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ alignItems: "center", gap: 10 }}>
        <div className="divider-label" style={{ flex: 1 }}>Do it yourself</div>
        <Link href="/packages" className="small row"
          style={{ fontWeight: 700, whiteSpace: "nowrap", gap: 0, alignItems: "center" }}>
          All projects
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 6 6 6-6 6" /></svg>
        </Link>
      </div>
      <p className="small text-muted" style={{ margin: "-4px 0 0" }}>
        The same steps we follow, in the same order — including which parts need a licensed hand and which
        you can do on a Saturday.
      </p>
      <div className="scenes four tall" aria-label="Do it yourself">
        {tiles.map((t) => (
          <Link key={t.code} href={`/packages/${t.code}/how`} className="scene">
            <span className={`scene-pic ${t.photo_url ? "" : "drawn"}`}>
              {t.photo_url
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={t.photo_url} alt={t.tile_title} loading="lazy" decoding="async" />
                : <Illustration name={t.illustration} />}
              <span className="diy-flag">DIY</span>
            </span>
            <span className="scene-cap">
              <strong>{t.tile_title}{t.tile_line2 ? <small> {t.tile_line2}</small> : null}</strong>
              <span className="small text-muted">See the steps</span>
            </span>
          </Link>
        ))}
        {more && (
          <Link href="/packages" className="scene more">
            <span className="scene-more">
              <strong>More to do yourself</strong>
              <span className="small text-muted">Every package has its walkthrough.</span>
              <span className="chev">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 6 6 6-6 6" /></svg>
              </span>
            </span>
          </Link>
        )}
      </div>
    </section>
  );
}

// WHAT GOES ON THE RAIL. Promoted first, in the catalogue's order, then
// anything else with a photograph to show - never a package that is not open,
// because a card that leads to a walkthrough for work nobody can take on is a
// dead end dressed as a project.
export function diyTiles(tiles: Tile[], n = 6): Tile[] {
  const live = tiles.filter((t) => t.availability !== "coming_soon");
  const promoted = live.filter((t) => t.promote);
  const rest = live.filter((t) => !t.promote && !!t.photo_url);
  return [...promoted, ...rest].slice(0, n);
}
