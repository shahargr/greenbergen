import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { getMe, syncPaperwork } from "@/lib/me";
import { AppBar, Card, ChevronIcon, Notice, Screen, ShellIcons } from "@shared/ui";
import { DOORS } from "@shared/doors";
import { stopwatch } from "@shared/perf";
import { unreadForShell } from "@shared/unread";
import { loadDoors } from "@shared/doors.server";
import { anyRuns, buildTree, coverUrls, faceUrl, getBoard, live as onBoard, topOf } from "@/lib/board";
import { PropertyRow } from "@/components/PropertyRow";

export const dynamic = "force-dynamic";
export const metadata = { title: "Work" };

// The professional's landing, and the one screen that has to answer "what am
// I doing today" without being read.
//
// It used to open with four rows of paperwork and a Next card explaining
// what did not exist yet, so the properties a person actually runs were
// below the fold or absent.
//
// The paperwork is gone from here entirely now. Shahar (2026-09-14): "remove
// the 4 things left from my professional login page into messages i cannot
// dismiss without uploading these papers. this way the messages stays
// un-opened all the time until they are resolved." A shut drawer saying "4
// things left" is something you stop seeing on the second day; four messages
// that refuse to be read or archived are not. The unread badge on the shell
// carries them, contractor_paperwork_sync keeps them honest (migration 104),
// and this screen is about the work.
export default async function WorkPage() {
  const w = stopwatch("/work");
  // Four independent reads, sent together. The board is the same
  // portal_my_work every board screen runs on, so this costs no new query
  // shape - it is the read /projects already makes.
  const [me, , doors, board, unread] = await Promise.all([
    w.step("me", () => getMe()),
    // A safety net, not the main path: contractor_document_upload closes its
    // own message the moment a paper lands, so this only ever catches a gap
    // that opened somewhere else - a certificate that ran out overnight.
    w.step("paperwork", () => syncPaperwork()),
    w.step("doors", () => loadDoors()),
    w.step("board", () => getBoard()),
    // One integer for the badge on the shell - never the whole inbox.
    w.step("unread", () => unreadForShell()),
  ]);
  if (!me.signed_in) redirect("/login?next=/work");

  // A job the owner put away is off this screen too (migration 115).
  const built = buildTree(onBoard(board.seats), board.tasks, board.me?.contact_id ?? null);
  // A development is a folder: what is under it comes up to the top level,
  // however many folders there are. Same rule /projects uses - they must not
  // disagree about what a property is (topOf, 2026-09-14).
  const { top, folders, loose } = topOf(built);

  // Live properties only. "Done" is a filing cabinet, and the landing is
  // not a filing cabinet - the board has the full list behind one tap.
  const isLive = (n: (typeof top)[number]) => !(n.seat.buckets ?? []).includes("done");
  const live = top.filter(isLive);

  // GROUPED THE WAY IT IS OWNED. Shahar (2026-09-14): "start with Greenbergen
  // project as a panel with all that sits on it, and than move to community
  // projects, listing Ran's generator as a project."
  //
  // A development is a heading over its properties rather than a card beside
  // them. What is left - a job on somebody else's home, which is how every
  // seat that is not yours arrives - is the community's, and says so.
  const groups = [
    ...folders.map((f) => ({
      key: f.seat.project_id,
      title: f.seat.project_name,
      href: `/project/${f.seat.project_id}`,
      rows: f.children.filter(isLive),
    })),
    ...(loose.filter(isLive).length > 0
      ? [{ key: "community", title: "Community projects", href: null, rows: loose.filter(isLive) }]
      : []),
  ].filter((g) => g.rows.length > 0);

  const supabase = await createClient();
  const covers = await w.step("covers", () => coverUrls(supabase, live.map((n) => n.seat.cover)));
  w.done();

  const first = me.profile.full_name?.trim().split(" ")[0] ?? null;
  const openTasks = board.tasks.filter((t) => t.state === "open").length;
  const manages = doors.manages || live.some(anyRuns);

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

        {/* THE WORK, one panel per place it comes from. The development's
            own name is the heading and links to it, so its roll-up across
            everything beneath is still one tap away without spending a
            screenful of picture on it. */}
        {groups.map((g) => (
          <section className="stack" style={{ gap: 8 }} key={g.key}>
            <div className="divider-label">
              {g.href
                ? <Link href={g.href} style={{ color: "inherit" }}>{g.title}</Link>
                : g.title} · {g.rows.length}
            </div>
            <div className="home-panel">
              {g.rows.slice(0, 6).map((n) => (
                <PropertyRow key={n.seat.project_id} node={n} url={faceUrl(n.seat, covers)} />
              ))}
            </div>
            {g.rows.length > 6 && (
              <Link href="/projects" className="small" style={{ alignSelf: "flex-start" }}>
                All {g.rows.length} under {g.title} →
              </Link>
            )}
          </section>
        ))}

        {live.length > 0 && (
          <Link href="/projects" className="home-row nav-row">
            <span className="grow"><span className="t">All {top.length} on the board</span>
              <span className="m" style={{ display: "block" }}>Including the ones that are finished</span></span>
            <ChevronIcon />
          </Link>
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
          {/* THE WHOLE CATALOGUE, not just the trades you work. Shahar
              (2026-09-14): "i need access to all packages - menu item. admin
              is ok profile for it." It lives in the portal, because editing a
              package is an admin job and the editor is already there. */}
          {me.profile.is_superadmin && (
            <Link href={`${DOORS.portal.url}/admin/packages`} className="home-row nav-row">
              <span className="grow"><span className="t">All packages</span>
                <span className="m" style={{ display: "block" }}>Every package in the catalogue — what it includes, its price, who serves it, and how to add one</span></span>
              <ChevronIcon />
            </Link>
          )}
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
