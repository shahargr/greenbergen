import Link from "next/link";
import { redirect } from "next/navigation";
import { getMe, targetWindowLabel, type BookingSummary } from "@/lib/me";
import { featured, isOpen, loadPublicSettings, loadTiles } from "@shared/catalogue";
import { dollars, shortDate } from "@shared/format";
import { AppBar, Card, ChevronIcon, Notice, Screen, ShellIcons } from "@shared/ui";
import { unreadForShell } from "@shared/unread";
import { Illustration } from "@shared/Illustrations";
import { Scene, SceneMore } from "@/components/Scene";
import { HomeHero, HOME_LINE } from "@/components/HomeHero";
import { PhotoBanner } from "@/components/PhotoBanner";
import { VoiceAsk } from "@/components/VoiceAsk";
import { stopwatch } from "@shared/perf";

export const dynamic = "force-dynamic";
export const metadata = { title: "Green Bergen" };

// The home screen leads with the QUESTION, not the filing cabinet: the
// catalogue first, then the member's own projects - planned, live, done,
// cancelled - underneath, because a returning member scrolls to them while a
// new one never has to. Homes themselves live in the profile.
// CANCELLED IS NOT ON THIS SCREEN. Shahar (2026-09-12): "the cancelled
// section at the bottom of the page is a pointing finger to negative
// experience likely - should not be here." A home screen whose last word is a
// list of things that did not happen is an odd thing to greet somebody with,
// and the record is not lost: a cancelled booking is still on its own project
// page, and the ledger and the timeline still have all of it.
type Bucket = "all" | "planned" | "live" | "done";
const BUCKETS: { key: Bucket; label: string }[] = [
  { key: "all", label: "All" }, { key: "planned", label: "DIY" }, { key: "live", label: "In progress" }, { key: "done", label: "Completed" },
];
const bucketOf = (b: BookingSummary): Exclude<Bucket, "all"> | "cancelled" =>
  b.state === "planned" ? "planned" : b.state === "closed" ? "cancelled" : b.state === "done" ? "done" : "live";


export default async function ProjectIndex({ searchParams }: { searchParams: Promise<{ ok?: string; show?: string; home?: string }> }) {
  const { ok, show, home } = await searchParams;
  const w = stopwatch("/project");
  // The catalogue is template data behind a shared cache; it does not wait
  // on the member's own read and the member's read does not wait on it.
  // loadSections went with the category headings: no section renders here any
  // more, so the round trip that fetched their labels was pure cost.
  const [me, { tiles }, settings] = await Promise.all([
    w.step("me", () => getMe()),
    w.step("tiles", () => loadTiles()),
    // The same photograph the front door opens on (config.landing_hero_url,
    // migration 072), through the same cached read.
    w.step("settings", () => loadPublicSettings()),
  ]);
  w.done();
  if (!me.signed_in) redirect("/login?next=/project");
  // Everything waiting on you, not just the booking conversations: the old
  // count missed offers, questions and anything else addressed to you.
  // my_unread_count() is the same predicate the inbox list calls `pending`.
  const unread = await unreadForShell();
  const filter: Bucket = BUCKETS.some((x) => x.key === show) ? (show as Bucket) : "all";

  // THE SHOP WINDOW, THE WAY THE FRONT DOOR SHOWS IT.
  //
  // Shahar (2026-09-11): "make this look like homeowner landing." It used to
  // be three four-up grids of line drawings - the headline row, Renovation,
  // Not yet - which is a filing cabinet, and a member deciding what to do
  // next is doing exactly what a visitor on the landing is doing: looking at
  // the work. So this is now the landing's rail of scenes, the same six
  // promoted packages in the same clothes, ending in the way to all of them.
  //
  // Nothing is lost: /packages still carries every package, live and not
  // yet, plus the group purchases, and the tail of the rail is how you get
  // there. It is one tap where it used to be a scroll.
  const scenes = featured(tiles);
  const noneLive = !tiles.some(isOpen);

  const onlyHome = me.homes.find((h) => h.project_id === home) ?? null;
  const mine = onlyHome ? me.bookings.filter((b) => b.home_project_id === onlyHome.project_id) : me.bookings;
  const counts = { all: 0, planned: 0, live: 0, done: 0 } as Record<Bucket, number>;
  for (const b of mine) { const k = bucketOf(b); if (k !== "cancelled") { counts[k]++; counts.all++; } }
  const shown = mine.filter((b) => { const k = bucketOf(b); return k !== "cancelled" && (filter === "all" || k === filter); });
  const manyHomes = me.homes.length > 1;
  const order: Exclude<Bucket, "all">[] = ["live", "planned", "done"];
  const href = (b: Bucket) => {
    const q = new URLSearchParams();
    if (onlyHome) q.set("home", onlyHome.project_id);
    if (b !== "all") q.set("show", b);
    return q.size ? `/project?${q}` : "/project";
  };

  return (
    <Screen>
      <AppBar brand door="homeowner" right={<ShellIcons unread={unread} />} />
      <div className="body">
        {ok === "home" && <div className="banner-ok">Home added. Pick a package for it whenever you like.</div>}
        {ok === "removed" && <div className="banner-ok">Removed from your DIY projects. Nothing was ever sent.</div>}
        {me.missing && <Notice title="Preview mode">The database migration in db/ has not been applied yet, so homes and projects cannot be read. The catalogue still works.</Notice>}
        {me.degraded && <Notice kind="error" title="We couldn&apos;t load your homes just now.">Nothing is lost. <Link href="/project">Try again</Link>, and if it keeps happening tell us.</Notice>}
        <PhotoBanner bookings={me.bookings} />

        {/* A PICTURE, THEN THE SHELF (Shahar, 2026-09-12): "home screen
            design is still crowded and complex, and it is hard to understand
            what the system help me do. Let's start with an image (25% of the
            screen, slightly faded, with a text on top stating: We get things
            done around your house)."
            And the paragraph under the old headline went with it - "not sure
            why this text is necessary". It was three sentences explaining a
            shelf that explains itself. */}
        <HomeHero photo={settings.hero} line={HOME_LINE} />
        {scenes.length > 0 && (
          <section className="stack" style={{ gap: 10 }}>
            {/* "Chat what we do to community negotiated packages" and
                "remove the 20 packages, just leave more packages" - the count
                was our inventory, not their business, and the heading now
                says what the shelf IS. */}
            <div className="row" style={{ alignItems: "center", gap: 10 }}>
              <div className="divider-label" style={{ flex: 1 }}>Community negotiated packages</div>
              <Link href="/packages" className="small row" style={{ fontWeight: 700, whiteSpace: "nowrap", gap: 0, alignItems: "center" }}>
                More packages<ChevronIcon />
              </Link>
            </div>
            <div className="scenes four tall" aria-label="Packages">
              {scenes.map((t) => <Scene key={t.code} t={t} />)}
              <SceneMore />
            </div>
          </section>
        )}

        {noneLive && (
          // Not a bug, and it must not read like one. When nobody approved
          // carries any of these trades, every package on the screen is dim -
          // saying so once, plainly, beats leaving a member to guess.
          <Card soft pad>
            <div className="card-title">Nothing we can book on the spot today</div>
            <p className="small text-muted" style={{ margin: "4px 0 0" }}>
              These prices are real, but no approved contractor covers their trades yet. Open any
              of them: you can start it as a DIY project now, and ask us to tell you the day
              someone can take it on.
            </p>
          </Card>
        )}

        {/* THE WAY IN, the landing's own: pick a package, or just say it. */}
        <Card soft pad>
          <div className="stack" style={{ gap: 8 }}>
            <Link href="/packages" className="btn btn-primary btn-block">Start your new project today</Link>
            <VoiceAsk signedIn />
          </div>
        </Card>

        {/* THE CONTRACTOR DIRECTORY IS NOT HERE YET. Shahar
            (2026-09-11): "the contractors list should be removed for now,
            until we have enough." A directory of three people reads as a
            shortage, not a community, and it is the one screen on this app
            whose whole job is to be reassuring. /contractors still exists and
            still works - nothing links to it until the list can carry its own
            weight. */}

        {/* The jobs - live, DIY, done. The list of HOMES is not
            here any more: it lives in the profile (gear), where it can be
            edited, and "add another home" is offered where it is actually
            needed - when a package is booked and the wizard asks which home.
            The ?home= filter still works for links that carry it. */}
        {counts.all > 0 ? (
          <>
            <div className="divider-label" style={{ marginTop: 6 }}>
              {onlyHome ? (onlyHome.address?.split(",")[0] ?? "This home") : "Your projects"}
            </div>
            {onlyHome && (
              <Link href="/project" className="btn btn-ghost" style={{ alignSelf: "flex-start", padding: 0 }}>← All homes</Link>
            )}

            {mine.length > 0 && (
              <nav className="chips" aria-label="Filter projects">
                {BUCKETS.filter((x) => x.key === "all" || counts[x.key] > 0).map((x) => (
                  <Link key={x.key} href={href(x.key)} className={`tag ${filter === x.key ? "" : "tag-neutral"}`} aria-current={filter === x.key ? "page" : undefined} style={{ textDecoration: "none", padding: "7px 12px", fontSize: 12 }}>
                    {x.label} · {counts[x.key]}
                  </Link>
                ))}
              </nav>
            )}

            {(filter === "all" ? order : [filter as Exclude<Bucket, "all">]).map((k) => {
              const rows = shown.filter((b) => bucketOf(b) === k);
              if (rows.length === 0) return null;
              return (
                <section className="stack" style={{ gap: 10 }} key={k}>
                  {filter === "all" && <div className="divider-label">{BUCKETS.find((x) => x.key === k)?.label}</div>}
                  {rows.map((b) => <BookingRow key={b.project_id} b={b} showHome={manyHomes && !onlyHome} />)}
                </section>
              );
            })}
          </>
        ) : (
          <Card soft pad>
            <div className="small">Nothing on your list yet — tap a package above to start one. Your home is added the first time a project needs it.</div>
          </Card>
        )}
      </div>
    </Screen>
  );
}


function BookingRow({ b, showHome }: { b: BookingSummary; showHome: boolean }) {
  const pill =
    b.state === "planned" ? <span className="tag tag-neutral">{targetWindowLabel(b.target_window)}</span>
    : b.state === "posted" && b.no_taker ? <span className="tag tag-status">Needs you</span>
    : b.state === "posted" ? <span className="tag tag-outline">Matching</span>
    : b.state === "accepted" ? <span className="tag tag-status">{b.progress ? `${b.progress.done_count}/${b.progress.total}` : "In progress"}</span>
    : b.state === "done" ? <span className="tag tag-ok">Done</span>
    : <span className="tag tag-neutral">Cancelled</span>;
  const line =
    b.state === "planned" ? `${dollars(b.price_cents)} reference · ${b.config_label ?? ""}`
    : b.state === "accepted" ? `${b.contractor?.name ?? "Contractor"} · ${b.progress?.current?.name ?? "in progress"}`
    : b.state === "posted" ? `${dollars(b.price_cents)} · posted ${shortDate(b.posted_at)}`
    : b.state === "done" ? `${dollars(b.price_cents)} · ${shortDate(b.done_at)}`
    : `cancelled ${shortDate(b.closed_at)}`;
  return (
    <Link href={`/project/${b.project_id}`} className="home-row">
      <span className="ic"><Illustration name={b.illustration} /></span>
      <span className="grow">
        <span className="t">{b.name}{b.unread > 0 && <span className="tag tag-status" style={{ marginLeft: 6, padding: "1px 7px" }}>{b.unread}</span>}</span>
        <span className="m" style={{ display: "block" }}>{showHome && b.address ? `${b.address.split(",")[0]} · ` : ""}{line}</span>
      </span>
      {pill}
    </Link>
  );
}
