import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/SiteHeader";
import { BackButton } from "./BackButton";
import { InquiryForm } from "./InquiryForm";
import { Gallery } from "./Gallery";

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

// Public project page, fed by public_showcase(slug): about text (per-project
// or the Master Template fallback), a computed scope of delivery, an optional
// photo gallery from public-media/gallery/<slug>/, and an inquiry form.
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("public_showcase", { p_slug: slug });

  const about: About | null = data?.about ?? null;
  if (!about) notFound();

  const spaces: Record<string, number> = data?.spaces ?? {};
  const scope = computeScope(spaces);
  const garageText =
    about.garage_note ?? (scope.garages > 0 ? `${scope.garages} garage${scope.garages > 1 ? "s" : ""}` : null);

  const { data: galleryFiles } = await supabase.storage
    .from("public-media")
    .list(`gallery/${slug}`, { limit: 24 });
  const gallery = (galleryFiles ?? [])
    .filter((f) => f.name && !f.name.startsWith("."))
    .map((f) => ({
      name: f.name,
      label: galleryLabel(f.name),
      url: supabase.storage.from("public-media").getPublicUrl(`gallery/${slug}/${f.name}`).data.publicUrl,
    }));

  const hasScope =
    scope.bedrooms > 0 || scope.baths > 0 || garageText || about.total_sqft ||
    about.scope_note || scope.extras.length > 0 || about.built_year || about.sold_year;

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
            still gates the inquiry form below. */}
        <h1 style={{ fontSize: "clamp(24px, 4vw, 32px)", margin: "8px 0 2px" }}>
          {about.project}
        </h1>
        {about.address && <p className="muted" style={{ margin: "0 0 6px" }}>{about.address}</p>}
        {/* People on the project sign in straight into it. */}
        <p className="small" style={{ margin: "0 0 14px" }}>
          <Link href={`/login?next=${encodeURIComponent(`/my/project/${data.project_id}`)}`} style={{ fontWeight: 700 }}>Working on this project? Log in →</Link>
        </p>

        {hasScope && (
          <div className="card" style={{ marginBottom: 14, padding: "16px 20px" }}>
            <h2 className="section-title">Scope of delivery</h2>
            <div className="scope-row">
              {scope.bedrooms > 0 && (
                <span className="scope-fact"><strong>{scope.bedrooms}</strong> bedrooms</span>
              )}
              {scope.baths > 0 && (
                <span className="scope-fact"><strong>{scope.baths}</strong> bathrooms</span>
              )}
              {garageText && <span className="scope-fact"><strong>{garageText}</strong></span>}
              {about.total_sqft && (
                <span className="scope-fact"><strong>{about.total_sqft.toLocaleString()}</strong> sq ft built</span>
              )}
              {about.built_year && (
                <span className="scope-fact">Built <strong>{about.built_year}</strong></span>
              )}
              {about.sold_year && (
                <span className="scope-fact">Sold <strong>{about.sold_year}</strong></span>
              )}
            </div>
            {about.scope_note && (
              <p style={{ margin: "10px 0 0", fontSize: 15 }}>{about.scope_note}</p>
            )}
            {scope.extras.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                {scope.extras.map((e) => (
                  <span key={e} className="extra-chip">{e}</span>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="card" style={{ marginBottom: 14, padding: "16px 20px" }}>
          <h2 style={{ fontSize: 17, marginTop: 0, marginBottom: 8 }}>{about.headline}</h2>
          <p style={{ whiteSpace: "pre-line", margin: 0, fontSize: 15 }}>{about.body}</p>
        </div>

        {/* A closed project takes no inquiries - the form is for live work.
            It keeps this position; photos always come after it. */}
        {!about.status.startsWith("Closed") && (
          <div className="card" style={{ marginBottom: 14, padding: "16px 20px" }}>
            <h2 className="section-title">Get in touch</h2>
            <InquiryForm projectId={data.project_id} />
          </div>
        )}

        {gallery.length > 0 && (
          <div className="card" style={{ padding: "16px 20px" }}>
            <h2 className="section-title">Plans &amp; photos</h2>
            <Gallery items={gallery} />
          </div>
        )}
      </main>
    </div>
  );
}
