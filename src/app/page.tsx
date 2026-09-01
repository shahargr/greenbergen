import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

type PublicProject = {
  project_name: string;
  address: string | null;
  status?: string;
  public_slug: string | null;
};

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
              <div key={p.project_name} className="panel-item">
                <strong>{p.project_name}</strong>
                {p.address && <div className="muted small">{p.address}</div>}
              </div>
            ))}
          </div>
          <div className="panel">
            <h2>Closed projects</h2>
            {closed.length === 0 && <p className="muted">Nothing public right now.</p>}
            {closed.map((p) => (
              <div key={p.project_name} className="panel-item">
                <strong>{p.project_name}</strong>
                {p.address && <div className="muted small">{p.address}</div>}
              </div>
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
