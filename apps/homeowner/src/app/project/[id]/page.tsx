import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getMe, TARGET_WINDOWS, targetWindowLabel } from "@/lib/me";
import { getBooking, ownerCents, type Booking } from "@/lib/booking";
import { getChecklist } from "@/lib/checklist";
import { customerPrice, encodeSelections, loadDiyList } from "@shared/catalogue";
import { ago, dayClock, dollars, shortDate } from "@shared/format";
import { AppBar, Avatar, Card, ChevronIcon, Notice, NumberedNotes, Screen, StatusHero } from "@shared/ui";
import { ProgressLine } from "@shared/ProgressLine";
import { stopwatch } from "@shared/perf";
import { PhotoRequest } from "@/components/PhotoRequest";
import { WaitingCard } from "./WaitingCard";
import { DiyChecklist } from "./DiyChecklist";
import { DiyListView, DiyPayCard } from "@/components/DiyListView";
import { bookingAction, buildChecklist, cancelProject, closeProject, reopenProject, updatePlan } from "./actions";
import { MarkOpened } from "@shared/MarkOpened";

export const dynamic = "force-dynamic";

// Screens 11 and 12: waiting (matching), no taker, closed, and the
// project view itself - one horizontal line, the contractor, what's next.
export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { id } = await params;
  const { error, ok } = await searchParams;
  const w = stopwatch("/project/[id]");
  // The shell and the job are independent reads; fetching them together
  // costs one round trip instead of two.
  const [me, { booking: b, missing }, checklist] = await Promise.all([
    w.step("me", () => getMe()),
    w.step("booking", () => getBooking(id)),
    w.step("checklist", () => getChecklist(id)),
  ]);
  w.done();
  if (!me.signed_in) redirect(`/login?next=/project/${id}`);
  if (missing) redirect("/project");
  if (!b) notFound();
  const pkg = b.package;
  // A job somebody simply started has no package to be named after, so it is
  // named after itself (migration 117).
  const title = pkg?.name ?? b.project_name ?? "This job";
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
    // A DIY plan no longer carries the contractor's scope (migration 241) -
    // it gets the package's DIY list. The list is a cached catalogue read.
    // A plan made before that may still have scope lines; they are the
    // fallback when a package has no list yet.
    const diy = b.package_code ? await loadDiyList(b.package_code) : null;
    const steps = b.scope.filter((s) => s.kind !== "assurance");
    // What turn-key adds is the package's, not this job's scope - the plan
    // has none to read it from any more.
    const covered = (pkg?.items ?? []).filter((it) => it.kind === "assurance").map((it) => ({ item: it.label, detail: it.detail }));
    return (
      <Screen>
        <AppBar back={{ fallback: "/projects" }} title={title} sub={b.address?.split(",")[0] ?? undefined} />
        <div className="body">
          {ok === "plan" && <div className="banner-ok">Plan updated.</div>}
          {ok === "step" && <div className="banner-ok">Ticked off.</div>}
          {ok === "checklist" && <div className="banner-ok">Your checklist is ready.</div>}
          {ok === "finished" && <div className="banner-ok">Closed as finished. The record is frozen.</div>}
          {ok === "cancelled" && <div className="banner-ok">Cancelled. Anything open on it went with it.</div>}
          {ok === "reopened" && <div className="banner-ok">Open again, and back on your list.</div>}
          {error && <Notice kind="error">{error}</Notice>}
          <StatusHero variant="neutral" kicker={`DIY · ${targetWindowLabel(b.target_window)}`} title={`Yours since ${shortDate(b.created_at)}. Nobody has been asked yet.`}>
            Do it at your pace, with the DIY list below — the price is your reference. Changed your mind? One tap makes it turn-key: it goes to the community&apos;s {pluralTrade(pkg?.trade, 2)} at that day&apos;s price, and photos and a budget come at that point.
          </StatusHero>
          <Card pad={false}>
            <div className="price">
              <div className="kicker">Community price today</div>
              <div className="big mono">{dollars(b.live_price_cents ?? b.price_cents)}{moved && <span className="was">{dollars(b.price_cents)}</span>}</div>
              <div className="delta">{b.config_label ?? pkg?.config_label ?? "most common setup"}{moved ? ` · was ${dollars(b.price_cents)} when you planned it` : " · unchanged since you planned it"}</div>
            </div>
          </Card>
          {b.note && <blockquote>{b.note}</blockquote>}
          {/* THE STEPS ARE TASKS NOW (migrations 195b / 196). They used to be
              scope lines rendered as a numbered list - "numbered, not ticked,
              because nothing is done yet" - which was true right up until
              taking a job DIY started generating real actions for it. A list
              you cannot tick is a poster; rulebook 42 is the whole argument,
              and the same one that says a scope line with no task is
              invisible. The numbered list is still the fallback for a job
              taken before the checklist existed.

              The two assurance lines (insurance, the warranty) stay out of
              both: they are what a contractor carries, and on a job you do
              yourself nobody carries them. */}
          {checklist && checklist.items.length > 0 ? (
            <DiyChecklist projectId={b.project_id} items={checklist.items} trade={pluralTrade(pkg?.trade, 2)} />
          ) : diy ? (
            <>
              <DiyListView list={diy} />
              {/* Planned before the list existed: build the tickable
                  version from it (homeowner_diy_checklist). */}
              <form action={buildChecklist}>
                <input type="hidden" name="project" value={b.project_id} />
                <button className="btn btn-secondary btn-block">Turn this into a checklist I can tick</button>
              </form>
            </>
          ) : steps.length > 0 ? (
            <Card pad>
              <div className="kicker">Suggested steps for the job</div>
              <ol className="steps" style={{ marginTop: 6 }}>
                {steps.map((si, i) => (
                  <li key={i}><span className="n">{i + 1}</span><span>{si.item}{si.detail && <span className="detail"> — {si.detail}</span>}</span></li>
                ))}
              </ol>
              <form action={buildChecklist} style={{ marginTop: 12 }}>
                <input type="hidden" name="project" value={b.project_id} />
                <button className="btn btn-secondary btn-block">Turn these into a checklist I can tick</button>
              </form>
            </Card>
          ) : null}
          {diy && <DiyPayCard list={diy} name={title} />}
          {covered.length > 0 && (
            <Card pad soft>
              <div className="kicker">What turn-key adds</div>
              <ul className="scope" style={{ marginTop: 4 }}>
                {covered.map((si, i) => <li key={i}><span className="ic">✓</span><span>{si.item}{si.detail && <span className="detail"> — {si.detail}</span>}</span></li>)}
              </ul>
              <p className="tiny text-muted" style={{ margin: "8px 0 0" }}>Doing it yourself, these are on you.</p>
            </Card>
          )}
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
      </Screen>
    );
  }

  // ---- 11c closed -------------------------------------------------------
  if (b.state === "closed") {
    return (
      <Screen>
        <AppBar brand back={{ fallback: "/projects" }} />
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
            <button className="btn btn-ghost btn-block">Reopen at {dollars(bump(b))}</button>
          </form>
        </div>
      </Screen>
    );
  }

  // ---- 11a / 11b matching -----------------------------------------------
  if (b.state === "posted") {
    if (b.no_taker) {
      const next = bump(b);
      return (
        <Screen>
          <AppBar brand back={{ fallback: "/projects" }} />
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
        </Screen>
      );
    }
    return (
      <Screen>
        <AppBar brand back={{ fallback: "/projects" }} />
        <div className="body">
          {switcher}
          <div className="kicker">Your project</div>
          <div className="hero">
            <h1>{title}</h1>
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
      {/* Remembered here and not on the early returns above: a project that
          could not be read is not a project you were in. */}
      <MarkOpened projectId={id} door="homeowner" />
      {/* EVERY BRANCH OF THIS SCREEN CARRIES THE ARROW (Shahar, 2026-09-20:
          "how do i go back? every page should a back button"). It used to be
          brand-only on four of the five states, so a person who opened a
          project had the wordmark and nothing else - and the wordmark goes
          home, not back. { fallback } rather than a fixed href because a
          project is reached from the home screen, from the list, and from a
          link somebody sent: the browser knows the way in, and the list is
          only the answer when there is no way in of ours behind this page. */}
      <AppBar brand back={{ fallback: "/projects" }} />
      <div className="body">
        {switcher}
        <div className="kicker">Your project · {b.address?.split(",")[0]}</div>
        <div className="hero"><h1>{title}</h1></div>
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
      {/* The job's other rooms, as rows - the bottom bar that pointed at
          them is gone from every screen (Shahar). */}
      <div className="body" style={{ paddingTop: 0 }}>
        <section className="stack" style={{ gap: 8 }}>
          <div className="divider-label">This job</div>
          <Link href={`/project/${b.project_id}/timeline`} className="home-row nav-row">
            <span className="grow"><span className="t">Timeline{b.unread > 0 && <span className="n">{b.unread}</span>}</span>
              <span className="m" style={{ display: "block" }}>The record between you and {first}</span></span>
            <ChevronIcon />
          </Link>
          <Link href={`/project/${b.project_id}/folder`} className="home-row nav-row">
            <span className="grow"><span className="t">Folder</span>
              <span className="m" style={{ display: "block" }}>Scope, photos, permits, payments</span></span>
            <ChevronIcon />
          </Link>
          <Link href={`/project/${b.project_id}/money`} className="home-row nav-row">
            <span className="grow"><span className="t">Money</span>
              <span className="m" style={{ display: "block" }}>What was agreed, what you paid, changes asked for</span></span>
            <ChevronIcon />
          </Link>
          <Link href={`/project/${b.project_id}/people`} className="home-row nav-row">
            <span className="grow"><span className="t">People</span>
              <span className="m" style={{ display: "block" }}>Who can see this job</span></span>
            <ChevronIcon />
          </Link>
        </section>

        {/* HOW IT ENDS, AND HOW TO UNDO THAT. Shahar (2026-09-14): "project
            owners should be able to re-open the project / saved by mistake"
            and "close projects". This door could close a booking REQUEST and
            never the job itself, so a project stayed In Progress for ever
            once the request was withdrawn. The rules are the database's. */}
        {b.is_owner && <Ending b={b} />}
      </div>
    </Screen>
  );
}

function NextUp({ booking: b, node, first }: { booking: Booking; node: NonNullable<Booking["progress"]["current"]>; first: string }) {
  const viaUs = b.collected_by === "green_bergen";
  const who = node.kind === "payment" ? (viaUs ? "you" : `you and ${first}`) : node.kind === "task" ? first : "you";
  // What the homeowner hands over at this milestone: its share of the price
  // they see (the stage amount is the contractor's), to whoever the job says
  // collects it - the job's frozen copy, not the package today (240, 242).
  const amount = node.amount_cents ? dollars(ownerCents(b, node.amount_cents)) : null;
  return (
    <Card pad>
      <div className="kicker">Next up · {who}</div>
      <div className="card-title" style={{ fontSize: 20, margin: "4px 0" }}>{node.name}</div>
      <p className="small" style={{ margin: "0 0 10px" }}>
        {node.trigger_description}
        {node.kind === "payment" && amount && (viaUs
          ? <> <strong>{amount}</strong> is due to Green Bergen upfront{node.due_on ? <>, by {shortDate(node.due_on)}</> : null}. Green Bergen pays {first} when they accept the job.</>
          : <> <strong>{amount}</strong> is due to {first}{node.due_on ? <> by {shortDate(node.due_on)}</> : null}.</>)}
      </p>
      <div className="row" style={{ flexWrap: "wrap" }}>
        {node.kind === "payment" && <Link href={`/project/${b.project_id}/milestone/${node.key}`} className="btn btn-primary">{viaUs ? "I've paid — record it" : node.key === "permit_meeting" ? "We met — mark it done" : "It's done — mark it"}</Link>}
        {node.kind === "task" && <Link href={`/project/${b.project_id}/milestone/${node.key}`} className="btn btn-primary">Mark it done</Link>}
        {node.kind === "done" && <Link href={`/project/${b.project_id}/milestone/${node.key}`} className="btn btn-primary">{b.open_tasks.length ? `Wrap up (${b.open_tasks.length} open)` : "Close the job"}</Link>}
        {node.kind === "accepted" && <span className="small text-muted">Waiting on a contractor.</span>}
        <Link href={`/project/${b.project_id}/timeline`} className="btn btn-secondary">{node.kind === "payment" && node.key === "permit_meeting" ? "Propose a time" : "Message " + first}</Link>
      </div>
    </Card>
  );
}

// A repost bumps the CONTRACTOR price (homeowner_booking_action); the
// owner sees that plus the mark-up frozen on the booking.
const bump = (b: Booking) => customerPrice(Math.ceil(((b.contractor_price_cents ?? b.price_cents) * 1.09) / 1000) * 1000, b.markup_pct) ?? 0;
const numberWord = (n: number) => ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"][n] ?? String(n);
const pluralTrade = (trade: string | null | undefined, n: number) => {
  const one = { Plumbing: "plumber", Electrical: "electrician", Painting: "painter", Gutters: "gutter crew", Hardscaping: "paving contractor", Decks: "fence builder" }[trade ?? ""] ?? "contractor";
  return n === 1 ? one : one.endsWith("crew") ? one + "s" : one + "s";
};
const paidSummary = (b: Booking) => {
  const paid = b.stages.filter((s) => s.status === "Paid" || s.settlement_status === "paid").reduce((a, s) => a + ownerCents(b, s.amount_cents), 0);
  return paid > 0 ? ` · paid ${dollars(paid)}` : "";
};

function Ending({ b }: { b: Booking }) {
  const closed = (b.project_status ?? "").startsWith("Closed");
  if (closed) {
    return (
      <section className="stack" style={{ gap: 8 }}>
        <div className="divider-label">This job is {b.project_status?.replace("Closed - ", "").toLowerCase()}</div>
        <details className="home-panel">
          <summary className="home-row">
            <span className="grow" style={{ minWidth: 0 }}>
              <span className="t">Open it again</span>
              <span className="m" style={{ display: "block" }}>Closed by mistake, or the work came back</span>
            </span>
            <ChevronIcon />
          </summary>
          <form action={reopenProject} className="drawer stack" style={{ gap: 8, paddingTop: 12 }}>
            <input type="hidden" name="project" value={b.project_id} />
            <p className="small text-muted" style={{ margin: 0 }}>
              It goes back on your list and anything written against the close stays where it is.
            </p>
            <label className="field" style={{ marginBottom: 0 }}>
              <span className="field-label">Why it is opening again <span className="text-muted">(optional)</span></span>
              <input className="input" name="reason" placeholder="Closed it by mistake · the shade stuck again" />
            </label>
            <button className="btn btn-secondary btn-block">Open this job again</button>
          </form>
        </details>
      </section>
    );
  }
  return (
    <section className="stack" style={{ gap: 8 }}>
      <div className="divider-label">Ending it</div>
      <details className="home-panel">
        <summary className="home-row">
          <span className="grow" style={{ minWidth: 0 }}>
            <span className="t">It is finished</span>
            <span className="m" style={{ display: "block" }}>
              {b.open_tasks.length > 0
                ? `${b.open_tasks.length} ${b.open_tasks.length === 1 ? "thing is" : "things are"} still open`
                : "Nothing is open — it can close as finished"}
            </span>
          </span>
          <ChevronIcon />
        </summary>
        <div className="drawer stack" style={{ gap: 8, paddingTop: 12 }}>
          {b.open_tasks.length > 0 ? (
            <p className="small text-muted" style={{ margin: 0 }}>
              A job closes as finished only when there is nothing left on it. Tick those off, or
              cancel it below instead.
            </p>
          ) : (
            <form action={closeProject} className="stack" style={{ gap: 8 }}>
              <input type="hidden" name="project" value={b.project_id} />
              <p className="small text-muted" style={{ margin: 0 }}>
                The record freezes — the timeline, the folder and the money stay readable and stop
                taking new entries.
              </p>
              <label className="field" style={{ marginBottom: 0 }}>
                <span className="field-label">How it went <span className="text-muted">(optional)</span></span>
                <input className="input" name="note" placeholder="Shade fixed and tested, all good" />
              </label>
              <button className="btn btn-primary btn-block">Close it as finished</button>
            </form>
          )}
        </div>
      </details>

      <details className="home-panel">
        <summary className="home-row">
          <span className="grow" style={{ minWidth: 0 }}>
            <span className="t">It is not happening</span>
            <span className="m" style={{ display: "block" }}>
              Cancels the job and{b.open_tasks.length > 0 ? ` the ${b.open_tasks.length} open on it` : " anything open"}
            </span>
          </span>
          <ChevronIcon />
        </summary>
        <form action={cancelProject} className="drawer stack" style={{ gap: 8, paddingTop: 12 }}>
          <input type="hidden" name="project" value={b.project_id} />
          <p className="small text-muted" style={{ margin: 0 }}>
            Your reason is written onto the job and onto everything cancelled with it. You can open
            it again afterwards.
          </p>
          <label className="field" style={{ marginBottom: 0 }}>
            <span className="field-label">Why it is not happening</span>
            <input className="input" name="reason" required minLength={4}
              placeholder="Changed our mind · doing it ourselves · duplicate" />
          </label>
          <button className="btn btn-secondary btn-block">Cancel this job</button>
        </form>
      </details>
    </section>
  );
}
