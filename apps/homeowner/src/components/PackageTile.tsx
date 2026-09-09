import Link from "next/link";
import { dimReason, isBookable, type Tile } from "@shared/catalogue";
import { Illustration } from "@shared/Illustrations";

// PackageTile - icon, title, and one line saying where this package stands.
//
// There are exactly two states, and they come from two different questions:
// do we have a price (availability) and is anyone approved to do it (covered).
// A tile is LIVE only when both are yes. Everything else is DIM - still
// tappable, because the page behind it is worth reading and the DIY route
// needs no contractor at all, but honest on the tile about why it is not a
// "book now".
//
// The dim state is deliberately not a dead end. The old coming-soon tile was
// a <div> nobody could open, which meant a member could not even find out what
// the job involves. Only a package with no page at all should be inert.
export function PackageTile({ pkg }: { pkg: Tile }) {
  const live = isBookable(pkg);
  const title = (
    <div className="card-title">
      {pkg.tile_title}
      {pkg.tile_line2 && <small>{pkg.tile_line2}</small>}
    </div>
  );

  if (live) {
    return (
      <Link href={`/packages/${pkg.code}`} className="tile">
        <div className="art"><Illustration name={pkg.illustration} /></div>
        {title}
        <div className="card-kicker">Priced instantly</div>
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
