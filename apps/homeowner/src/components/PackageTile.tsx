import Link from "next/link";
import type { Package } from "@/lib/catalogue";
import { Illustration } from "./Illustrations";

// PackageTile - icon, title, kicker; variants: default, coming-soon, quote,
// escape-hatch, skeleton.
export function PackageTile({ pkg }: { pkg: Package }) {
  const title = (
    <div className="card-title">
      {pkg.tile_title}
      {pkg.tile_line2 && <small>{pkg.tile_line2}</small>}
    </div>
  );
  if (pkg.availability === "coming_soon") {
    return (
      <div className="tile disabled" aria-disabled="true" title="Coming soon">
        <div className="art"><Illustration name={pkg.illustration} /></div>
        {title}
        <span className="tag tag-neutral" style={{ marginTop: "auto", alignSelf: "flex-start" }}>Coming soon</span>
      </div>
    );
  }
  return (
    <Link href={`/packages/${pkg.code}`} className="tile">
      <div className="art"><Illustration name={pkg.illustration} /></div>
      {title}
      {pkg.availability === "priced" && <div className="card-kicker">Priced instantly</div>}
      {pkg.availability === "quote" && <span className="tag tag-outline" style={{ marginTop: "auto", alignSelf: "flex-start" }}>Get a quote</span>}
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
