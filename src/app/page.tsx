import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SiteHeader } from "@/components/SiteHeader";
import { DOOR_URL } from "@/lib/doors";
import { signOut } from "@/app/my/actions";

type PublicProject = {
  project_name: string;
  address: string | null;
  status?: string;
  public_slug: string | null;
  hero_photo_url?: string | null;
};
type Tally = { houses_built: number; houses_in_flight: number; jobs_done: number; jobs_in_flight: number };

const HouseGlyph = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h14V9.5" />
    <path d="M10 21v-6h4v6" />
  </svg>
);

// One house in the book: photo, address, where it stands. The address is
// the public identity of a build; the project name only adds a line when it
// says something the address does not.
function HouseCard({ p, built }: { p: PublicProject; built: boolean }) {
  const title = p.address ?? p.project_name;
  const sub = p.address && !p.address.toLowerCase().includes(p.project_name.toLowerCase()) ? p.project_name : null;
  const inner = (
    <>
      <div className="photo">
        {p.hero_photo_url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={p.hero_photo_url} alt="" />
          : <HouseGlyph size={44} />}
      </div>
      <div className="cap">
        <div>
          <strong>{title}</strong>
          {sub && <span className="muted">{sub}</span>}
        </div>
        <span className={`state ${built ? "" : "live"}`}>{built ? "Built" : "In flight"}</span>
      </div>
    </>
  );
  return p.public_slug
    ? <Link href={`/p/${p.public_slug}`} className="book-card">{inner}</Link>
    : <div className="book-card">{inner}</div>;
}

// THE LANDING PAGE IS THE LANDING PAGE - for everyone.
//
// It used to send a signed-in visitor straight past itself to their doors,
// so Shahar opened greenbergen.vercel.app and got the door picker. That is
// not what a front door is for. Signed in or out, this is the welcome page:
// what Green Bergen is, the book of what it has built and is building, and
// one way in. The door logic still runs - behind "Sign in" (which skips the
// form when a session exists) and behind "Continue".
export default async function Home() {
  const supabase = await createClient();
  const [{ data: { user } }, { data: company }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.rpc("public_company"),
  ]);

  const inFlight: PublicProject[] = company?.projects ?? [];
  const built: PublicProject[] = company?.completed ?? [];
  const tally: Tally = company?.tally ?? { houses_built: built.length, houses_in_flight: inFlight.length, jobs_done: 0, jobs_in_flight: 0 };
  const first = user?.user_metadata?.full_name?.split(/\s+/)[0] ?? user?.email?.split("@")[0] ?? null;

  return (
    <div className="page">
      {/* Background: a quiet architectural skyline. Decorative only. */}
      <div className="bg-art" aria-hidden="true">
        <svg viewBox="0 0 1440 260" preserveAspectRatio="xMidYMax meet" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
          <path d="M0 258 H1440" strokeWidth="2.5" />
          <path d="M30 258 V190 L95 140 L160 190 V258" />
          <path d="M78 258 V216 H112 V258" />
          <rect x="42" y="200" width="22" height="20" />
          <circle cx="205" cy="222" r="22" />
          <path d="M205 244 V258" />
          <path d="M250 258 V150 L330 100 L410 150 V258" />
          <rect x="270" y="170" width="26" height="24" />
          <rect x="364" y="170" width="26" height="24" />
          <path d="M316 258 V210 H344 V258" />
          <path d="M352 128 V96 H372 V113" />
          <path d="M460 258 V196 L545 158 L630 196 V258" />
          <path d="M630 214 H700 V258" />
          <path d="M700 214 L662 190" />
          <rect x="490" y="210" width="24" height="22" />
          <rect x="576" y="210" width="24" height="22" />
          <circle cx="745" cy="218" r="26" />
          <path d="M745 244 V258" />
          <path d="M800 258 V140 L880 88 L960 140 V258" />
          <path d="M918 112 V76 H940 V96" />
          <rect x="822" y="162" width="26" height="26" />
          <rect x="892" y="162" width="26" height="26" />
          <path d="M866 258 V204 H896 V258" />
          <path d="M1010 258 V184 L1090 134 L1170 184 V258" />
          <path d="M1170 206 H1265 V258" />
          <path d="M1265 206 L1220 176" />
          <rect x="1038" y="200" width="24" height="22" />
          <rect x="1198" y="222" width="22" height="18" />
          <path d="M1315 258 V196 L1390 150 L1440 180" />
          <rect x="1338" y="212" width="24" height="22" />
        </svg>
      </div>

      <SiteHeader
        right={user ? (
          <Link href="/after-login" className="iconlink" title="Your doors" aria-label="Your doors"><HouseGlyph size={22} /></Link>
        ) : (
          <Link href="/login" className="iconlink" title="Sign in" aria-label="Sign in">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
            </svg>
          </Link>
        )}
      />

      <main className="wrap hero-wrap">
        <section className="hero">
          <h1>One home at a time</h1>
          <p className="muted tagline">
            Helping residents and property owners to maximize the value and
            comfort of their homes.
          </p>
          {/* The two acts a visitor came for, in the hero. Signed in, the
              first one is "continue" - it runs the same door logic the login
              form does: one seat lands in its app, more than one asks. */}
          <div className="btn-row" style={{ justifyContent: "center", marginTop: 22 }}>
            {user ? (
              <>
                <Link href="/after-login" className="btn">{first ? `Continue as ${first}` : "Continue"}</Link>
                <form action={signOut} style={{ display: "inline-flex" }}>
                  <button className="btn ghost">Not you? Sign out</button>
                </form>
              </>
            ) : (
              <>
                <Link href="/login" className="btn">Sign in</Link>
                <a href={`${DOOR_URL.homeowner}/join`} className="btn ghost">Sign up</a>
              </>
            )}
          </div>
        </section>

        {/* The tally. Four numbers, real ones, from the same anon-safe read as
            the book below. jobs_done is the one that grows with every package
            a neighbour books and a contractor finishes - it is zero today and
            the page says so rather than hiding the row. */}
        <section className="tally" aria-label="Green Bergen so far">
          <div className="tally-item"><span className={`n ${tally.houses_built ? "" : "zero"}`}>{tally.houses_built}</span><span className="l">Houses built</span></div>
          <div className="tally-item"><span className={`n ${tally.houses_in_flight ? "" : "zero"}`}>{tally.houses_in_flight}</span><span className="l">In flight</span></div>
          <div className="tally-item"><span className={`n ${tally.jobs_done ? "" : "zero"}`}>{tally.jobs_done}</span><span className="l">Jobs completed</span></div>
          <div className="tally-item"><span className={`n ${tally.jobs_in_flight ? "" : "zero"}`}>{tally.jobs_in_flight}</span><span className="l">Jobs under way</span></div>
        </section>

        {/* The book: in flight first, then built. Each card opens the
            house's public page (/p/<slug>). */}
        <section className="book">
          <h2>The book</h2>
          {inFlight.length + built.length === 0 ? (
            <p className="book-empty">Nothing public yet.</p>
          ) : (
            <div className="book-grid">
              {inFlight.map((p) => <HouseCard key={`f-${p.public_slug ?? p.project_name}`} p={p} built={false} />)}
              {built.map((p) => <HouseCard key={`b-${p.public_slug ?? p.project_name}`} p={p} built />)}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
