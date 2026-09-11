import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { isSignedIn } from "@shared/supabase/session";
import { rpc } from "@shared/rpc";
import { AppBar, Card, ChevronIcon, Screen } from "@shared/ui";
import { featured, loadPublicSettings, loadTiles } from "@shared/catalogue";
import { Illustration } from "@shared/Illustrations";
import { SITE_ORIGIN } from "@shared/site";
import { loadDoors } from "@shared/doors.server";
import { loadShowcase, type House } from "@/lib/showcase";
import { Scene, SceneMore } from "@/components/Scene";
import { VoiceAsk } from "@/components/VoiceAsk";

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
export default async function Landing({ searchParams }: { searchParams: Promise<{ ref?: string; name?: string; tab?: string }> }) {
  const { ref, name, tab: tabParam } = await searchParams;
  const supabase = await createClient();
  const [signedIn, settings, { tiles }, houses] = await Promise.all([isSignedIn(supabase), loadPublicSettings(), loadTiles(), loadShowcase()]);
  // A member does not need the shop window. One door: their projects.
  // Several doors (Shahar holds all three): the picker on the portal,
  // never a silent drop into this one app.
  if (signedIn && !ref) {
    const doors = await loadDoors();
    redirect(doors.held.length > 1 ? `${SITE_ORIGIN}/choose` : "/project");
  }

  let inviter: RefPreview | null = null;
  if (ref && /^[0-9a-f-]{36}$/i.test(ref)) {
    const { data } = await rpc<RefPreview>(supabase, "homeowner_ref_preview", { p_ref: ref });
    if (data?.ok) inviter = data;
  }
  const joinHref = `/join${ref ? `?ref=${encodeURIComponent(ref)}${name ? `&name=${encodeURIComponent(name)}` : ""}` : ""}`;

  const scenes = featured(tiles);
  const live = houses.filter((h) => !h.completed);
  const built = houses.filter((h) => h.completed);
  const tab: "services" | "projects" = tabParam === "projects" && houses.length > 0 ? "projects" : "services";

  // The way in, on both tabs: the one thing this page is for is a person
  // starting an order. A member signs in from the top right; this card is
  // for everyone else.
  const wayIn = (
    <Card soft pad>
      {inviter ? (
        <div className="stack" style={{ gap: 8 }}>
          <p className="small" style={{ margin: 0 }}>
            <strong>Join the community {inviter.first} is part of.</strong>{" "}
            <span className="text-muted">Three fields and an email code, then pick your first package.</span>
          </p>
          <Link href={joinHref} className="btn btn-primary btn-block">Join {inviter.first} in the community</Link>
          <Link href="/packages" className="btn btn-ghost btn-block">See the packages first</Link>
        </div>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          <Link href="/packages" className="btn btn-primary btn-block">Start your new project today</Link>
          {/* Or say it: the recorder opens first, the account comes after
              (Shahar, 2026-09-11). */}
          <VoiceAsk signedIn={false} />
        </div>
      )}
    </Card>
  );

  return (
    <Screen>
      <AppBar brand right={<Link href="/login" className="btn btn-ghost">Sign in</Link>} />
      <div className="body" style={{ gap: 18 }}>
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

        {/* THE FIRST THIRD IS A PHOTOGRAPH (Shahar, 2026-09-11): "1st 1/3 of
            page should be an image, and not text. image of couple in front of
            their house smiling as if they have completed a great project."

            A stranger decides in a second whether this is for them, and a
            paragraph is not what decides it. So the page opens on the picture
            - full bleed, a third of the screen - and the sentence that used
            to be the hero is one line under it. The photograph is data
            (config.landing_hero_url, uploaded in Admin > Landing photo);
            until there is one, the house is drawn on the warm ground so the
            page is whole either way. */}
        <div className={`front-hero ${settings.hero ? "" : "drawn"}`}>
          {settings.hero
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={settings.hero} alt="" fetchPriority="high" />
            : <Illustration name="house" />}
        </div>

        <div className="hero" style={{ marginTop: -4 }}>
          <h1 style={{ fontSize: 21 }}>
            {inviter && name ? <>Welcome, {name}. The safe way to meet contractors in our community.</> : <>The safe way to meet contractors in our community.</>}
          </h1>
          {/* The community line, editable in Admin (config.public_tagline). */}
          {settings.tagline && <p className="step-kicker" style={{ margin: "6px 0 0" }}>{settings.tagline}</p>}
        </div>

        {/* TWO TABS (Shahar, 2026-09-11): the services, and our projects.
            The first is the shop window and its one measure is a person
            starting an order, so it carries nothing else; the houses have
            a tab of their own and end on the same way in. */}
        {houses.length > 0 && (
          <nav className="seg" aria-label="Sections">
            <Link href="/" scroll={false} className={`seg-opt ${tab === "services" ? "on" : ""}`} aria-current={tab === "services" ? "page" : undefined}>Services</Link>
            <Link href="/?tab=projects" scroll={false} className={`seg-opt ${tab === "projects" ? "on" : ""}`} aria-current={tab === "projects" ? "page" : undefined}>Our projects</Link>
          </nav>
        )}

        {tab === "services" && (
          <>
            {/* WHAT WE DO. The promoted packages as scenes: the photograph
                of the work, the name, the community price. Each is the
                first step of buying that package. */}
            {scenes.length > 0 && (
              <section className="stack" style={{ gap: 10 }}>
                {/* FOUR ACROSS, AND THE FIFTH CUT AT THE EDGE. Shahar: "have
                    one line carousel of projects they can do, starting with an
                    EV charger, Standby generator, Water heater replacement,
                    and fixing Toilet... (try to fit 4 panels and show there
                    are more, if not, fit 3 and show there are more)."
                    .scenes.four sizes the card so four fit a phone with the
                    next one showing at the edge - three on the narrowest
                    ones, where four would be too small to read. The order is
                    the data: promoted packages by sort_order (072). */}
                <div className="row" style={{ alignItems: "center", gap: 10 }}>
                  <div className="divider-label" style={{ flex: 1 }}>What we do</div>
                  <Link href="/packages" className="small row" style={{ fontWeight: 700, whiteSpace: "nowrap", gap: 0, alignItems: "center" }}>
                    All {tiles.length} packages<ChevronIcon />
                  </Link>
                </div>
                <div className="scenes four" aria-label="Featured packages">
                  {scenes.map((t) => <Scene key={t.code} t={t} />)}
                  <SceneMore count={tiles.length} />
                </div>
              </section>
            )}

            {wayIn}

            <Card pad={false}>
              <div className="promises">
                <div><div className="t">Pre-priced</div><div className="d">Packages, not quotes</div></div>
                <div><div className="t">Vetted</div><div className="d">Licensed &amp; insured</div></div>
                <div><div className="t">Community</div><div className="d">Supporting our community</div></div>
              </div>
            </Card>
          </>
        )}

        {tab === "projects" && (
          <>
            {/* OUR PROJECTS. The houses, live first, each opening its
                public page on the portal (/p/<slug>, same host, outside
                this app's path - a plain anchor, not next/link). */}
            <section className="stack" style={{ gap: 10 }}>
              <div className="divider-label">Our projects</div>
              {live.map((h) => <HouseCard key={h.slug} h={h} wide />)}
              {built.length > 0 && (
                <div className="houses">
                  {built.map((h) => <HouseCard key={h.slug} h={h} />)}
                </div>
              )}
              <p className="small text-muted" style={{ margin: 0 }}>
                The same people, the same standard, one package at a time.
              </p>
            </section>

            {wayIn}
          </>
        )}
      </div>
    </Screen>
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
        <span className={`tag ${h.completed ? "tag-neutral" : "tag-status"}`}>{h.completed ? "Delivered" : "Live now"}</span>
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
