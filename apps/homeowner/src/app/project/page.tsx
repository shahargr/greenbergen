import Link from "next/link";
import { redirect } from "next/navigation";
import { getMe, targetWindowLabel, type BookingSummary, type ProjectSummary } from "@/lib/me";
import { featured, isOpen, loadPublicSettings, loadTiles } from "@shared/catalogue";
import { dollars, shortDate } from "@shared/format";
import { AppBar, Card, ChevronIcon, Notice, Screen, ShellIcons } from "@shared/ui";
import { DoorSwitchIcon } from "@shared/DoorSwitchIcon";
import { unreadForShell } from "@shared/unread";
import { Illustration } from "@shared/Illustrations";
import { Scene, SceneMore } from "@/components/Scene";
import { HomeHero } from "@/components/HomeHero";
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
type Bucket = "all" | "offers" | "going" | "done";
// TWO GROUPS AND A DRAWER. Shahar (2026-09-15): "Change under way to on-going
// (DIY or Awarded) / Change lining up to pending offers / Remove done,
// keeping all."
//
// The old pair split on how far along a job was - before a contractor was on
// it, and after - which put "Improvements" at 52 Ryerson, three things on a
// list that nobody has been asked to do, under "Lining up", as though an
// offer were coming. Nothing is out on it. Nobody has been asked. It is his
// own work to do, and lining up is not what it is doing.
//
// The split is now WHO YOU ARE WAITING FOR, which is the only question with
// two different answers:
//
//   Pending offers          somebody has been ASKED and has not answered.
//   On-going (DIY or        nobody is being waited on: either a contractor
//   Awarded)                has it, or you do.
//
// Done is no longer a tab. Finished work is not something you go looking for
// on the home screen - but it is not hidden either: it keeps its section
// under All, which is the tab that means "everything, nothing left out".
const TABS: { key: Bucket; label: string }[] = [
  { key: "going", label: "On-going (DIY or Awarded)" },
  { key: "offers", label: "Pending offers" },
  { key: "all", label: "All" },
];
// The sections under All, in this order. Done has a heading without having a
// tab, which is the whole point of keeping it here.
const ORDER: Exclude<Bucket, "all">[] = ["going", "offers", "done"];
const SECTION: Record<Exclude<Bucket, "all">, string> = {
  going: "On-going (DIY or Awarded)",
  offers: "Pending offers",
  done: "Done",
};
// The bare /project URL means this one, so it is the tab that carries no
// query string - and an empty screen is never the default, so if nothing is
// on-going the first tab with anything on it opens instead.
const DEFAULT_BUCKET: Bucket = "going";

// ONE ROW PER JOB, booked or not (migration 116). Shahar, with two
// screenshots: "as professional i see both Ran and My own generator project.
// as home owner, i see none." He was right and it was worse than it looked -
// under his two homes there are ten jobs and this screen was showing zero,
// for two reasons at once. It listed BOOKINGS, and six of the ten never came
// through the booking wizard. And it read a booking's state as the job's, so
// the other four - all with closed bookings, two of them live with open tasks
// and a contractor - were filed as "cancelled" and hidden.
type Row =
  | { kind: "booking"; project_id: string; b: BookingSummary; p: ProjectSummary }
  | { kind: "project"; project_id: string; p: ProjectSummary };

// WHERE IT STANDS, decided once in the database and only read here. Shahar
// (2026-09-14): "tells me the generator is in progress while in fact it
// isn't." It was: this screen bucketed by projects.status, which is the value
// a project is BORN with. project_progress reads the stage AND checks it
// against the record - people, contracts, money, bids, finished work - and
// says the smaller true thing when the claim is not supported.
// It keys off project_progress's KEY rather than its order, because the
// question is no longer "how far along" - it is "is anybody being waited on",
// and the three keys that mean yes do not sit together on the ladder.
const bucketOf = (r: Row): Exclude<Bucket, "all"> | "cancelled" => {
  const k = r.p.progress_label?.key;
  if (k === "cancelled") return "cancelled";
  if (k === "done") return "done";
  // bid     - the scope is out, no prices back yet
  // finding - posted to the community, nobody has taken it
  // compare - prices are in and none of them is accepted
  // Everything else is either running or sitting on your own list, and both
  // of those are on-going: a job with a contractor on it, and a job you have
  // not asked anybody about, are the same in the one way that matters here -
  // nobody owes you an answer.
  return k === "bid" || k === "finding" || k === "compare" ? "offers" : "going";
};

// Semantic colour, not decoration: finished is good, somebody working is
// live, waiting on you is a flag, and everything else is quiet.
const tagFor = (key?: string) =>
  key === "done" ? "tag tag-ok"
  : key === "active" ? "tag tag-status"
  : key === "delivered" || key === "verification" ? "tag tag-status"
  : key === "cancelled" ? "tag tag-neutral"
  : "tag tag-outline";


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
  // "done" is still accepted here though it has no tab any more, so an old
  // link to the finished list still lands where it meant to.
  const asked: Bucket | null =
    show === "all" || ORDER.some((k) => k === show) ? (show as Bucket) : null;

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
  // The projects are the spine: every job under a home the member owns. A
  // booking, where there is one, is what dresses the row.
  const booked = new Map(me.bookings.map((b) => [b.project_id, b]));
  const all: Row[] = me.projects.map((p) => {
    const b = booked.get(p.project_id);
    return b ? { kind: "booking" as const, project_id: p.project_id, b, p } : { kind: "project" as const, project_id: p.project_id, p };
  });
  const mine = onlyHome ? all.filter((r) => r.p.home_project_id === onlyHome.project_id) : all;
  const counts = { all: 0, going: 0, offers: 0, done: 0 } as Record<Bucket, number>;
  for (const r of mine) { const k = bucketOf(r); if (k !== "cancelled") { counts[k]++; counts.all++; } }
  // Nobody asked, so: what is on-going - unless nothing is, in which case the
  // first tab that has something on it, and "All" if none of them do.
  const filter: Bucket = asked
    ?? (counts[DEFAULT_BUCKET] > 0 ? DEFAULT_BUCKET : ORDER.find((k) => counts[k] > 0) ?? "all");
  const shown = mine.filter((r) => { const k = bucketOf(r); return k !== "cancelled" && (filter === "all" || k === filter); });
  const manyHomes = me.homes.length > 1;
  const href = (b: Bucket) => {
    const q = new URLSearchParams();
    if (onlyHome) q.set("home", onlyHome.project_id);
    if (b !== DEFAULT_BUCKET) q.set("show", b);
    return q.size ? `/project?${q}` : "/project";
  };

  return (
    <Screen>
      <AppBar brand door="homeowner" right={<ShellIcons unread={unread} switcher={<DoorSwitchIcon current="homeowner" />} />} />
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
        <HomeHero photo={settings.hero} line={settings.taglineShown ? settings.tagline : null} />
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
                {TABS.filter((x) => x.key === "all" || counts[x.key] > 0).map((x) => (
                  <Link key={x.key} href={href(x.key)} className={`tag ${filter === x.key ? "" : "tag-neutral"}`} aria-current={filter === x.key ? "page" : undefined} style={{ textDecoration: "none", padding: "7px 12px", fontSize: 12 }}>
                    {x.label} · {counts[x.key]}
                  </Link>
                ))}
              </nav>
            )}

            {(filter === "all" ? ORDER : [filter as Exclude<Bucket, "all">]).map((k) => {
              const rows = shown.filter((r) => bucketOf(r) === k);
              if (rows.length === 0) return null;
              return (
                <section className="stack" style={{ gap: 10 }} key={k}>
                  {filter === "all" && <div className="divider-label">{SECTION[k]}</div>}
                  {rows.map((r) => r.kind === "booking"
                    ? <BookingRow key={r.project_id} b={r.b} showHome={manyHomes && !onlyHome} />
                    : <ProjectRow key={r.project_id} p={r.p} showHome={manyHomes && !onlyHome} />)}
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


// A JOB NOBODY BOOKED. No package, no price, no wizard answers - a name,
// what is open on it, and the way in. Everything the booking row shows comes
// from a booking, and inventing any of it here would be a lie with a number
// in it.
function ProjectRow({ p, showHome }: { p: ProjectSummary; showHome: boolean }) {
  const st = p.progress_label;
  return (
    <Link href={`/project/${p.project_id}`} className="home-row">
      <span className="ic" aria-hidden>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 10.5 12 4l9 6.5" /><path d="M5 9.5V20h14V9.5" /><path d="M10 20v-5h4v5" />
        </svg>
      </span>
      <span className="grow">
        <span className="t">{p.name}{p.unread > 0 && <span className="tag tag-status" style={{ marginLeft: 6, padding: "1px 7px" }}>{p.unread}</span>}</span>
        <span className="m" style={{ display: "block" }}>
          {[showHome && p.home_name ? p.home_name : null, st?.detail].filter(Boolean).join(" · ")}
        </span>
      </span>
      {st && <span className={tagFor(st.key)}>{st.label}</span>}
    </Link>
  );
}

function BookingRow({ b, showHome }: { b: BookingSummary; showHome: boolean }) {
  // The same rule as every other row (migration 119). What a booking adds is
  // the money: a reference price while it is a plan, what it went out at
  // while it is looking, what it came to when it is finished.
  const st = b.progress_label;
  const money =
    st?.key === "planned" ? `${dollars(b.price_cents)} reference${b.config_label ? ` · ${b.config_label}` : ""}`
    : st?.key === "finding" ? `${dollars(b.price_cents)} · posted ${shortDate(b.posted_at)}`
    : st?.key === "done" && b.price_cents > 0 ? `${dollars(b.price_cents)} · ${shortDate(b.done_at)}`
    : null;
  const line = [
    showHome && b.address ? b.address.split(",")[0] : null,
    b.contractor?.name ?? null,
    money ?? st?.detail ?? null,
  ].filter(Boolean).join(" · ");
  return (
    <Link href={`/project/${b.project_id}`} className="home-row">
      <span className="ic"><Illustration name={b.illustration} /></span>
      <span className="grow">
        <span className="t">{b.name}{b.unread > 0 && <span className="tag tag-status" style={{ marginLeft: 6, padding: "1px 7px" }}>{b.unread}</span>}</span>
        <span className="m" style={{ display: "block" }}>{line}</span>
      </span>
      {st
        ? <span className={tagFor(st.key)}>{st.key === "planned" ? targetWindowLabel(b.target_window) : st.label}</span>
        : null}
    </Link>
  );
}
