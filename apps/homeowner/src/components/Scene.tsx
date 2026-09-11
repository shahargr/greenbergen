import Link from "next/link";
import { dimReason, fromPrice, isBookable, isOpen, type Tile } from "@shared/catalogue";
import { Illustration } from "@shared/Illustrations";
import { dollars } from "@shared/format";

// ONE PACKAGE, THE WAY THE FRONT DOOR SHOWS IT.
//
// Shahar (2026-09-11), pointing at the signed-in home screen: "make this
// look like homeowner landing." The landing sells with the WORK - a
// photograph of the thing, its name, and what it costs the community. The
// signed-in screen was selling the same packages as small line drawings in
// a four-up grid, which is a filing cabinet, not a shop window. A member
// deciding what to do next is doing the same thing a visitor is.
//
// So the scene is one component now and all three screens draw it: the
// landing, the home screen, and the catalogue. The photograph is data
// (blueprint_packages.photo_url, Admin > Packages); a package without one
// yet draws its line art on the warm ground, so the page reads the same
// before and after the photos are taken.
//
// The caption says where the package stands, in the same three states
// PackageTile has always used - priced, ask a person, coming soon - because
// the picture must not promise a price nobody can honour.
export function Scene({ t }: { t: Tile }) {
  const floor = fromPrice(t);
  const open = isOpen(t);
  // "from" is the package's floor - its cheapest configuration - read from
  // the package, never typed here (053).
  const line = isBookable(t) && floor != null ? `from ${dollars(floor)}`
    : open ? "Ask a person"
    : dimReason(t);
  return (
    <Link href={`/packages/${t.code}`} className={`scene ${open ? "" : "dim"}`}>
      <span className={`scene-pic ${t.photo_url ? "" : "drawn"}`}>
        {t.photo_url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={t.photo_url} alt={t.tile_title} loading="lazy" decoding="async" />
          : <Illustration name={t.illustration} />}
      </span>
      <span className="scene-cap">
        <strong>{t.tile_title}{t.tile_line2 ? <small> {t.tile_line2}</small> : null}</strong>
        <span className="small">{line}</span>
      </span>
    </Link>
  );
}

// The tail of a rail: what is behind "all of them".
export function SceneMore({ count, href = "/packages" }: { count: number; href?: string }) {
  return (
    <Link href={href} className="scene more">
      <span className="scene-more">
        <strong>All {count} packages</strong>
        <span className="small text-muted">Every one pre-priced for the community.</span>
        <span className="chev">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
        </span>
      </span>
    </Link>
  );
}
