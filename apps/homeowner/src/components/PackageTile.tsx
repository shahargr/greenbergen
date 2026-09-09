import Link from "next/link";
import { dimReason, isBookable, isOpen, type Tile } from "@shared/catalogue";
import { Illustration } from "@shared/Illustrations";

// PackageTile - icon, title, and one line saying where this package stands.
//
// Three states, from two questions - do we have a price (availability) and
// is anyone approved to do it (covered):
//   LIVE   priced and covered: tap to book at the community price.
//   ASK    covered, no fixed price (quote / custom): tap to tell a person
//          what you need - the general contractor, a kitchen, a bath. White
//          like a live tile, because it IS live (Shahar); the kicker says a
//          person answers, not a price.
//   DIM    coming soon, or nobody approved carries the trade yet. Still
//          tappable, because the page behind it is worth reading.
export function PackageTile({ pkg }: { pkg: Tile }) {
  const title = (
    <div className="card-title">
      {pkg.tile_title}
      {pkg.tile_line2 && <small>{pkg.tile_line2}</small>}
    </div>
  );

  if (isBookable(pkg)) {
    return (
      <Link href={`/packages/${pkg.code}`} className="tile">
        <div className="art"><Illustration name={pkg.illustration} /></div>
        {title}
        <div className="card-kicker">Priced instantly</div>
      </Link>
    );
  }

  if (isOpen(pkg)) {
    return (
      <Link href={`/packages/${pkg.code}`} className="tile ask">
        <div className="art"><Illustration name={pkg.illustration} /></div>
        {title}
        <div className="card-kicker">Ask a person</div>
      </Link>
    );
  }

  return (
    <Link href={`/packages/${pkg.code}`} className="tile dim">
      <div className="art"><Illustration name={pkg.illustration} /></div>
      {title}
      <div className="card-kicker">{dimReason(pkg)}</div>
    </Link>
  );
}

export function MoreTile({ count }: { count: number }) {
  return (
    <Link href="/packages/more" className="tile wide">
      <div className="art"><Illustration name="something_else" /></div>
      <div className="grow">
        <div className="card-title">More packages</div>
        <div className="small text-muted">Siding, windows, deck, solar, kitchen, bath, something else…</div>
      </div>
      <span className="tag tag-neutral">{count}</span>
    </Link>
  );
}

export function TileSkeleton() {
  return (
    <div className="tile skeleton" aria-hidden>
      <div className="skel" style={{ width: 40, height: 40 }} />
      <div className="skel" style={{ height: 14, width: "80%" }} />
      <div className="skel" style={{ height: 10, width: "50%", marginTop: "auto" }} />
    </div>
  );
}
