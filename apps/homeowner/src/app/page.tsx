import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { isSignedIn } from "@shared/supabase/session";
import { rpc } from "@shared/rpc";
import { AppBar, Card, ChevronIcon, Screen } from "@shared/ui";
import { featured, loadPublicSettings, loadTiles } from "@shared/catalogue";
import { Illustration } from "@shared/Illustrations";
import { SITE_ORIGIN } from "@shared/site";
import { loadCompany, type House } from "@/lib/showcase";
import { HomeHero } from "@/components/HomeHero";
import { Scene, SceneMore } from "@/components/Scene";
import { BuildWithUs } from "./BuildWithUs";

export const dynamic = "force-dynamic";

type RefPreview = { ok: boolean; first?: string; name?: string; line?: string };

// SCREEN 1 - THE FRONT DOOR, repositioned (action a8d869ca; spec agreed
// with Shahar 2026-09-16, built 2026-09-17).
//
// Green Bergen is a technology company that uses AI to build single-family
// homes in Bergen County on its own platform. The frame is technology, not
// experience: a competitor can beat any project count, and a buyer's real
// fear - finding out too late - is exactly what the platform answers. So the
// page leads with what the buyer gets (every decision, cost and deadline
// while there is still time to change it), then the home being built, then
// the way in for a new build, and only then the community offer, which is
// what we developed for ourselves offered separately.
//
// One KPI: inquiries - for a new build and for the home available. Realtors
// are handled offline; nothing here is agent-facing. There is one property,
// so the page reads as a builder that happens to have one home, never as an
// inventory browser.
export default async function Landing({ searchParams }: { searchParams: Promise<{ ref?: string; name?: string }> }) {
  const { ref, name } = await searchParams;
  const supabase = await createClient();
  const [signedIn, settings, { tiles }, company] = await Promise.all([isSignedIn(supabase), loadPublicSettings(), loadTiles(), loadCompany()]);
  // A member does not need the shop window: signed in, this front page is
  // their own home screen instead. Deciding which door a person belongs in
  // happens ONCE, at sign-in, in landing() on the portal.
  if (signedIn && !ref) redirect("/project");

  let inviter: RefPreview | null = null;
  if (ref && /^[0-9a-f-]{36}$/i.test(ref)) {
    const { data } = await rpc<RefPreview>(supabase, "homeowner_ref_preview", { p_ref: ref });
    if (data?.ok) inviter = data;
  }
  const joinHref = `/join${ref ? `?ref=${encodeURIComponent(ref)}${name ? `&name=${encodeURIComponent(name)}` : ""}` : ""}`;

  const scenes = featured(tiles);
  const live = company.houses.filter((h) => !h.completed);
  const built = company.houses.filter((h) => h.completed);
  const now = live[0] ?? null;
  const nowHref = now?.slug ? `${SITE_ORIGIN}/p/${encodeURIComponent(now.slug)}` : null;
  // THE HERO IS THE HOUSE BEING BUILT. Mid-construction is on-message: the
  // point is that you can see it. Admin's landing photo stands in when no
  // house is live.
  const hero = now?.photo ?? settings.hero;

  return (
    <Screen>
      <AppBar brand right={<Link href="/login" className="btn btn-ghost">Sign in</Link>} />
      <div className="body" style={{ gap: 18 }}>
        {inviter && (
          <Card pad>
            <div className="row">
              <span className="avatar">{(inviter.name ?? "").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}</span>
              <div>
                <div><strong>{inviter.name}</strong> invited you.</div>
                <div className="small text-muted">{inviter.line}</div>
              </div>
            </div>
            <Link href={joinHref} className="btn btn-primary btn-block" style={{ marginTop: 10 }}>Join {inviter.first} in the community</Link>
          </Card>
        )}

        {/* THE HERO: the photograph bare, the words under it where they can
            be read at any exposure and wrap on a phone. */}
        <HomeHero photo={hero} />
        <section className="pitch">
          <h1>The first home builder that runs like a software company.</h1>
          <p>
            We build single-family homes in Bergen County on our own platform — so you see every decision,
            every cost, and every deadline while there is still time to change them.
          </p>
          <div className="pitch-cta">
            {nowHref
              ? <a href={nowHref} className="btn btn-primary">See the home we are building</a>
              : <a href="#build" className="btn btn-primary">Build with us</a>}
            {nowHref && <a href="#build" className="btn btn-secondary">Build with us</a>}
          </div>
        </section>

        {/* THREE THINGS THE BUYER GETS. The strip under the hero, one point
            each, in the spec's words. */}
        <section className="pillars">
          <div>
            <strong>Decisions, before they are expensive.</strong>
            <span>Every choice that affects your budget reaches you when it is still a choice — not in a change order after the wall is closed.</span>
          </div>
          <div>
            <strong>One job folder, not forty text messages.</strong>
            <span>Permits, inspections, photos, payments, and every conversation live in one place you can open at midnight.</span>
          </div>
          <div>
            <strong>We use it ourselves, every day.</strong>
            <span>Our own crews work inside this platform. It got better on every house we have built, and it is getting better on yours.</span>
          </div>
        </section>

        {/* THE HOME BEING BUILT. One, said as one - not a browser. */}
        {now && (
          <section className="stack" style={{ gap: 10 }}>
            <div className="divider-label">Being built now</div>
            <HouseNow h={now} href={nowHref} />
            {built.length > 0 && (
              <p className="small text-muted" style={{ margin: 0 }}>
                Before it: {built.map((h, i) => (
                  <span key={h.slug ?? h.title}>
                    {i > 0 ? ", " : ""}
                    {h.slug
                      ? <a href={`${SITE_ORIGIN}/p/${encodeURIComponent(h.slug)}`}>{h.title}{h.town ? `, ${h.town}` : ""}</a>
                      : <>{h.title}{h.town ? `, ${h.town}` : ""}</>}
                  </span>
                ))}.
              </p>
            )}
          </section>
        )}

        {/* BUILD WITH US: the new-build way in. The lot if there is one,
            one way to reach you, and a person calls. */}
        <section className="stack" style={{ gap: 10 }} id="build-with-us">
          <div className="divider-label">Build with us</div>
          <Card pad>
            <p className="small" style={{ margin: "0 0 10px" }}>
              A new house on your lot, or on one we find together. You will see the plan, the price and every
              decision on the same platform we run our own builds on.
            </p>
            <BuildWithUs projectId={company.inquiryProjectId} phone={company.phone} />
          </Card>
        </section>

        {/* FOR THE NEIGHBOURHOOD. What we built for our own houses, offered
            separately and at cost: the three jobs Shahar named. Below the
            builder story on purpose - it is the community offer, not the
            company. */}
        {scenes.length > 0 && (
          <section className="stack" style={{ gap: 10 }}>
            <div className="row" style={{ alignItems: "center", gap: 10 }}>
              <div className="divider-label" style={{ flex: 1 }}>For the neighbourhood · at cost</div>
              <Link href="/packages" className="small row" style={{ fontWeight: 700, whiteSpace: "nowrap", gap: 0, alignItems: "center" }}>
                All of them<ChevronIcon />
              </Link>
            </div>
            <p className="small text-muted" style={{ margin: "-4px 0 0" }}>
              Our plumber and our electrician, at what they charge us, for three jobs a house needs. No margin on top.
            </p>
            <div className="scenes four tall" aria-label="Community jobs">
              {scenes.map((t) => <Scene key={t.code} t={t} />)}
              <SceneMore />
            </div>
          </section>
        )}

        {/* MEET BOB (2026-09-19). The community offer is four tiles you have
            to already know the name of; Bob is the same four jobs reached the
            way people actually arrive at them - "the power keeps going out".
            He sits under the tiles rather than over them, because the front
            door's one job is still the build. */}
        <section className="stack" style={{ gap: 10 }}>
          <div className="divider-label">Meet Bob</div>
          <Card pad>
            <p style={{ margin: 0, fontSize: 16, lineHeight: 1.45 }}>
              Bob is your replica for anything house related — from a DIY weekend project to planning a move.
              He gets better the more he knows about your house.
            </p>
            <p className="small text-muted" style={{ margin: "8px 0 0" }}>
              Today he is good at four things: emergency generators, water heater replacement, EV chargers and home
              internet. Tell him what is going on and he will tell you what it is, what it takes, and whether it is
              his — straight.
            </p>
            <Link href="/ask" className="btn btn-primary btn-block" style={{ marginTop: 12 }}>Ask Bob</Link>
          </Card>
        </section>

        <Card pad={false}>
          <div className="promises">
            <div><div className="t">Built by us</div><div className="d">On our own platform</div></div>
            <div><div className="t">In the open</div><div className="d">Every decision, in time</div></div>
            <div><div className="t">Licensed &amp; insured</div><div className="d">Bergen County, NJ</div></div>
          </div>
        </Card>

        {company.phone && (
          <p className="small text-muted center" style={{ margin: 0 }}>
            {company.name ?? "Green Bergen Development"} · <a href={`tel:${company.phone.replace(/[^\d+]/g, "")}`}>{company.phone}</a>
          </p>
        )}
      </div>
    </Screen>
  );
}

// THE HOME BEING BUILT, as a card: the photograph, the address, and the two
// things you can do about it.
function HouseNow({ h, href }: { h: House; href: string | null }) {
  const inner = (
    <>
      <span className="house-pic">
        {h.photo
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={h.photo} alt="" loading="lazy" decoding="async" />
          : <Illustration name="house" className="text-muted" />}
        <span className="tag tag-status">Live now</span>
      </span>
      <span className="house-cap">
        <strong>{h.title}{h.town ? `, ${h.town}` : ""}.</strong>
        <span className="small text-muted">Being built now. Follow along, or make it yours.</span>
      </span>
    </>
  );
  return href
    ? <a href={href} className="house wide">{inner}</a>
    : <span className="house wide">{inner}</span>;
}
