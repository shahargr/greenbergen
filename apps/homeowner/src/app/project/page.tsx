import Link from "next/link";
import { getMe, targetWindowLabel, type BookingSummary, type ProjectSummary } from "@/lib/me";
import { featured, loadPublicSettings, loadTiles } from "@shared/catalogue";
import { dollars, shortDate } from "@shared/format";
import { AppBar, Card, ChevronIcon, Notice, Screen, ShellIcons } from "@shared/ui";
import { DoorSwitchIcon } from "@shared/DoorSwitchIcon";
import { unreadForShell } from "@shared/unread";
import { Illustration } from "@shared/Illustrations";
import { Scene, SceneMore } from "@/components/Scene";
import { BobSearch } from "@/components/BobSearch";
import { stopwatch } from "@shared/perf";

export const dynamic = "force-dynamic";
export const metadata = { title: "Green Bergen" };

// THREE THINGS, IN THIS ORDER (Shahar, 2026-09-19): "landing on this page as
// home owner should show ask bob, below the promoted projects, and below my
// current open projects... all that shows there today can be removed."
//
//   1. Ask Bob          the sentence they already have in their head
//   2. Promoted         community negotiated packages
//   3. Their own work   open jobs, or - signed out - the way in
//
// WHAT CAME OFF, and it was most of the screen: the bookings photo banner,
// the DIY rail, the hero photograph, the "nothing bookable today" notice, the
// "start your new project" card, the filter chips and the Done section. Each
// earned its place at the time; together they had turned the first screen of
// the app into a page you scroll rather than a page you use. Nothing is lost
// - /packages still carries every package, finished work is still on its own
// project page, and the ledger and the timeline still have all of it.
//
// CANCELLED WAS ALREADY OFF and stays off. Shahar (2026-09-12): "the
// cancelled section at the bottom of the page is a pointing finger to
// negative experience likely - should not be here."
type Bucket = "offers" | "going" | "done";
// TWO GROUPS, AND THE SPLIT IS WHO YOU ARE WAITING FOR. Shahar
// (2026-09-15): "Change under way to on-going (DIY or Awarded) / Change
// lining up to pending offers / Remove done, keeping all."
//
//   Pending offers          somebody has been ASKED and has not answered.
//   On-going (DIY or        nobody is being waited on: either a contractor
//   Awarded)                has it, or you do.
//
// The tabs are gone with everything else - the screen shows OPEN work, which
// is these two and nothing else. Done keeps no heading here now: finished
// work is not something you go looking for on a home screen, and it is still
// on its own project page.
const OPEN: Exclude<Bucket, "done">[] = ["going", "offers"];
const SECTION: Record<Exclude<Bucket, "done">, string> = {
  going: "On-going (DIY or Awarded)",
  offers: "Pending offers",
};

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
const bucketOf = (r: Row): Bucket | "cancelled" => {
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


export default async function ProjectIndex({ searchParams }: { searchParams: Promise<{ ok?: string; home?: string }> }) {
  const { ok, home } = await searchParams;
  const w = stopwatch("/project");
  // The catalogue is template data behind a shared cache and it is read with
  // the ANON key, so it answers for a visitor with no session exactly as it
  // does for a member. That is what lets this screen render signed out.
  const [me, { tiles }, settings] = await Promise.all([
    w.step("me", () => getMe()),
    w.step("tiles", () => loadTiles()),
    w.step("settings", () => loadPublicSettings()),
  ]);
  w.done();

  // NO REDIRECT ANY MORE. Shahar (2026-09-19): "if i am not logged in, so a
  // call to action to log in after the promoted ones." This screen used to
  // bounce a signed-out visitor to /login, which meant the one page that
  // shows what we DO could only be seen by somebody who had already decided
  // to join. Bob and the shelf are the pitch; the sign-in is the ask, and it
  // comes after them.
  const signedIn = me.signed_in;
  const unread = signedIn ? await unreadForShell() : 0;

  const scenes = featured(tiles);

  return (
    <Screen>
      <AppBar
        brand
        door="homeowner"
        right={signedIn
          ? <ShellIcons unread={unread} switcher={<DoorSwitchIcon current="homeowner" />} />
          : <Link href="/login?next=/project" className="small" style={{ fontWeight: 700 }}>Log in</Link>}
      />
      <div className="body">
        {signedIn && ok === "home" && <div className="banner-ok">Home added. Pick a package for it whenever you like.</div>}
        {signedIn && ok === "removed" && <div className="banner-ok">Removed from your DIY projects. Nothing was ever sent.</div>}
        {signedIn && me.missing && <Notice title="Preview mode">The database migration in db/ has not been applied yet, so homes and projects cannot be read. The catalogue still works.</Notice>}
        {signedIn && me.degraded && <Notice kind="error" title="We couldn&apos;t load your homes just now.">Nothing is lost. <Link href="/project">Try again</Link>, and if it keeps happening tell us.</Notice>}

        {/* 1. BOB LEADS (Shahar, 2026-09-19): "This page should lead with Ask
            Bob, like a search screen with audio / video recording option."
            A member arrives with a SITUATION - the power keeps going out -
            and a search box takes the sentence they already have, where a
            shelf asks them to know the name of the answer first. */}
        <BobSearch photo={settings.bobHero} signedIn={signedIn} />

        {/* 2. THE PROMOTED ONES. */}
        {scenes.length > 0 && (
          <section className="stack" style={{ gap: 10 }}>
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

        {/* 3. THEIR OWN WORK - or, with no session, the way in. */}
        {signedIn ? <OpenWork me={me} home={home} /> : <JoinIn />}
      </div>
    </Screen>
  );
}

// THE ASK, AFTER THE PITCH. Everything above this reads the same signed out
// as signed in, so by the time somebody gets here they have seen what Bob
// does and what the packages cost. ?next= brings them back to this screen
// rather than dropping them somewhere generic.
function JoinIn() {
  return (
    <Card soft pad>
      <div className="card-title">Your projects live here</div>
      <p className="small text-muted" style={{ margin: "4px 0 10px" }}>
        Log in to book a package, keep your jobs in one place and pick up where you left off.
      </p>
      <Link href="/login?next=/project" className="btn btn-primary btn-block">Log in or join</Link>
    </Card>
  );
}

// OPEN WORK ONLY. The ?home= filter is kept - links elsewhere in the app
// carry it - but it shows nothing of itself on the bare /project URL.
function OpenWork({ me, home }: { me: Extract<Awaited<ReturnType<typeof getMe>>, { signed_in: true }>; home?: string }) {
  const onlyHome = me.homes.find((h) => h.project_id === home) ?? null;
  // The projects are the spine: every job under a home the member owns. A
  // booking, where there is one, is what dresses the row.
  const booked = new Map(me.bookings.map((b) => [b.project_id, b]));
  const all: Row[] = me.projects.map((p) => {
    const b = booked.get(p.project_id);
    return b ? { kind: "booking" as const, project_id: p.project_id, b, p } : { kind: "project" as const, project_id: p.project_id, p };
  });
  const mine = onlyHome ? all.filter((r) => r.p.home_project_id === onlyHome.project_id) : all;
  const open = mine.filter((r) => { const k = bucketOf(r); return k === "going" || k === "offers"; });
  const manyHomes = me.homes.length > 1;

  if (open.length === 0) {
    return (
      <Card soft pad>
        <div className="small">Nothing open on your list — tap a package above to start one. Your home is added the first time a project needs it.</div>
      </Card>
    );
  }

  return (
    <>
      <div className="divider-label" style={{ marginTop: 6 }}>
        {onlyHome ? (onlyHome.address?.split(",")[0] ?? "This home") : "Your projects"}
      </div>
      {onlyHome && (
        <Link href="/project" className="btn btn-ghost" style={{ alignSelf: "flex-start", padding: 0 }}>← All homes</Link>
      )}
      {OPEN.map((k) => {
        const rows = open.filter((r) => bucketOf(r) === k);
        if (rows.length === 0) return null;
        return (
          <section className="stack" style={{ gap: 10 }} key={k}>
            <div className="divider-label">{SECTION[k]}</div>
            {rows.map((r) => r.kind === "booking"
              ? <BookingRow key={r.project_id} b={r.b} showHome={manyHomes && !onlyHome} />
              : <ProjectRow key={r.project_id} p={r.p} showHome={manyHomes && !onlyHome} />)}
          </section>
        );
      })}
    </>
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
