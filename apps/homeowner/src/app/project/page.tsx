import Link from "next/link";
import { redirect } from "next/navigation";
import { getMe, targetWindowLabel, type BookingSummary, type Home } from "@/lib/me";
import { dollars, shortDate } from "@shared/format";
import { AppBar, Card, ChevronIcon, HouseIcon, Notice, Screen } from "@shared/ui";
import { House, Illustration } from "@shared/Illustrations";
import { HomeTabs } from "@/components/HomeTabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "My home" };

// The member's home(s): what is live, what is planned, what is done on
// each. One home with one job is still one screen, not a list of one -
// the job card is right there. E4 when there is nothing at all.
export default async function ProjectIndex({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  const { ok } = await searchParams;
  const me = await getMe();
  if (!me.signed_in) redirect("/login?next=/project");
  const unread = me.bookings.reduce((a, b) => a + (b.unread ?? 0), 0);

  if (me.homes.length === 0 && me.bookings.length === 0) {
    return (
      <Screen>
        <AppBar brand />
        <div className="body">
          {me.missing && <Notice title="Preview mode">The database migration in db/ has not been applied yet, so homes and projects cannot be read. The catalogue still works.</Notice>}
          <div className="illus"><House /></div>
          <Card pad>
            <h1>No home on file yet. That&apos;s the whole screen.</h1>
            <p className="lead text-muted" style={{ margin: 0 }}>Book a package or plan one for later, and your home appears here with a progress line, a folder and a timeline. Most neighbors start with something small.</p>
          </Card>
        </div>
        <div className="actions">
          <Link href="/packages" className="btn btn-primary btn-block">Pick a package</Link>
          <Link href="/homes/new" className="btn btn-secondary btn-block">Just add my home for now</Link>
          <Link href="/packages/something_else" className="btn btn-ghost btn-block">I already work with a contractor</Link>
        </div>
        <HomeTabs current="project" />
      </Screen>
    );
  }

  const byHome = new Map<string, BookingSummary[]>();
  for (const b of me.bookings) byHome.set(b.home_project_id, [...(byHome.get(b.home_project_id) ?? []), b]);
  const canAdd = me.home_quota?.can_add ?? true;

  return (
    <Screen>
      <AppBar brand right={<Link href="/packages" className="btn btn-ghost">+ Package</Link>} />
      <div className="body">
        {ok === "home" && <div className="banner-ok">Home added. Pick a package for it whenever you like.</div>}
        {ok === "removed" && <div className="banner-ok">Plan removed. Nothing was ever sent.</div>}
        <div className="hero">
          <h1>{me.homes.length === 1 ? (me.homes[0]!.address?.split(",")[0] ?? "Your home") : "Your homes"}</h1>
          {me.homes.length === 1 && <p className="lead">{me.homes[0]!.address?.split(",").slice(1).join(",").trim()}</p>}
        </div>
        {me.homes.map((h) => <HomeSection key={h.project_id} home={h} bookings={byHome.get(h.project_id) ?? []} single={me.homes.length === 1} />)}
        {me.bookings.filter((b) => !me.homes.some((h) => h.project_id === b.home_project_id)).map((b) => <BookingRow key={b.project_id} b={b} />)}
        <Link href="/homes/new" className={`home-row add ${canAdd ? "" : "disabled"}`} style={canAdd ? undefined : { opacity: 0.6 }}>
          <span className="ic">+</span>
          <span className="grow">
            <span className="t">Add another home</span>
            <span className="m" style={{ display: "block" }}>{canAdd ? "A rental, a second home, a parent's place." : `Your agreement covers ${me.home_quota?.allowed ?? 1} home${(me.home_quota?.allowed ?? 1) === 1 ? "" : "s"}.`}</span>
          </span>
          <ChevronIcon />
        </Link>
      </div>
      <HomeTabs current="project" unread={unread} />
    </Screen>
  );
}

function HomeSection({ home: h, bookings, single }: { home: Home; bookings: BookingSummary[]; single: boolean }) {
  const live = bookings.filter((b) => b.state === "posted" || b.state === "accepted");
  const planned = bookings.filter((b) => b.state === "planned");
  const past = bookings.filter((b) => b.state === "done" || b.state === "closed");
  return (
    <section className="stack" style={{ gap: 10 }}>
      {!single && (
        <div className="row" style={{ marginTop: 6 }}>
          <span className="ic" style={{ color: "var(--color-text)" }}><HouseIcon /></span>
          <div className="grow">
            <div className="card-title">{h.address?.split(",")[0] ?? h.name ?? "Home"}</div>
            <div className="small text-muted">{h.address?.split(",").slice(1).join(",").trim() || h.town}</div>
          </div>
        </div>
      )}
      {live.length > 0 && <><div className="divider-label">Live</div>{live.map((b) => <BookingRow key={b.project_id} b={b} />)}</>}
      {planned.length > 0 && <><div className="divider-label">Planned</div>{planned.map((b) => <BookingRow key={b.project_id} b={b} />)}</>}
      {bookings.length === 0 && (
        <Card soft pad>
          <div className="small">Nothing on this home yet. <Link href="/packages">Pick a package</Link> and choose it, or plan one for later.</div>
        </Card>
      )}
      {past.length > 0 && <><div className="divider-label">Done</div>{past.map((b) => <BookingRow key={b.project_id} b={b} />)}</>}
    </section>
  );
}

function BookingRow({ b }: { b: BookingSummary }) {
  const pill =
    b.state === "planned" ? <span className="tag tag-neutral">{targetWindowLabel(b.target_window)}</span>
    : b.state === "posted" && b.no_taker ? <span className="tag tag-status">Needs you</span>
    : b.state === "posted" ? <span className="tag tag-outline">Matching</span>
    : b.state === "accepted" ? <span className="tag tag-status">{b.progress ? `${b.progress.done_count}/${b.progress.total}` : "In progress"}</span>
    : b.state === "done" ? <span className="tag tag-ok">Done</span>
    : <span className="tag tag-neutral">Closed</span>;
  const line =
    b.state === "planned" ? `${dollars(b.price_cents)} when planned · ${b.config_label ?? ""}`
    : b.state === "accepted" ? `${b.contractor?.name ?? "Contractor"} · ${b.progress?.current?.name ?? "in progress"}`
    : b.state === "posted" ? `${dollars(b.price_cents)} · posted ${shortDate(b.posted_at)}`
    : b.state === "done" ? `${dollars(b.price_cents)} · ${shortDate(b.done_at)}`
    : `closed ${shortDate(b.closed_at)}`;
  return (
    <Link href={`/project/${b.project_id}`} className="home-row">
      <span className="ic"><Illustration name={b.illustration} /></span>
      <span className="grow">
        <span className="t">{b.name}{b.unread > 0 && <span className="tag tag-status" style={{ marginLeft: 6, padding: "1px 7px" }}>{b.unread}</span>}</span>
        <span className="m" style={{ display: "block" }}>{line}</span>
      </span>
      {pill}
    </Link>
  );
}
