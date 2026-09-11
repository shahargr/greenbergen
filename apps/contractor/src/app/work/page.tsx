import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { getMe } from "@/lib/me";
import { AppBar, Card, ChevronIcon, Notice, Screen, ShellIcons } from "@shared/ui";
import { stopwatch } from "@shared/perf";
import { unreadForShell } from "@shared/unread";
import { loadDoors } from "@shared/doors.server";
import { anyRuns, buildTree, coverUrls, faceUrl, getBoard } from "@/lib/board";
import { PropertyCard } from "@/components/PropertyCard";
import { ReadyCard } from "@/components/ReadyCard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Work" };

// The professional's landing, and the one screen that has to answer "what am
// I doing today" without being read.
//
// It used to open with four rows of paperwork and a Next card explaining
// what did not exist yet, so the properties a person actually runs were
// below the fold or absent. The order now is: what is live, then what is
// missing, then what is coming - and the first of those is the only one
// that gets room.
export default async function WorkPage() {
  const w = stopwatch("/work");
  // Four independent reads, sent together. The board is the same
  // portal_my_work every board screen runs on, so this costs no new query
  // shape - it is the read /projects already makes.
  const [me, doors, board, unread] = await Promise.all([
    w.step("me", () => getMe()),
    w.step("doors", () => loadDoors()),
    w.step("board", () => getBoard()),
    // One integer for the badge on the shell - never the whole inbox.
    w.step("unread", () => unreadForShell()),
  ]);
  if (!me.signed_in) redirect("/login?next=/work");

  const built = buildTree(board.seats, board.tasks, board.me?.contact_id ?? null);
  // A single root is not a board, it IS the board - every seat hangs off it,
  // so promote its children and let the development be the heading. Same
  // rule /projects uses; they must not disagree about what a property is.
  const roof = built.length === 1 && built[0]!.children.length > 0 ? built[0]! : null;
  const top = roof ? roof.children : built;

  // Live properties only. "Done" is a filing cabinet, and the landing is
  // not a filing cabinet - the board has the full list behind one tap.
  const live = top.filter((n) => !(n.seat.buckets ?? []).includes("done"));
  const shown = live.slice(0, 4);

  const supabase = await createClient();
  const covers = await w.step("covers", () => coverUrls(supabase, shown.map((n) => n.seat.cover)));
  w.done();

  const first = me.profile.full_name?.trim().split(" ")[0] ?? null;
  const openTasks = board.tasks.filter((t) => t.state === "open").length;
  const manages = doors.manages || shown.some(anyRuns);

  return (
    <Screen>
      <AppBar brand right={<ShellIcons unread={unread} gearHref="/business" inboxHref="/inbox" />} />
      <div className="body">
        {me.missing && <Notice title="Preview mode">The contractor migration has not been applied to this database yet, so your profile cannot be read.</Notice>}
        {me.degraded && <Notice kind="error" title="We couldn&apos;t load your account just now.">Nothing is lost. <Link href="/work">Try again</Link>, and if it keeps happening tell us.</Notice>}

        <div className="hero">
          <h1>{first ? `Welcome, ${first}.` : "Welcome."}</h1>
          <p className="lead">
            {live.length > 0
              ? `${live.length} ${live.length === 1 ? "property" : "properties"} live${openTasks ? ` · ${openTasks} open ${openTasks === 1 ? "task" : "tasks"}` : ""}.`
              : me.can_accept
                ? "You're approved. Work in your trades and towns shows up here."
                : "Work in your trades will show up here. You can look now; accepting needs your paperwork."}
          </p>
        </div>

        {/* Shut by default: paperwork is never why someone opened the app. */}
        <ReadyCard me={me} />

        {/* THE WORK. Properties first, with their faces on them. */}
        {live.length > 0 && (
          <section className="stack" style={{ gap: 10 }}>
            <div className="divider-label">Your properties</div>
            {shown.map((n) => <PropertyCard key={n.seat.project_id} node={n} url={faceUrl(n.seat, covers)} />)}
            {live.length > shown.length && (
              <Link href="/projects" className="home-row">
                <span className="grow"><span className="t">All {top.length} on the board</span>
                  <span className="m" style={{ display: "block" }}>Including the ones that are finished</span></span>
                <ChevronIcon />
              </Link>
            )}
          </section>
        )}

        {/* WHERE THE BOTTOM BAR WENT. Shahar: "remove the bottom bar across
            the entire site." The sections it named are rows here, on the one
            screen everyone starts from; the wordmark brings you back to it.
            The manager's rows only appear when there is something to manage,
            as the bar's middle used to. */}
        <section className="stack" style={{ gap: 8 }}>
          <div className="divider-label">Around your work</div>
          <Link href="/jobs" className="home-row nav-row">
            <span className="grow"><span className="t">My jobs</span></span><ChevronIcon />
          </Link>
          <Link href="/packages" className="home-row nav-row">
            <span className="grow"><span className="t">Packages in your trades</span>
              <span className="m" style={{ display: "block" }}>What they include, the community price, and sign up to serve them</span></span>
            <ChevronIcon />
          </Link>
          {manages && (
            <>
              <Link href="/projects" className="home-row nav-row">
                <span className="grow"><span className="t">Projects</span>
                  <span className="m" style={{ display: "block" }}>The board: everything you run, live and finished</span></span>
                <ChevronIcon />
              </Link>
              <Link href="/tasks" className="home-row nav-row">
                <span className="grow"><span className="t">Tasks{openTasks > 0 && <span className="n">{openTasks}</span>}</span></span>
                <ChevronIcon />
              </Link>
              <Link href="/money" className="home-row nav-row">
                <span className="grow"><span className="t">Money</span></span><ChevronIcon />
              </Link>
            </>
          )}
        </section>

        <Link href="/business/trades?from=work" className="home-row" style={{ alignItems: "flex-start" }}>
          <span className="grow" style={{ minWidth: 0 }}>
            <span className="t">Your trades</span>
            {me.trades.length > 0 ? (
              <span className="chips" style={{ marginTop: 6 }}>
                {me.trades.map((t) => <span key={t.trade} className="tag tag-neutral" style={{ padding: "5px 10px", fontSize: 11 }}>{t.trade}</span>)}
              </span>
            ) : (
              <span className="m" style={{ display: "block" }}>None picked yet — no work can reach you until you pick at least one.</span>
            )}
          </span>
          <ChevronIcon />
        </Link>

        {/* The feed is step 3. Say so rather than showing an empty list that
            looks like "no work for you". */}
        <Card soft pad>
          <div className="kicker">Next</div>
          <p className="small" style={{ margin: "6px 0 0" }}>
            The offer feed opens here once your trades and documents are in — every job in your trades,
            with the scope, the photos and the community price. You&apos;ll see the town; the address is
            shared the moment you accept.
          </p>
        </Card>
      </div>
    </Screen>
  );
}
