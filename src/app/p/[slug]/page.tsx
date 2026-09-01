import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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
};

// Public project page: everything comes from public_showcase(slug) - the
// anon-safe view (about page or the Master Template fallback, plus a
// space-type summary). These are the pages printed QR codes point at.
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
  const spaceEntries = Object.entries(spaces).sort((a, b) => b[1] - a[1]);

  return (
    <div className="page">
      <header className="topbar wrap">
        <Link href="/" className="brand" style={{ color: "inherit" }}>Green Bergen</Link>
        <Link href="/" className="iconlink" title="Home" aria-label="Home">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 10.5 12 3l9 7.5" />
            <path d="M5 9.5V21h14V9.5" />
          </svg>
        </Link>
      </header>

      <main className="wrap" style={{ flex: 1, width: "100%", maxWidth: 760, paddingBottom: 64 }}>
        {about.hero_photo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={about.hero_photo_url}
            alt={about.project}
            style={{ width: "100%", borderRadius: 12, marginBottom: 24 }}
          />
        )}

        <span className="kicker">{about.status}</span>
        <h1 style={{ fontSize: "clamp(24px, 4vw, 34px)", margin: "6px 0 4px" }}>
          {about.project}
        </h1>
        {about.address && <p className="muted" style={{ marginTop: 0 }}>{about.address}</p>}

        <div className="card" style={{ marginTop: 20 }}>
          <h2 style={{ fontSize: 18, marginTop: 0 }}>{about.headline}</h2>
          <p style={{ whiteSpace: "pre-line", marginBottom: 0 }}>{about.body}</p>
        </div>

        {spaceEntries.length > 0 && (
          <div className="card" style={{ marginTop: 16 }}>
            <h2 style={{ fontSize: 15, letterSpacing: 1, textTransform: "uppercase", color: "var(--muted)", marginTop: 0 }}>
              Inside this home
            </h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {spaceEntries.map(([type, n]) => (
                <span key={type} className="muted small" style={{ border: "1px solid var(--line)", borderRadius: 999, padding: "4px 12px", background: "#fff" }}>
                  {n} {type.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          </div>
        )}

        {(about.contact_name || about.contact_phone || about.contact_email) && (
          <div className="card" style={{ marginTop: 16 }}>
            <h2 style={{ fontSize: 15, letterSpacing: 1, textTransform: "uppercase", color: "var(--muted)", marginTop: 0 }}>
              Get in touch
            </h2>
            <p style={{ margin: 0 }}>
              {about.contact_name}
              {about.contact_phone && <> · <a href={`tel:${about.contact_phone}`}>{about.contact_phone}</a></>}
              {about.contact_email && <> · <a href={`mailto:${about.contact_email}`}>{about.contact_email}</a></>}
            </p>
          </div>
        )}
      </main>

      <footer className="footbar">
        <nav className="wrap footnav">
          <Link href="/vision">Vision</Link>
          <Link href="/help">Help</Link>
          <Link href="/join">Join</Link>
        </nav>
      </footer>
    </div>
  );
}
