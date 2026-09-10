import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { isSignedIn } from "@shared/supabase/session";
import { rpc } from "@shared/rpc";
import { AppBar, Card, ChevronIcon, Screen } from "@shared/ui";
import { featured, isQuote, loadTagline, loadTiles, type Tile } from "@shared/catalogue";
import { Illustration } from "@shared/Illustrations";
import { dollars } from "@shared/format";
import { SITE_ORIGIN } from "@shared/site";
import { loadShowcase, type House } from "@/lib/showcase";

export const dynamic = "force-dynamic";

type RefPreview = { ok: boolean; first?: string; name?: string; line?: string };

// SCREEN 1 - THE FRONT DOOR (redone 2026-09-10, Shahar).
//
// Three things, in this order: what we do, shown as the work itself (a
// professional in a house, the water heater, the standby generator - what
// Admin chose to promote); the houses we are building and have built (55
// Walnut in Tenafly live; Ryerson and Concord done), each a link to its
// public page; and one way in - a package. A visitor starts buying from
// here and is asked to register only at checkout, inside the booking, so
// the door has no "join first" step any more. The invite (?ref=) still
// pre-fills the inviter's name and still leads to /join, because an
// invitation is a different act from a purchase.
//
// The photographs are data: blueprint_packages.photo_url (Admin > Packages)
// for the work, project_about_pages.hero_photo_url for the houses. A package
// without a photo yet draws its line art on the warm ground, so the page
// reads the same before and after the photos are taken.
export default async function Landing({ searchParams }: { searchParams: Promise<{ ref?: string; name?: string }> }) {
  const { ref, name } = await searchParams;
  const supabase = await createClient();
  const [signedIn, tagline, { tiles }, houses] = await Promise.all([isSignedIn(supabase), loadTagline(), loadTiles(), loadShowcase()]);
  if (signedIn && !ref) redirect("/project");

  let inviter: RefPreview | null = null;
  if (ref && /^[0-9a-f-]{36}$/i.test(ref)) {
    const { data } = await rpc<RefPreview>(supabase, "homeowner_ref_preview", { p_ref: ref });
    if (data?.ok) inviter = data;
  }
  const joinHref = `/join${ref ? `?ref=${encodeURIComponent(ref)}${name ? `&name=${encodeURIComponent(name)}` : ""}` : ""}`;

  const scenes = featured(tiles);
  const live = houses.filter((h) => !h.completed);
  const built = houses.filter((h) => h.completed);

  return (
    <Screen>
      <AppBar brand right={<Link href="/login" className="btn btn-ghost">Sign in</Link>} />
      <div className="body">
        {inviter ? (
          <Card pad>
            <div className="row">
              <span className="avatar">{(inviter.name ?? "").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}</span>
              <div>
                <div><strong>{inviter.name}</strong> invited you.</div>
                <div className="small text-muted">{inviter.line}</div>
              </div>
            </div>
          </Card>
        ) : null}

        <div className="hero">
          <h1 style={{ fontSize: 26 }}>
            {inviter && name ? <>Welcome, {name}. The safe way to meet contractors in our community.</> : <>The safe way to meet contractors in our community.</>}
          </h1>
          {/* The community line, editable in Admin (config.public_tagline). */}
          {tagline && <p className="step-kicker" style={{ margin: "6px 0 0" }}>{tagline}</p>}
        </div>

        {/* WHAT WE DO. The promoted packages as scenes: the photograph of
            the work, the name, the community price. Each is the first step
            of buying that package. */}
        {scenes.length > 0 && (
          <section className="stack" style={{ gap: 8 }}>
            <div className="divider-label">What we do</div>
            <div className="scenes" aria-label="Featured packages">
              {scenes.map((t) => <Scene key={t.code} t={t} />)}
              <Link href="/packages" className="scene more">
                <span className="scene-more">
                  <strong>All packages</strong>
                  <span className="small text-muted">Every one pre-priced for the community.</span>
                  <span className="chev"><ChevronIcon /></span>
                </span>
              </Link>
            </div>
          </section>
        )}

        <Card pad={false}>
          <div className="promises">
            <div><div className="t">Pre-priced</div><div className="d">Packages, not quotes</div></div>
            <div><div className="t">Vetted</div><div className="d">Licensed &amp; insured</div></div>
            <div><div className="t">Direct</div><div className="d">You pay the contractor</div></div>
          </div>
        </Card>

        {/* OUR PROJECTS. The houses, live first, each opening its public
            page on the portal (/p/<slug>, same host, outside this app's
            path - a plain anchor, not next/link). */}
        {houses.length > 0 && (
          <section className="stack" style={{ gap: 8 }}>
            <div className="divider-label">Our projects</div>
            {live.map((h) => <HouseCard key={h.slug} h={h} wide />)}
            {built.length > 0 && (
              <div className="houses">
                {built.map((h) => <HouseCard key={h.slug} h={h} />)}
              </div>
            )}
          </section>
        )}
      </div>
      <div className="actions">
        {inviter ? (
          <>
            <Link href={joinHref} className="btn btn-primary btn-block">Join {inviter.first} in the community</Link>
            <Link href="/packages" className="btn btn-ghost btn-block">See the packages first</Link>
          </>
        ) : (
          <>
            <Link href="/packages" className="btn btn-primary btn-block">Start with a package</Link>
            <p className="tiny text-muted center" style={{ margin: 0 }}>Pick a package, add your address. You create your account at the last step.</p>
          </>
        )}
        <p className="small text-muted center" style={{ margin: "4px 0 0" }}>Already a member? <Link href="/login">Sign in</Link></p>
      </div>
    </Screen>
  );
}

// One scene: the work, photographed when Admin has the photo, drawn when
// not; the name; and what it costs the community.
function Scene({ t }: { t: Tile }) {
  const price = t.base_price_cents != null ? `from ${dollars(t.base_price_cents)}` : isQuote(t) ? "A person prices it" : "Coming soon";
  return (
    <Link href={`/packages/${t.code}`} className="scene">
      <span className={`scene-pic ${t.photo_url ? "" : "drawn"}`}>
        {t.photo_url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={t.photo_url} alt={t.tile_title} loading="lazy" decoding="async" />
          : <Illustration name={t.illustration} />}
      </span>
      <span className="scene-cap">
        <strong>{t.tile_title}{t.tile_line2 ? <small> {t.tile_line2}</small> : null}</strong>
        <span className="small">{price}</span>
      </span>
    </Link>
  );
}

function HouseCard({ h, wide = false }: { h: House; wide?: boolean }) {
  const inner = (
    <>
      <span className="house-pic">
        {h.photo
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={h.photo} alt="" loading="lazy" decoding="async" />
          : <Illustration name="house" className="text-muted" />}
        <span className={`tag ${h.completed ? "tag-neutral" : "tag-status"}`}>{h.completed ? "Completed" : "Live now"}</span>
      </span>
      <span className="house-cap">
        <strong>{h.title}</strong>
        {h.town && <span className="small text-muted">{h.town}</span>}
      </span>
    </>
  );
  const cls = `house ${wide ? "wide" : ""}`;
  return h.slug
    ? <a href={`${SITE_ORIGIN}/p/${encodeURIComponent(h.slug)}`} className={cls}>{inner}</a>
    : <span className={cls}>{inner}</span>;
}
