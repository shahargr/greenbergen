import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

type PublicProject = {
  project_name: string;
  address: string | null;
  status?: string;
  public_slug: string | null;
  hero_photo_url?: string | null;
};

// Thumbnail: the project's hero photo when one is set, a house glyph until then.
function Thumb({ p }: { p: PublicProject }) {
  return (
    <span className="thumb">
      {p.hero_photo_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.hero_photo_url} alt="" />
      ) : (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 9.5V21h14V9.5" />
          <path d="M10 21v-6h4v6" />
        </svg>
      )}
    </span>
  );
}

// A project row links into its public page (/p/<slug>) when it has a slug.
function ProjectRow({ p }: { p: PublicProject }) {
  const inner = (
    <>
      <Thumb p={p} />
      <div>
        <strong>{p.project_name}</strong>
        {p.address && <div className="muted small">{p.address}</div>}
      </div>
    </>
  );
  return p.public_slug ? (
    <Link href={`/p/${p.public_slug}`} className="panel-item panel-link">
      {inner}
    </Link>
  ) : (
    <div className="panel-item">{inner}</div>
  );
}

// The landing reads public_company() - the anon-safe view of Green Bergen:
// open public projects and the completed track record.
export default async function Home() {
  const supabase = await createClient();
  const [{ data: { user } }, { data: company }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.rpc("public_company"),
  ]);

  const open: PublicProject[] = company?.projects ?? [];
  const closed: PublicProject[] = company?.completed ?? [];

  return (
    <div className="page">
      {/* Background: a quiet architectural skyline. Decorative only. */}
      <div className="bg-art" aria-hidden="true">
        <svg viewBox="0 0 1440 260" preserveAspectRatio="xMidYMax meet" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
          {/* ground line */}
          <path d="M0 258 H1440" strokeWidth="2.5" />
          {/* house 1 - small gable */}
          <path d="M30 258 V190 L95 140 L160 190 V258" />
          <path d="M78 258 V216 H112 V258" />
          <rect x="42" y="200" width="22" height="20" />
          {/* tree */}
          <circle cx="205" cy="222" r="22" />
          <path d="M205 244 V258" />
          {/* house 2 - two storey */}
          <path d="M250 258 V150 L330 100 L410 150 V258" />
          <rect x="270" y="170" width="26" height="24" />
          <rect x="364" y="170" width="26" height="24" />
          <path d="M316 258 V210 H344 V258" />
          <path d="M352 128 V96 H372 V113" />
          {/* house 3 - low ranch with porch */}
          <path d="M460 258 V196 L545 158 L630 196 V258" />
          <path d="M630 214 H700 V258" />
          <path d="M700 214 L662 190" />
          <rect x="490" y="210" width="24" height="22" />
          <rect x="576" y="210" width="24" height="22" />
          {/* tree */}
          <circle cx="745" cy="218" r="26" />
          <path d="M745 244 V258" />
          {/* house 4 - tall with chimney */}
          <path d="M800 258 V140 L880 88 L960 140 V258" />
          <path d="M918 112 V76 H940 V96" />
          <rect x="822" y="162" width="26" height="26" />
          <rect x="892" y="162" width="26" height="26" />
          <path d="M866 258 V204 H896 V258" />
          {/* house 5 - wide with side extension */}
          <path d="M1010 258 V184 L1090 134 L1170 184 V258" />
          <path d="M1170 206 H1265 V258" />
          <path d="M1265 206 L1220 176" />
          <rect x="1038" y="200" width="24" height="22" />
          <rect x="1198" y="222" width="22" height="18" />
          {/* house 6 - edge, partly off-canvas */}
          <path d="M1315 258 V196 L1390 150 L1440 180" />
          <rect x="1338" y="212" width="24" height="22" />
        </svg>
      </div>

      <header className="topbar wrap">
        <span className="brand">Green Bergen</span>
        {user ? (
          <Link href="/my" className="iconlink" title="Your home" aria-label="Your home">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 10.5 12 3l9 7.5" />
              <path d="M5 9.5V21h14V9.5" />
            </svg>
          </Link>
        ) : (
          <Link href="/login" className="iconlink" title="Sign in" aria-label="Sign in">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
            </svg>
          </Link>
        )}
      </header>

      <main className="wrap hero-wrap">
        <section className="hero">
          <h1>One home at a time</h1>
          <p className="muted tagline">
            Helping residents and property owners to maximize the value and
            comfort of their homes.
          </p>
        </section>

        <section className="panels">
          <div className="panel">
            <h2>Open projects</h2>
            {open.length === 0 && <p className="muted">Nothing public right now.</p>}
            {open.map((p) => (
              <ProjectRow key={p.project_name} p={p} />
            ))}
          </div>
          <div className="panel">
            <h2>Closed projects</h2>
            {closed.length === 0 && <p className="muted">Nothing public right now.</p>}
            {closed.map((p) => (
              <ProjectRow key={p.project_name} p={p} />
            ))}
          </div>
        </section>
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
