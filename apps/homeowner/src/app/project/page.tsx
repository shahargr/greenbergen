import Link from "next/link";
import { redirect } from "next/navigation";
import { getMe, targetWindowLabel, type BookingSummary, type Home } from "@/lib/me";
import { currentMonth, isBookable, loadTiles, seasonal, type Tile } from "@shared/catalogue";
import { dollars, shortDate } from "@shared/format";
import { AppBar, Card, ChevronIcon, HouseIcon, Notice, Screen, ShellIcons } from "@shared/ui";
import { Illustration } from "@shared/Illustrations";
import { PackageTile } from "@/components/PackageTile";
import { HomeTabs } from "@/components/HomeTabs";
import { PhotoBanner } from "@/components/PhotoBanner";
import { stopwatch } from "@shared/perf";

export const dynamic = "force-dynamic";
export const metadata = { title: "Green Bergen" };

// The home screen leads with the QUESTION, not the filing cabinet: eight
// packages we can price on the spot, four to a row, then More. Everything
// the member already has - homes, jobs planned, live, done and cancelled -
// sits underneath, because a returning member scrolls to it while a new one
// never has to. Tapping a home narrows the jobs to that home (?home=); the
// state chips narrow them further.
type Bucket = "all" | "planned" | "live" | "done" | "cancelled";
const BUCKETS: { key: Bucket; label: string }[] = [
  { key: "all", label: "All" }, { key: "planned", label: "DIY" }, { key: "live", label: "In progress" }, { key: "done", label: "Completed" }, { key: "cancelled", label: "Cancelled" },
];
const bucketOf = (b: BookingSummary): Exclude<Bucket, "all"> =>
  b.state === "planned" ? "planned" : b.state === "closed" ? "cancelled" : b.state === "done" ? "done" : "live";

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
  const unread = me.bookings.reduce((a, b) => a + (b.unread ?? 0), 0);
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
  const canAdd = me.home_quota?.can_add ?? true;
  const order: Exclude<Bucket, "all">[] = ["live", "planned", "done", "cancelled"];
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

        {(me.homes.length > 0 || me.bookings.length > 0) ? (
          <>
            <div className="divider-label" style={{ marginTop: 6 }}>
              {onlyHome ? (onlyHome.address?.split(",")[0] ?? "This home") : manyHomes ? `Your homes · ${me.homes.length}` : "Your home"}
            </div>

            {onlyHome ? (
              <Link href="/project" className="btn btn-ghost" style={{ alignSelf: "flex-start", padding: 0 }}>← All homes</Link>
            ) : (
              <section className="homes">
                {me.homes.map((h) => <HomeLine key={h.project_id} home={h} />)}
              </section>
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

            <Link href="/homes/new" className={`home-row add ${canAdd ? "" : "disabled"}`} style={canAdd ? undefined : { opacity: 0.6 }}>
              <span className="ic">+</span>
              <span className="grow">
                <span className="t">Add another home</span>
                <span className="m" style={{ display: "block" }}>{canAdd ? "A rental, a second home, a parent's place." : `Your agreement covers ${me.home_quota?.allowed ?? 1} home${(me.home_quota?.allowed ?? 1) === 1 ? "" : "s"}.`}</span>
              </span>
              <ChevronIcon />
            </Link>
          </>
        ) : (
          <Card soft pad>
            <div className="small">No home on file yet — picking a package adds one. Or <Link href="/homes/new">just add your home</Link> and start a DIY project for it.</div>
          </Card>
        )}
      </div>
      <HomeTabs current="project" unread={unread} />
    </Screen>
  );
}

function HomeLine({ home: h }: { home: Home }) {
  const bits: string[] = [];
  if (h.live) bits.push(`${h.live} in progress`);
  if (h.planned) bits.push(`${h.planned} DIY`);
  if (h.done) bits.push(`${h.done} done`);
  return (
    <Link href={`/project?home=${h.project_id}`} className="home-row">
      <span className="ic"><HouseIcon /></span>
      <span className="grow">
        <span className="t">{h.address?.split(",")[0] ?? h.name ?? "Home"}</span>
        <span className="m" style={{ display: "block" }}>{h.address?.split(",").slice(1).join(",").trim() || h.town || ""}{bits.length ? ` · ${bits.join(", ")}` : " · nothing yet"}</span>
      </span>
      <ChevronIcon />
    </Link>
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
