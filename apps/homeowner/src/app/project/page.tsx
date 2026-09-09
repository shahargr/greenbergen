import Link from "next/link";
import { redirect } from "next/navigation";
import { getMe, targetWindowLabel, type BookingSummary } from "@/lib/me";
import { currentMonth, isBookable, loadTiles, seasonal, type Tile } from "@shared/catalogue";
import { dollars, shortDate } from "@shared/format";
import { AppBar, Card, ChevronIcon, Notice, Screen, ShellIcons } from "@shared/ui";
import { unreadForShell } from "@shared/unread";
import { Illustration } from "@shared/Illustrations";
import { PackageTile } from "@/components/PackageTile";
import { PhotoBanner } from "@/components/PhotoBanner";
import { stopwatch } from "@shared/perf";

export const dynamic = "force-dynamic";
export const metadata = { title: "Green Bergen" };

// The home screen leads with the QUESTION, not the filing cabinet: the
// catalogue first, then the member's own projects - planned, live, done,
// cancelled - underneath, because a returning member scrolls to them while a
// new one never has to. Homes themselves live in the profile.
type Bucket = "all" | "planned" | "live" | "done" | "cancelled";
const BUCKETS: { key: Bucket; label: string }[] = [
  { key: "all", label: "All" }, { key: "planned", label: "DIY" }, { key: "live", label: "In progress" }, { key: "done", label: "Completed" }, { key: "cancelled", label: "Cancelled" },
];
const bucketOf = (b: BookingSummary): Exclude<Bucket, "all"> =>
  b.state === "planned" ? "planned" : b.state === "closed" ? "cancelled" : b.state === "done" ? "done" : "live";

const ContractorsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="9" cy="8" r="3.4" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><circle cx="17" cy="9" r="2.6" /><path d="M17.5 14.6c2.2.5 3.5 2.2 3.5 4.4" />
  </svg>
);

export default async function ProjectIndex({ searchParams }: { searchParams: Promise<{ ok?: string; show?: string; home?: string }> }) {
  const { ok, show, home } = await searchParams;
  const w = stopwatch("/project");
  // The catalogue is template data behind a shared cache; it does not wait
  // on the member's own read and the member's read does not wait on it.
  // loadSections went with the category headings: no section renders here any
  // more, so the round trip that fetched their labels was pure cost.
  const [me, { tiles }] = await Promise.all([
    w.step("me", () => getMe()),
    w.step("tiles", () => loadTiles()),
  ]);
  w.done();
  if (!me.signed_in) redirect("/login?next=/project");
  // Everything waiting on you, not just the booking conversations: the old
  // count missed offers, questions and anything else addressed to you.
  // my_unread_count() is the same predicate the inbox list calls `pending`.
  const unread = await unreadForShell();
  const filter: Bucket = BUCKETS.some((x) => x.key === show) ? (show as Bucket) : "all";

  // ONE list, each package once.
  //
  // This screen used to show a package up to three times - in "Most booked",
  // again on the seasonal rail, and again in its category section. Three
  // sections, three names, one job: the grid looked full while saying the
  // same thing over and over, and a member scrolling it could not tell what
  // was new from what they had already passed.
  //
  // What replaced them is a headline row and the rest. The headline is
  // tile_group = 'front' - six packages we choose to lead with, in the order
  // we chose (migration 025). It is NOT a claim that they are bookable: every
  // tile carries its own live-or-dim state either way, so the row we lead with
  // and the truth about each tile stay two separate things.
  //
  // Below it, everything else, live before dim - the split being the only
  // thing a member needs before tapping: can we do this now, or not yet.
  // Category and season lost their headings; season kept its place in the
  // ORDER, so the sprinkler blow-out surfaces in October without being filed
  // away from where people look the other eleven months.
  const month = currentMonth();
  const inMonth = new Set(seasonal(tiles, month).map((t) => t.code));
  const rank = (a: Tile, b: Tile) =>
    Number(inMonth.has(b.code)) - Number(inMonth.has(a.code)) || a.sort_order - b.sort_order;
  const headline = tiles.filter((t) => t.tile_group === "front").sort((a, b) => a.sort_order - b.sort_order);
  const rest = tiles.filter((t) => t.tile_group !== "front");
  const live = rest.filter(isBookable).sort(rank);
  const dim = rest.filter((t) => !isBookable(t)).sort(rank);
  const noneLive = !headline.some(isBookable) && live.length === 0;

  const onlyHome = me.homes.find((h) => h.project_id === home) ?? null;
  const mine = onlyHome ? me.bookings.filter((b) => b.home_project_id === onlyHome.project_id) : me.bookings;
  const counts = { all: mine.length, planned: 0, live: 0, done: 0, cancelled: 0 } as Record<Bucket, number>;
  for (const b of mine) counts[bucketOf(b)]++;
  const shown = filter === "all" ? mine : mine.filter((b) => bucketOf(b) === filter);
  const manyHomes = me.homes.length > 1;
  const order: Exclude<Bucket, "all">[] = ["live", "planned", "done", "cancelled"];
  const href = (b: Bucket) => {
    const q = new URLSearchParams();
    if (onlyHome) q.set("home", onlyHome.project_id);
    if (b !== "all") q.set("show", b);
    return q.size ? `/project?${q}` : "/project";
  };

  return (
    <Screen>
      <AppBar brand door="homeowner" right={<ShellIcons unread={unread}  homeHref="/project" />} />
      <div className="body">
        {ok === "home" && <div className="banner-ok">Home added. Pick a package for it whenever you like.</div>}
        {ok === "removed" && <div className="banner-ok">Removed from your DIY projects. Nothing was ever sent.</div>}
        {me.missing && <Notice title="Preview mode">The database migration in db/ has not been applied yet, so homes and projects cannot be read. The catalogue still works.</Notice>}
        {me.degraded && <Notice kind="error" title="We couldn&apos;t load your homes just now.">Nothing is lost. <Link href="/project">Try again</Link>, and if it keeps happening tell us.</Notice>}
        <PhotoBanner bookings={me.bookings} />

        <div className="hero">
          <h1>Ready to take on a new project?</h1>
          <p className="lead">
            Every one of these has a number before anyone comes to look. Take it on yourself and
            keep it in your DIY list, or hand it over turn-key and we run it. Tap one to see
            what&apos;s included.
          </p>
        </div>
        {headline.length > 0 && (
          <div className="tiles quad">
            {headline.map((p) => <PackageTile key={p.code} pkg={p} />)}
          </div>
        )}

        {noneLive && (
          // Not a bug, and it must not read like one. When nobody approved
          // carries any of these trades, every tile on the screen is dim -
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

        {live.length > 0 && (
          <section className="stack" style={{ gap: 8, marginTop: 4 }}>
            <div className="divider-label">Also ready now</div>
            <div className="tiles quad">
              {live.map((p) => <PackageTile key={p.code} pkg={p} />)}
            </div>
          </section>
        )}

        {dim.length > 0 && (
          <section className="stack" style={{ gap: 8, marginTop: 4 }}>
            <div className="divider-label">Not yet</div>
            <p className="tiny text-muted" style={{ margin: "-4px 0 2px" }}>
              Priced, but nobody approved covers it yet — or it needs a look first. Open one to
              read what it involves, keep it as a DIY project, or ask to be told when it opens up.
            </p>
            <div className="tiles quad">
              {dim.map((p) => <PackageTile key={p.code} pkg={p} />)}
            </div>
          </section>
        )}

        {/* Who does the work. The directory is the answer to "who are these
            people" - trades, area, record - without turning into a lead list. */}
        <Link href="/contractors" className="home-row">
          <span className="ic"><ContractorsIcon /></span>
          <span className="grow">
            <span className="t">The contractors</span>
            <span className="m" style={{ display: "block" }}>Who is approved, what they do, where they work, how they have done.</span>
          </span>
          <ChevronIcon />
        </Link>

        {/* The jobs - planned, live, done, cancelled. The list of HOMES is not
            here any more: it lives in the profile (gear), where it can be
            edited, and "add another home" is offered where it is actually
            needed - when a package is booked and the wizard asks which home.
            The ?home= filter still works for links that carry it. */}
        {me.bookings.length > 0 ? (
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
