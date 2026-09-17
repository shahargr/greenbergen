import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/SiteHeader";
import { BackButton } from "./BackButton";
import { InquiryForm } from "./InquiryForm";
import { Gallery } from "./Gallery";
import { Timeline, type TimelineItem } from "./Timeline";
import { Listing, type HousePage } from "./Listing";

type About = {
  project: string;
  address: string | null;
  status: string;
  headline: string;
  body: string;
  hero_photo_url: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  total_sqft: number | null;
  garage_note: string | null;
  scope_note: string | null;
  built_year: number | null;
  sold_year: number | null;
};

// Extras only appear when the home actually has them.
const EXTRAS = ["patio", "pool", "jacuzzi", "steam shower", "recreational", "media room", "gym"];

function computeScope(spaces: Record<string, number>) {
  let bedrooms = 0;
  let baths = 0;
  let garages = 0;
  const extras: string[] = [];
  for (const [rawType, n] of Object.entries(spaces)) {
    const type = rawType.replace(/_/g, " ").toLowerCase();
    if (type.includes("bedroom")) bedrooms += n;
    else if (type.includes("powder")) baths += 0.5 * n;
    else if (type.includes("bath")) baths += n;
    else if (type.includes("garage")) garages += n;
    for (const extra of EXTRAS) {
      if (type.includes(extra) && !extras.includes(extra)) extras.push(extra);
    }
  }
  return { bedrooms, baths, garages, extras };
}

function galleryLabel(name: string): string {
  const base = name.toLowerCase();
  if (base.startsWith("elevation")) return "Elevation";
  if (base.startsWith("floorplan") || base.startsWith("floor-plan")) return "Floor plan";
  return "";
}

// WHAT A PROGRESS PHOTOGRAPH SAYS ABOUT ITSELF. A file named
// 2026-06-14-foundation.jpg is dated June 14 and labelled Foundation; a file
// with no date in its name is dated by when it was uploaded, and a file
// named by a camera (IMG_4412, photo-mtj8...) gets no label rather than a
// made-up one.
function stamp(name: string, uploaded: string | null): { date: string; label: string } {
  const m = name.match(/^(\d{4}-\d{2}-\d{2})[-_ ]?(.*?)(\.[a-z0-9]+)?$/i);
  const rest = (m ? m[2] : name.replace(/\.[a-z0-9]+$/i, "")) ?? "";
  const words = rest.replace(/[-_]+/g, " ").trim();
  const generic = /^(img|dsc|photo|image|pxl|screenshot)\b/i.test(words) || /^[a-z0-9]{8,}$/i.test(words) || words === "";
  return {
    date: m ? m[1] : (uploaded ?? "").slice(0, 10),
    label: generic ? "" : words.charAt(0).toUpperCase() + words.slice(1),
  };
}

// Public project page, fed by public_showcase(slug): about text (per-project
// or the Master Template fallback), a computed scope of delivery, photos
// from public-media/gallery/<slug>/, and an inquiry form.
//
// A LIVE HOUSE reads as the one being built (action a8d869ca, 2026-09-17):
// the address as the headline, "Being built now. Follow along, or make it
// yours." under it, the inquiry form right there, and the photographs as a
// DATED TIMELINE rather than a gallery - sequenced, thin photography is
// proof of transparency. A delivered house keeps the record layout.
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();
  const [{ data }, { data: houseData }] = await Promise.all([
    supabase.rpc("public_showcase", { p_slug: slug }),
    supabase.rpc("house_page", { p_slug: slug }),
  ]);

  // A HOUSE ON THE MARKET IS A DIFFERENT PAGE (Shahar, 2026-09-17, choosing
  // "keep both, the mode decides"): for sale or for rent reads like a
  // listing - carousel, price, facts, the buyer's form - while a live build
  // keeps the follow-along record below, which is what proves we are
  // transparent about how it is going. house_page() resolves a job's slug to
  // the house above it, so /p/55-walnut-drive still lands here either way.
  const house: HousePage | null = (houseData ?? null) as HousePage | null;
  if (house?.on_market) {
    const base = supabase.storage.from("public-media").getPublicUrl("").data.publicUrl.replace(/\/$/, "");
    return <Listing house={house} base={base} />;
  }

  const about: About | null = data?.about ?? null;
  if (!about) notFound();
  const live = !about.status.startsWith("Closed");
  const targetFinish: string | null = data?.target_finish ?? null;

  const spaces: Record<string, number> = data?.spaces ?? {};
  const scope = computeScope(spaces);
  const garageText =
    about.garage_note ?? (scope.garages > 0 ? `${scope.garages} garage${scope.garages > 1 ? "s" : ""}` : null);

  const { data: galleryFiles } = await supabase.storage
    .from("public-media")
    .list(`gallery/${slug}`, { limit: 60 });
  const files = (galleryFiles ?? []).filter((f) => f.name && !f.name.startsWith("."));
  const gallery = files.map((f) => ({
    name: f.name,
    label: galleryLabel(f.name),
    url: supabase.storage.from("public-media").getPublicUrl(`gallery/${slug}/${f.name}`).data.publicUrl,
  }));
  // Plans (elevations, floor plans) stay a gallery; everything else on a live
  // house is the build, in date order.
  const plans = gallery.filter((g) => g.label);
  const timeline: TimelineItem[] = files
    .filter((f) => !galleryLabel(f.name))
    .map((f) => {
      const s = stamp(f.name, (f as { created_at?: string }).created_at ?? null);
      return { name: f.name, date: s.date, label: s.label,
        url: supabase.storage.from("public-media").getPublicUrl(`gallery/${slug}/${f.name}`).data.publicUrl };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const hasScope =
    scope.bedrooms > 0 || scope.baths > 0 || garageText || about.total_sqft ||
    about.scope_note || scope.extras.length > 0 || about.built_year || about.sold_year;

  // "55 Walnut Drive, Tenafly." - the street and the town, without the state.
  const parts = (about.address ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const title = parts.length >= 2 ? `${parts[0]}, ${parts[1]}` : (about.address ?? about.project);
  const finish = targetFinish
    ? new Date(`${targetFinish}T00:00:00`).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : null;

  const scopeCard = hasScope && (
    <div className="card" style={{ marginBottom: 14, padding: "16px 20px" }}>
      <h2 className="section-title">{live ? "The house" : "Scope of delivery"}</h2>
      <div className="scope-row">
        {scope.bedrooms > 0 && <span className="scope-fact"><strong>{scope.bedrooms}</strong> bedrooms</span>}
        {scope.baths > 0 && <span className="scope-fact"><strong>{scope.baths}</strong> bathrooms</span>}
        {garageText && <span className="scope-fact"><strong>{garageText}</strong></span>}
        {about.total_sqft && <span className="scope-fact"><strong>{about.total_sqft.toLocaleString()}</strong> sq ft</span>}
        {about.built_year && <span className="scope-fact">Built <strong>{about.built_year}</strong></span>}
        {about.sold_year && <span className="scope-fact">Sold <strong>{about.sold_year}</strong></span>}
        {live && finish && <span className="scope-fact">Target completion <strong>{finish}</strong></span>}
      </div>
      {about.scope_note && <p style={{ margin: "10px 0 0", fontSize: 15 }}>{about.scope_note}</p>}
      {scope.extras.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
          {scope.extras.map((e) => <span key={e} className="extra-chip">{e}</span>)}
        </div>
      )}
    </div>
  );

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
        {about.hero_photo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={about.hero_photo_url}
            alt={about.project}
            style={{ width: "100%", borderRadius: 12, marginBottom: 16 }}
          />
        )}

        {/* Internal project status is deliberately NOT shown publicly - it
            still decides whether the inquiry form appears. */}
        <h1 style={{ fontSize: "clamp(24px, 4vw, 32px)", margin: "8px 0 2px" }}>
          {live ? `${title}.` : (about.address ?? about.project)}
        </h1>
        {live
          ? <p style={{ margin: "0 0 6px", fontSize: 17 }}>Being built now. Follow along, or make it yours.</p>
          : about.address && !about.address.toLowerCase().includes(about.project.toLowerCase()) && <p className="muted" style={{ margin: "0 0 6px" }}>{about.project}</p>}
        {/* People on the project sign in straight into it. */}
        <p className="small" style={{ margin: "0 0 14px" }}>
          <Link href={`/login?next=${encodeURIComponent(`/my/project/${data.project_id}`)}`} style={{ fontWeight: 700 }}>Working on this project? Log in →</Link>
        </p>

        {live ? (
          <>
            {/* MAKE IT YOURS, first: the page's one measure is an inquiry. */}
            <div className="card" style={{ marginBottom: 14, padding: "16px 20px" }}>
              <h2 className="section-title">Make it yours, or come and see it</h2>
              <InquiryForm projectId={data.project_id} />
            </div>

            {scopeCard}

            {/* FOLLOW ALONG: the build, by date. */}
            <div className="card" style={{ marginBottom: 14, padding: "16px 20px" }}>
              <h2 className="section-title">The build, by date</h2>
              {timeline.length > 0
                ? <Timeline items={timeline} />
                : <p className="muted" style={{ margin: 0 }}>Progress photographs go up here as the build goes on{finish ? `, through ${finish}` : ""}.</p>}
            </div>

            {(about.headline || about.body) && (
              <div className="card" style={{ marginBottom: 14, padding: "16px 20px" }}>
                {about.headline && <h2 style={{ fontSize: 17, marginTop: 0, marginBottom: 8 }}>{about.headline}</h2>}
                {about.body && <p style={{ whiteSpace: "pre-line", margin: 0, fontSize: 15 }}>{about.body}</p>}
              </div>
            )}

            {plans.length > 0 && (
              <div className="card" style={{ padding: "16px 20px" }}>
                <h2 className="section-title">Plans</h2>
                <Gallery items={plans} />
              </div>
            )}
          </>
        ) : (
          <>
            {scopeCard}

            <div className="card" style={{ marginBottom: 14, padding: "16px 20px" }}>
              <h2 style={{ fontSize: 17, marginTop: 0, marginBottom: 8 }}>{about.headline}</h2>
              <p style={{ whiteSpace: "pre-line", margin: 0, fontSize: 15 }}>{about.body}</p>
            </div>

            {gallery.length > 0 && (
              <div className="card" style={{ padding: "16px 20px" }}>
                <h2 className="section-title">Plans &amp; photos</h2>
                <Gallery items={gallery} />
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
