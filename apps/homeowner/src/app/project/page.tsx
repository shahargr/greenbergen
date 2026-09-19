import Link from "next/link";
import { getMe } from "@/lib/me";
import { featured, loadPublicSettings, loadTiles } from "@shared/catalogue";
import { AppBar, Card, ChevronIcon, Notice, Screen, ShellIcons } from "@shared/ui";
import { DoorSwitchIcon } from "@shared/DoorSwitchIcon";
import { unreadForShell } from "@shared/unread";
import { Scene, SceneMore } from "@/components/Scene";
import { BobSearch } from "@/components/BobSearch";
import { rowsFor } from "@/components/ProjectRows";
import { stopwatch } from "@shared/perf";

export const dynamic = "force-dynamic";
export const metadata = { title: "Green Bergen" };

// THREE THINGS, IN THIS ORDER (Shahar, 2026-09-19): "landing on this page as
// home owner should show ask bob, below the promoted projects, and below my
// current open projects... all that shows there today can be removed."
//
//   1. Ask Bob          the sentence they already have in their head
//   2. Promoted         community negotiated packages
//   3. Their own work   how much of it, and the way to it
//
// AND THE THIRD IS A LINE, NOT A LIST (Shahar, same day): "These and the list
// of projects can be removed from the home page. If user has existing project
// allow him to know this and click to see them and manage them." The list
// moved to /projects, where it is fuller than it was here. A home screen
// answers "what now"; a list answers "where is everything", and only the
// first belongs on the first screen.
//
// WHAT CAME OFF ALTOGETHER: the bookings photo banner, the DIY rail, the hero
// photograph, the "nothing bookable today" notice, the "start your new
// project" card, the filter chips and the Done section. Each earned its place
// at the time; together they had turned the first screen of the app into a
// page you scroll rather than a page you use.

export default async function ProjectIndex({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  const { ok } = await searchParams;
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
  const counts = signedIn ? rowsFor(me).counts : null;

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

        {/* 3. THEIR OWN WORK - one line - or, with no session, the way in. */}
        {!signedIn && <JoinIn />}
        {signedIn && counts && counts.all > 0 && <YourWork counts={counts} />}
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

// YOU HAVE WORK, AND HERE IS THE DOOR TO IT. Only shown when there is some -
// a member with nothing yet is looking at the packages above, and a row
// saying "0 projects" would be a worse answer than no row at all.
//
// It counts OPEN work in the headline because that is what is actionable, and
// names the split only when both halves have something in them: "3 on-going ·
// 1 pending offer" says more than "4", and "4 on-going" says nothing "4"
// did not.
function YourWork({ counts }: { counts: Record<"all" | "going" | "offers" | "done", number> }) {
  const open = counts.going + counts.offers;
  const parts = [
    counts.going > 0 ? `${counts.going} on-going` : null,
    counts.offers > 0 ? `${counts.offers} pending ${counts.offers === 1 ? "offer" : "offers"}` : null,
  ].filter(Boolean);
  return (
    <Link href="/projects" className="home-row" style={{ marginTop: 6 }}>
      <span className="ic" aria-hidden>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 10.5 12 4l9 6.5" /><path d="M5 9.5V20h14V9.5" /><path d="M10 20v-5h4v5" />
        </svg>
      </span>
      <span className="grow">
        <span className="t">Your projects</span>
        <span className="m" style={{ display: "block" }}>
          {open > 0
            ? `${parts.join(" · ")} — see them and manage them`
            : `${counts.done} finished — see them and manage them`}
        </span>
      </span>
      <ChevronIcon />
    </Link>
  );
}
