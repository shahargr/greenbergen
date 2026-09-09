import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getMe, TARGET_WINDOWS, targetWindowLabel } from "@/lib/me";
import { getBooking, type Booking } from "@/lib/booking";
import { encodeSelections } from "@shared/catalogue";
import { ago, dayClock, dollars, shortDate } from "@shared/format";
import { AppBar, Avatar, Card, Notice, NumberedNotes, Screen, StatusHero } from "@shared/ui";
import { ProgressLine } from "@shared/ProgressLine";
import { stopwatch } from "@shared/perf";
import { HomeTabs } from "@/components/HomeTabs";
import { PhotoRequest } from "@/components/PhotoRequest";
import { WaitingCard } from "./WaitingCard";
import { bookingAction, updatePlan } from "./actions";

export const dynamic = "force-dynamic";

// Screens 11 and 12: waiting (matching), no taker, closed, and the
// project view itself - one horizontal line, the contractor, what's next.
export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { id } = await params;
  const { error, ok } = await searchParams;
  const w = stopwatch("/project/[id]");
  // The shell and the job are independent reads; fetching them together
  // costs one round trip instead of two.
  const [me, { booking: b, missing }] = await Promise.all([
    w.step("me", () => getMe()),
    w.step("booking", () => getBooking(id)),
  ]);
  w.done();
  if (!me.signed_in) redirect(`/login?next=/project/${id}`);
  if (missing) redirect("/project");
  if (!b) notFound();
  const pkg = b.package;
  const town = b.address?.split(",")[1]?.trim().replace(/\s+NJ.*$/, "") ?? "your town";

  // The photos the job is still short of. The work is already out to
  // contractors at the locked price - this is only what lets one of them
  // confirm it without driving over, so it sits above the fold and never
  // stops anything. It vanishes when the last photo lands or the owner
  // closes the request from the inbox.
  const wants = b.photos && b.photos.action_id && b.photos.outstanding > 0 ? b.photos : null;
  const photosCard = wants ? (
    <div id="photos" className="card pad">
      <div className="card-title" style={{ fontSize: 16 }}>{wants.outstanding === 1 ? "One photo still to add" : `${wants.outstanding} photos still to add`}</div>
      <p className="small text-muted" style={{ margin: "2px 0 10px" }}>
        Your price is locked at {dollars(b.price_cents)} — this doesn&apos;t change it. It&apos;s what lets {b.contractor?.person?.split(" ")[0] ?? "the contractor"} confirm the job without a visit. Add them whenever you&apos;re next near the work.
      </p>
      <PhotoRequest projectId={b.project_id} slots={wants.slots} />
    </div>
  ) : null;

  const switcher = me.bookings.length > 1 && me.homes.length <= 1 && (
    <div className="seg" role="tablist" aria-label="Your projects" style={{ marginBottom: 4 }}>
      {me.bookings.filter((x) => x.state !== "closed" || x.project_id === id).slice(0, 3).map((x) => (
        <Link key={x.project_id} href={`/project/${x.project_id}`} className="seg-opt" role="tab" aria-selected={x.project_id === id}
          style={x.project_id === id ? { background: "var(--color-accent)", color: "var(--color-bg)", textDecoration: "none" } : { textDecoration: "none", color: "inherit" }}>
          {x.tile_title} · {x.state === "done" ? "done" : x.state === "planned" ? "DIY" : x.state === "posted" ? "matching" : pkg?.requires_permit ? "permit" : "booked"}
        </Link>
      ))}
    </div>
  );


  // ---- planned: on the list, nothing sent ------------------------------
  if (b.state === "planned") {
    const moved = b.live_price_cents != null && b.live_price_cents !== b.price_cents;
    return (
      <Screen>
        <AppBar back="/project" title={pkg?.name} sub={b.address?.split(",")[0] ?? undefined} />
        <div className="body">
          {ok === "plan" && <div className="banner-ok">Plan updated.</div>}
          {error && <Notice kind="error">{error}</Notice>}
          <StatusHero variant="neutral" kicker={`DIY · ${targetWindowLabel(b.target_window)}`} title={`Yours since ${shortDate(b.created_at)}. Nobody has been asked yet.`}>
            Do it at your pace — the scope and the price below are your reference. Changed your mind? One tap makes it turn-key: it goes to the community&apos;s {pluralTrade(pkg?.trade, 2)} at that day&apos;s price, and photos and a budget come at that point.
          </StatusHero>
          <Card pad={false}>
            <div className="price">
              <div className="kicker">Community price today</div>
              <div className="big mono">{dollars(b.live_price_cents ?? b.price_cents)}{moved && <span className="was">{dollars(b.price_cents)}</span>}</div>
              <div className="delta">{b.config_label ?? pkg?.config_label ?? "most common setup"}{moved ? ` · was ${dollars(b.price_cents)} when you planned it` : " · unchanged since you planned it"}</div>
            </div>
          </Card>
          {b.note && <blockquote>{b.note}</blockquote>}
          <Card pad>
            <div className="kicker">What&apos;s included</div>
            <ul className="scope" style={{ marginTop: 4 }}>
              {b.scope.map((si, i) => <li key={i}><span className="ic">✓</span><span>{si.item}{si.detail && <span className="detail"> — {si.detail}</span>}</span></li>)}
            </ul>
          </Card>
          <details className="card pad">
            <summary className="card-title" style={{ cursor: "pointer" }}>Change when</summary>
            <form action={updatePlan} className="stack" style={{ marginTop: 10 }}>
              <input type="hidden" name="project" value={b.project_id} />
              {TARGET_WINDOWS.map((t) => (
                <label className="radio" key={t.key}><input type="radio" name="target_window" value={t.key} defaultChecked={b.target_window === t.key} /><span className="dot" /><span>{t.label}</span></label>
              ))}
              <textarea className="input" name="note" rows={2} placeholder="A note to yourself" defaultValue={b.note ?? ""} />
              <button className="btn btn-secondary">Save</button>
            </form>
          </details>
        </div>
        <div className="actions">
          <Link href={`/packages/${b.package_code}/book?from=${b.project_id}`} className="btn btn-primary btn-block">Switch to turn-key</Link>
          <Link href={`/packages/${b.package_code}?sel=${encodeURIComponent(encodeSelections(b.selections))}`} className="btn btn-secondary btn-block">Adjust the package</Link>
          <form action={bookingAction.bind(null, b.project_id, "remove")}><button className="btn btn-ghost btn-block">Remove from my DIY projects</button></form>
        </div>
        <HomeTabs current="project" />
      </Screen>
    );
  }

  // ---- 11c closed -------------------------------------------------------
  if (b.state === "closed") {
    return (
      <Screen>
        <AppBar brand />
        <div className="body">
          {switcher}
          <StatusHero variant="neutral" kicker={`Closed · ${shortDate(b.closed_at)}`} title="We've closed the request. No hard feelings.">
            Nothing was charged and nobody has your address. Your home details and photos stay in your account, so the next package takes a minute, not ten.
          </StatusHero>
          <Card pad={false}>
            <div className="kv-rows" style={{ padding: "4px 14px" }}>
              <div><span className="k">Saved</span><span>{b.address?.split(",")[0]} · {b.files.length} photo{b.files.length === 1 ? "" : "s"} · home details</span></div>
              <div><span className="k">Charged</span><span>$0</span></div>
              <div><span className="k">Want a nudge?</span><span>We&apos;ll email if the community price drops</span></div>
            </div>
          </Card>
        </div>
        <div className="actions">
          <Link href="/packages" className="btn btn-primary btn-block">Browse packages</Link>
          <form action={bookingAction.bind(null, b.project_id, "reopen")}>
            <button className="btn btn-ghost btn-block">Reopen at {dollars(bump(b.price_cents))}</button>
          </form>
        </div>
        <HomeTabs current="project" />
      </Screen>
    );
  }

  // ---- 11a / 11b matching -----------------------------------------------
  if (b.state === "posted") {
    if (b.no_taker) {
      const next = bump(b.price_cents);
      return (
        <Screen>
          <AppBar brand />
          <div className="body">
            {switcher}
            <div className="kicker">{ago(b.posted_at)} · {pkg?.tile_title} · {b.address?.split(",")[0]}</div>
            <div className="hero">
              <h1>Nobody picked it up at {dollars(b.price_cents)}. Here&apos;s the honest picture.</h1>
              <p className="lead">
                {b.offered_count > 0
                  ? `${numberWord(b.offered_count)} ${pluralTrade(pkg?.trade, b.offered_count)} saw it and none took it in the window. That's not a negotiation — it's just what happened.`
                  : `No ${pluralTrade(pkg?.trade, 2)} for this package are signed in to the community yet, so nobody could take it. A person at Green Bergen sees this and is bringing one in.`}
              </p>
            </div>
            {error && <Notice kind="error">{error}</Notice>}
            <Card pad>
              <div className="price" style={{ padding: 0 }}>
                <div className="kicker">Repost at</div>
                <div className="big mono">{dollars(next)}<span className="was">{dollars(b.price_cents)}</span></div>
                <div className="delta">+{dollars(next - b.price_cents)} ({Math.round(((next - b.price_cents) / b.price_cents) * 100)}%)</div>
              </div>
              <p className="small" style={{ margin: "8px 0 0" }}>Same scope, same warranty. Still an estimate pending contractor confirmation — and still paid directly to them.</p>
            </Card>
            <p className="small text-muted" style={{ margin: 0 }}>Or wait — your job stays posted at {dollars(b.price_cents)} for another 48 hours, no action needed.</p>
          </div>
          <div className="actions">
            <form action={bookingAction.bind(null, b.project_id, "bump")}><button className="btn btn-primary btn-block">Repost at {dollars(next)}</button></form>
            <form action={bookingAction.bind(null, b.project_id, "wait")}><button className="btn btn-secondary btn-block">Keep waiting at {dollars(b.price_cents)}</button></form>
            <form action={bookingAction.bind(null, b.project_id, "close")}><button className="btn btn-ghost btn-block">No thanks — close the request</button></form>
          </div>
          <HomeTabs current="project" />
        </Screen>
      );
    }
    return (
      <Screen>
        <AppBar brand />
        <div className="body">
          {switcher}
          <div className="kicker">Your project</div>
          <div className="hero">
            <h1>{pkg?.name}</h1>
            <p className="lead">{b.address?.split(",")[0]} · {dollars(b.price_cents)} · {b.config_label}</p>
          </div>
          {ok === "bump" && <div className="banner-ok">Reposted at {dollars(b.price_cents)}. The clock starts again.</div>}
          {ok === "wait" && <div className="banner-ok">Still posted at {dollars(b.price_cents)} for another 48 hours.</div>}
          {error && <Notice kind="error">{error}</Notice>}
          {photosCard}
          <WaitingCard postedAt={b.posted_at ?? b.created_at} offered={b.offered_count ?? 0} instant={pkg?.instant_book ?? true} />
          <NumberedNotes items={[
            <>{b.offered_count > 0 ? `${numberWord(b.offered_count)} licensed ${pluralTrade(pkg?.trade, b.offered_count)} in the community serve ${town}. Each sees your scope and photos, not your name.` : `Your scope and photos are ready for the community's ${pluralTrade(pkg?.trade, 2)} — none are signed in yet, so a person at Green Bergen is bringing one in.`}</>,
            <>They accept at {dollars(b.price_cents)} or pass. Nobody can counter-offer.</>,
            <>Nothing expires. If it stays quiet, you can repost it or change the package whenever you like.</>,
          ]} />
        </div>
        <div className="actions">
          <Link href={`/project/${b.project_id}/folder`} className="btn btn-secondary btn-block">Open the job folder</Link>
          <Link href={`/project/${b.project_id}/people`} className="btn btn-ghost btn-block">Who can see this job</Link>
          <form action={bookingAction.bind(null, b.project_id, "close")}><button className="btn btn-ghost btn-block">Cancel this request</button></form>
        </div>
        <HomeTabs current="project" />
      </Screen>
    );
  }

  // ---- 12 accepted / done ----------------------------------------------
  const cur = b.progress?.current ?? null;
  const c = b.contractor;
  const first = c?.person?.split(" ")[0] ?? "your contractor";
  const stageFor = (key: string) => b.progress.nodes.find((n) => n.key === key);
  const isDone = b.state === "done";
  return (
    <Screen>
      <AppBar brand />
      <div className="body">
        {switcher}
        <div className="kicker">Your project · {b.address?.split(",")[0]}</div>
        <div className="hero"><h1>{pkg?.name}</h1></div>
        {error && <Notice kind="error">{error}</Notice>}
        {photosCard}

        {c && (
          <Card pad={false}>
            <div className="person">
              <Avatar name={c.name} />
              <div className="grow">
                <div className="name">{c.name}</div>
                <div className="meta">Accepted {dayClock(b.accepted_at)}{c.license ? ` · Lic. #${c.license}` : ""}{c.insured ? " · Insured" : ""}</div>
              </div>
              {c.phone && <a className="btn btn-secondary btn-icon" href={`tel:${c.phone}`} aria-label={`Call ${first}`}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" /></svg>
              </a>}
            </div>
          </Card>
        )}

        <Card pad={false}>
          <ProgressLine progress={b.progress} />
          <p className="tiny text-muted" style={{ margin: "0 14px 10px" }}>Ranges are typical for {town}. They tighten as {first} logs progress.</p>
        </Card>

        {isDone ? (
          <Card pad>
            <div className="kicker">All done{paidSummary(b)}</div>
            <p style={{ margin: "6px 0" }}>{pkg?.milestones.find((m) => m.kind === "done")?.trigger_description}</p>
            <p className="small text-muted" style={{ margin: "0 0 10px" }}>Show the neighbors how it went. Your share carries an invite — and {c?.name ?? "your contractor"}&apos;s next job.</p>
            <Link href={`/project/${b.project_id}/share`} className="btn btn-primary btn-block">{b.share.shared_at ? "Shared — see the card" : "Share this project"}</Link>
            {pkg?.items.some((i) => /warranty/i.test(i.label)) && (
              <div className="kv" style={{ marginTop: 12 }}><span className="k">Warranty</span><span className="v">{pkg.items.find((i) => /warranty/i.test(i.label))?.detail ?? "named in your scope"} · in your folder</span></div>
            )}
          </Card>
        ) : cur ? (
          <NextUp booking={b} node={cur} first={first} />
        ) : null}

        {stageFor("permit_meeting")?.status === "done" && stageFor("permit_meeting")?.unsettled && (
          <Notice title="Permit meeting logged, payment not yet.">We&apos;ll remind you tomorrow. <Link href={`/project/${b.project_id}/milestone/permit_meeting`}>Record it now</Link>.</Notice>
        )}
      </div>
      <nav className="tabs" aria-label="Project sections">
        <Link href={`/project/${b.project_id}`} aria-current="page">Progress</Link>
        <Link href={`/project/${b.project_id}/timeline`}>Timeline{b.unread > 0 && <span className="n">{b.unread}</span>}</Link>
        <Link href={`/project/${b.project_id}/folder`}>Folder</Link>
        <Link href={`/project/${b.project_id}/people`}>People</Link>
      </nav>
    </Screen>
  );
}

function NextUp({ booking: b, node, first }: { booking: Booking; node: NonNullable<Booking["progress"]["current"]>; first: string }) {
  const who = node.kind === "payment" ? `you and ${first}` : node.kind === "task" ? first : "you";
  const amount = node.amount_cents ? dollars(node.amount_cents) : null;
  return (
    <Card pad>
      <div className="kicker">Next up · {who}</div>
      <div className="card-title" style={{ fontSize: 20, margin: "4px 0" }}>{node.name}</div>
      <p className="small" style={{ margin: "0 0 10px" }}>
        {node.trigger_description}
        {node.kind === "payment" && amount && <> <strong>{amount}</strong> is due to {first} — card, check or cash. Green Bergen never holds it.</>}
      </p>
      <div className="row" style={{ flexWrap: "wrap" }}>
        {node.kind === "payment" && <Link href={`/project/${b.project_id}/milestone/${node.key}`} className="btn btn-primary">{node.key === "permit_meeting" ? "We met — mark it done" : "It's done — mark it"}</Link>}
        {node.kind === "task" && <Link href={`/project/${b.project_id}/milestone/${node.key}`} className="btn btn-primary">Mark it done</Link>}
        {node.kind === "done" && <Link href={`/project/${b.project_id}/milestone/${node.key}`} className="btn btn-primary">{b.open_tasks.length ? `Wrap up (${b.open_tasks.length} open)` : "Close the job"}</Link>}
        {node.kind === "accepted" && <span className="small text-muted">Waiting on a contractor.</span>}
        <Link href={`/project/${b.project_id}/timeline`} className="btn btn-secondary">{node.kind === "payment" && node.key === "permit_meeting" ? "Propose a time" : "Message " + first}</Link>
      </div>
    </Card>
  );
}

const bump = (cents: number) => Math.ceil((cents * 1.09) / 1000) * 1000;
const numberWord = (n: number) => ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"][n] ?? String(n);
const pluralTrade = (trade: string | null | undefined, n: number) => {
  const one = { Plumbing: "plumber", Electrical: "electrician", Painting: "painter", Gutters: "gutter crew", Hardscaping: "paving contractor", Decks: "fence builder" }[trade ?? ""] ?? "contractor";
  return n === 1 ? one : one.endsWith("crew") ? one + "s" : one + "s";
};
const paidSummary = (b: Booking) => {
  const paid = b.stages.filter((s) => s.status === "Paid" || s.settlement_status === "paid").reduce((a, s) => a + s.amount_cents, 0);
  return paid > 0 ? ` · paid ${dollars(paid)}` : "";
};
