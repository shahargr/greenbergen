import { dollars } from "@shared/format";
import type { PackageProduct } from "@shared/catalogue";

// WHAT YOU BUY YOURSELF.
//
// Shahar (2026-09-12), on the EV charger at $750 for the labour: "Build a
// list of suggested products to purchase as part of the package, which is
// optional. Just grab the product name, rating if you have, price, and short
// link stating the product and store (ex. EVIQO Level 2 EV - Amazon)."
//
// OPTIONAL, and never part of the price - the package buys the labour, the
// permit and the inspection, and the hardware is the member's own purchase
// from whoever they like. So this is a list of suggestions, in the store's
// own words, with the date we last looked: a price we snapshot is not a price
// we can promise, and saying when we checked is the only honest way to show
// one. A product nobody has recorded a price or a rating for simply shows
// neither, rather than a guess.
export function PackageProducts({ products }: { products: PackageProduct[] }) {
  if (products.length === 0) return null;
  return (
    <section className="stack" style={{ gap: 8 }}>
      <div>
        <h6>What you buy yourself</h6>
        <p className="small text-muted" style={{ margin: "2px 0 0" }}>
          Optional, and not part of the price. Any Level 2 unit works — these are the ones we see
          most often. You buy it direct; we install whatever turns up.
        </p>
      </div>
      {products.map((p) => (
        <a key={p.id} href={p.url} target="_blank" rel="noreferrer noopener" className="home-row">
          <span className="grow" style={{ minWidth: 0 }}>
            <span className="t">{p.name} — {p.store}</span>
            <span className="m" style={{ display: "block" }}>
              {[
                p.rating != null
                  ? `${p.rating.toFixed(1)}★${p.rating_count ? ` · ${p.rating_count.toLocaleString()} ratings` : ""}`
                  : null,
                p.price_cents != null ? dollars(p.price_cents) : null,
                p.checked_on ? `as of ${p.checked_on}` : "price and rating not recorded yet",
                p.note,
              ].filter(Boolean).join(" · ")}
            </span>
          </span>
          <OutIcon />
        </a>
      ))}
      <p className="tiny text-muted" style={{ margin: 0 }}>
        Prices and ratings are what the store showed when we last looked, not a quote from us, and
        they move. Nothing here is bought through Green Bergen.
      </p>
    </section>
  );
}

const OutIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none", opacity: .5 }}>
    <path d="M14 4h6v6" /><path d="M20 4 11 13" /><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
  </svg>
);
