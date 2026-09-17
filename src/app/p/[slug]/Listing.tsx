import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { BackButton } from "./BackButton";
import { InquiryForm } from "./InquiryForm";
import { Carousel, type Shot } from "./Carousel";
import { Gallery } from "./Gallery";

// A HOUSE ON THE MARKET, THE WAY SOMEBODY LOOKING FOR A HOUSE READS ONE.
//
// Shahar (2026-09-17): "Every house created in the system should have a
// landing page with more info and a form collecting information about
// potential buyers / renters. this page should have carousel for photos, and
// description similar to what you might find in Zillow."
//
// The order is what a buyer asks, in the order they ask it: what does it look
// like, where is it and what does it cost, how big is it, what is it like,
// what are the plans, how do I reach you. Every one of those sections exists
// only if the owner filled it in and left it switched on - house_page()
// already dropped what they hid, so anything null here is a section that does
// not get drawn rather than an empty box with a heading.
export type HousePage = {
  slug: string;
  project_id: string;
  purpose: string;
  on_market: boolean;
  title: string;
  address: string | null;
  town: string | null;
  headline: string;
  body: string;
  price: number | null;
  price_note: string | null;
  available_from: string | null;
  facts: {
    beds: number | null; baths: number | null; sqft: number | null; lot_size: string | null;
    built_year: number | null; garage: string | null; features: string[]; note: string | null;
  } | null;
  photos: Shot[];
  plans: { path: string; caption: string | null; kind: string }[] | null;
  build: { live: boolean; job_id: string; job: string; target_finish: string | null; gallery_slug: string | null } | null;
  contact: { name: string | null; phone: string | null; email: string | null };
  form: { enabled: boolean; kinds: string[] };
};

const money = (n: number) =>
  `$${Math.round(n).toLocaleString("en-US")}`;

const monthYear = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" });

export function Listing({ house, base }: { house: HousePage; base: string }) {
  const f = house.facts;
  const forRent = house.purpose === "for rent";
  // A rent is a monthly number unless the owner said otherwise; a sale is a
  // number. Either way the owner's own words win.
  const priceNote = house.price_note ?? (forRent ? "per month" : "asking");
  const facts: string[] = [];
  if (f?.beds) facts.push(`${f.beds} bed${f.beds === 1 ? "" : "s"}`);
  if (f?.baths) facts.push(`${f.baths} bath${f.baths === 1 ? "" : "s"}`);
  if (f?.sqft) facts.push(`${f.sqft.toLocaleString()} sq ft`);
  if (f?.lot_size) facts.push(`${f.lot_size} lot`);
  if (f?.garage) facts.push(f.garage);
  if (f?.built_year) facts.push(`built ${f.built_year}`);

  const plans = (house.plans ?? []).map((p) => ({
    name: p.path, label: p.kind === "photo" ? "" : p.kind.replace(/^./, (c) => c.toUpperCase()),
    url: `${base}/${p.path}`,
  }));

  return (
    <div className="page">
      <SiteHeader
        right={
          <>
            <BackButton />
            <Link href="/" className="iconlink" title="Home" aria-label="Home">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 10.5 12 3l9 7.5" />
                <path d="M5 9.5V21h14V9.5" />
              </svg>
            </Link>
          </>
        }
      />

      <main className="wrap" style={{ flex: 1, width: "100%", maxWidth: 760, paddingBottom: 48 }}>
        <Carousel shots={house.photos} base={base} alt={house.title} />

        {/* WHAT IT IS, WHERE IT IS, WHAT IT COSTS. */}
        <div className="lst-head">
          <span className={`lst-tag ${forRent ? "rent" : "sale"}`}>
            {forRent ? "For rent" : "For sale"}
          </span>
          {house.available_from && (
            <span className="muted small">Available {monthYear(house.available_from)}</span>
          )}
        </div>
        <h1 style={{ fontSize: "clamp(24px, 4vw, 32px)", margin: "6px 0 2px" }}>{house.title}</h1>
        {house.price != null && (
          <p className="lst-price">
            {money(house.price)}
            <span className="muted small" style={{ fontWeight: 400, marginLeft: 8 }}>{priceNote}</span>
          </p>
        )}
        {facts.length > 0 && <p className="lst-facts">{facts.join(" · ")}</p>}

        {/* THE DESCRIPTION. */}
        {(house.headline || house.body) && (
          <div className="card" style={{ margin: "14px 0", padding: "16px 20px" }}>
            {house.headline && <h2 style={{ fontSize: 17, marginTop: 0, marginBottom: 8 }}>{house.headline}</h2>}
            {house.body && <p style={{ whiteSpace: "pre-line", margin: 0, fontSize: 15 }}>{house.body}</p>}
            {f?.note && <p className="muted" style={{ whiteSpace: "pre-line", margin: "10px 0 0", fontSize: 14 }}>{f.note}</p>}
          </div>
        )}

        {f && f.features.length > 0 && (
          <div className="card" style={{ marginBottom: 14, padding: "16px 20px" }}>
            <h2 className="section-title">What comes with it</h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {f.features.map((x) => <span key={x} className="extra-chip">{x}</span>)}
            </div>
          </div>
        )}

        {/* THE FORM. The page's one measure is an inquiry, so it sits above
            the plans rather than at the bottom of everything. */}
        {house.form.enabled && (
          <div className="card" style={{ marginBottom: 14, padding: "16px 20px" }}>
            <h2 className="section-title">{forRent ? "Ask about renting it" : "Ask about buying it"}</h2>
            <InquiryForm projectId={house.project_id} kinds={house.form.kinds} />
          </div>
        )}

        {plans.length > 0 && (
          <div className="card" style={{ marginBottom: 14, padding: "16px 20px" }}>
            <h2 className="section-title">Floor plans &amp; elevations</h2>
            <Gallery items={plans} />
          </div>
        )}

        {/* STILL BEING BUILT. The house is for sale AND a job is running on
            it: the follow-along page is the honest thing to point at. */}
        {house.build?.live && house.build.gallery_slug && (
          <div className="card" style={{ marginBottom: 14, padding: "16px 20px" }}>
            <h2 className="section-title">It is being built now</h2>
            <p className="small" style={{ margin: "0 0 8px" }}>
              {house.build.target_finish
                ? `Target completion ${monthYear(house.build.target_finish)}.`
                : "Work is under way."}{" "}
              The photographs go up as the build goes on.
            </p>
            <Link href={`/p/${house.build.gallery_slug}`} style={{ fontWeight: 700 }}>
              Follow the build, by date →
            </Link>
          </div>
        )}

        {(house.contact.name || house.contact.phone || house.contact.email) && (
          <p className="muted small" style={{ margin: 0 }}>
            {[house.contact.name, house.contact.phone, house.contact.email].filter(Boolean).join(" · ")}
          </p>
        )}
      </main>
    </div>
  );
}
