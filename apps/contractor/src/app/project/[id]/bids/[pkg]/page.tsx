import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";
import { shortDate } from "@shared/format";
import { stopwatch } from "@shared/perf";
import { AppBar, Card, Notice, Screen } from "@shared/ui";
import { money } from "@/lib/board";
import { recordReply, negotiate, award, invite, addToRoom, setScope, markLost, markLinkSent } from "./actions";
import { BidLink } from "@/components/BidLink";

export const dynamic = "force-dynamic";

// ONE BID PACKAGE, from the site (Shahar, 2026-09-11: "bid does not allow me
// to click in"). The portal has a desk-sized version of this screen with the
// full terms sheet, the comparison grid and the AI review; this is the half
// that happens standing in a driveway:
//
//   what did we ask for   - the scope lines, required ones marked
//   who is on it          - every bidder, their number, how far it got
//   write down his number - after the walk, before you forget it
//   ask him again         - the two rounds the rule demands (help:
//                           contractors), recorded as rounds, not as a
//                           quietly overwritten number
//   award it              - only once a number is in and asked twice
//
// Everything is portal_bid_package, one read; every write is a database
// function that owns its own rule.
type Item = { id: string; scope_item_id: string; item: string; category: string | null; is_required: boolean; sort: number };
type Doc = { id: string; file_name: string; kind: string | null; bucket: string; path: string };
type Bid = {
  id: string; bidder: string | null; person: string | null; bidder_contact_id: string; status: string;
  amount: number | null; received_on: string | null; valid_until: string | null;
  is_like_for_like: boolean | null; scope_gaps: string | null;
  round: number; rounds_run: number; notes: string | null;
  // PATH 2 (migration 184): his own link, which prices the job with no
  // account. Minted for every bid at birth; the token reaches only somebody
  // who may run the bid.
  link_token: string | null; link_sent_at: string | null; link_opened_at: string | null;
  link_revoked: boolean; link_phone: string | null; link_email: string | null; link_message: string | null;
};
type Member = { contact_id: string; name: string; trade: string | null };
// The comparison (portal_bid_compare): the scope lines are the rows, the
// bidders are the columns, and a cell says whether that line is in his price.
// The database does the arithmetic - what a missing line costs is what the
// others charge for it, so "normalised" is the number to compare.
type Cell = { bid_id: string; included: boolean; price: number | null };
type CmpItem = { scope_item_id: string; item: string; is_required: boolean; cells: Cell[] | null };
type CmpBid = {
  id: string; bidder: string | null; person: string | null; status: string;
  amount: number | null; gaps: number; gap_cost: number; normalized: number;
  terms_ok: boolean; insurance_ok: boolean;
};
type Cmp = { items: CmpItem[]; bids: CmpBid[] };
type Pkg = {
  id: string; project_id: string; project_name: string | null;
  phase: string | null; category: string | null; trade: string | null; scope_summary: string | null;
  budget_amount: number | null; budget_visible: boolean;
  deposit_pct: number | null; retainage_pct: number | null; net_days: number | null;
  insurance_workers_comp: boolean | null; coi_required: boolean | null;
  reply_by: string | null; status: string; awarded_bid_id: string | null; can_edit: boolean;
  items: Item[]; docs: Doc[]; bids: Bid[]; members: Member[];
};

// A reply that is in, whatever stage it reached.
const REPLIED = ["received", "under negotiation", "awarded", "not awarded"];
const tone = (s: string) =>
  s === "awarded" ? "tag-ok"
  : s === "received" || s === "under negotiation" ? "tag-outline"
  : s === "not awarded" || s === "declined" || s === "withdrawn" || s === "expired" ? "tag-neutral"
  : "tag-neutral";

export default async function BidPackagePage({
  params, searchParams,
}: {
  params: Promise<{ id: string; pkg: string }>;
  searchParams: Promise<{ ok?: string; error?: string; open?: string; held?: string }>;
}) {
  const { id, pkg: pkgId } = await params;
  const { ok, error, open, held } = await searchParams;
  const w = stopwatch("/project/[id]/bids/[pkg]");
  const supabase = await createClient();

  const { data: claims } = await w.step("claims", () => supabase.auth.getClaims());
  if (!claims?.claims?.sub) redirect(`/login?next=${encodeURIComponent(`/project/${id}/bids/${pkgId}`)}`);

  const [{ data }, { data: cmpData }] = await Promise.all([
    w.step("package", () => rpc<Pkg>(supabase, "portal_bid_package", { p_pkg: pkgId })),
    w.step("compare", () => rpc<Cmp>(supabase, "portal_bid_compare", { p_pkg: pkgId })),
  ]);
  const p = (data ?? null) as Pkg | null;
  // A ROOM IS OPENED FROM WHEREVER YOU ARE STANDING. This used to demand
  // p.project_id === id and 404ed on the true case: the bid board opened on
  // 55 Walnut Drive (the house) lists the rooms of the New build beneath it,
  // because portal_bid_board reads the whole family - so every link out of it
  // named the house and every room belonged to the job. Membership already
  // reaches downward through projects.parent_project_id, and
  // portal_bid_package returns nothing at all to somebody who is not a member
  // of the package's own project, so the function is the boundary and the
  // path is just a path. Requiring them to be the same project was a guess
  // about where you would be, not a rule.
  if (!p) notFound();
  const cmp = (cmpData ?? null) as Cmp | null;

  // Plans and photos bidders price from, each behind a signed URL.
  const docUrls = new Map<string, string>();
  if (p.docs.length > 0) {
    const { data: signed } = await w.step("docs", () =>
      supabase.storage.from("project-media").createSignedUrls(p.docs.map((d) => d.path), 3600));
    for (const row of signed ?? []) if (row.path && row.signedUrl) docUrls.set(row.path, row.signedUrl);
  }
  w.done();

  const replied = p.bids.filter((b) => REPLIED.includes(b.status));
  const required = p.items.filter((i) => i.is_required);
  const itemIds = p.items.map((i) => i.scope_item_id).join(",");
  const uninvited = p.members.filter((m) => !p.bids.some((b) => b.bidder_contact_id === m.contact_id));
  const closed = p.status === "closed" || !!p.awarded_bid_id;
  const canWrite = p.can_edit && !closed;
  const lowest = replied.reduce<number | null>((n, b) => (b.amount != null && (n == null || b.amount < n) ? b.amount : n), null);
  // The cheapest LIKE FOR LIKE, which is not the cheapest number: a man who
  // left half the job out is cheap until you price what he left out. A bid
  // with no number at all is not in the running for it.
  const best = (cmp?.bids ?? [])
    .filter((b) => b.amount != null)
    .reduce<CmpBid | null>((w, b) => (w == null || b.normalized < w.normalized ? b : w), null)?.id ?? null;

  return (
    <Screen>
      {/* Back to the board, because that is where you came from. The sub line
          names the job the room belongs to, which is not always the project
          in the path. */}
      <AppBar back={`/project/${id}/bids`} title={p.category ?? p.trade ?? "Bid package"}
        sub={[p.project_name, p.phase].filter(Boolean).join(" · ") || undefined} />
      <div className="body">
        {error && <Notice kind="error">{error}</Notice>}
        {ok === "reply" && <div className="banner-ok">Number recorded. Ask him if that is his best before you award anything.</div>}
        {ok === "gaps" && <div className="banner-ok">Number recorded — and it does not cover every required line. The gaps are listed under his name.</div>}
        {ok === "round" && <div className="banner-ok">Round recorded.</div>}
        {ok === "award" && <div className="banner-ok">Awarded. The package is closed and the others are marked.</div>}
        {ok === "invited" && <div className="banner-ok">Invited.</div>}
        {ok === "added" && <div className="banner-ok">In the room. Write his number down when it comes in.</div>}
        {ok === "already" && <div className="banner-ok">That firm was already in this room — nothing doubled up.</div>}
        {ok === "opened" && <div className="banner-ok">Room opened. Put somebody in it.</div>}
        {ok === "existed" && <div className="banner-ok">This room was already open.</div>}
        {ok === "scope" && (
          <div className="banner-ok">
            Scope saved. Those lines are what every bid is judged against.
            {held && ` Kept anyway, because somebody already priced them: ${held}.`}
          </div>
        )}
        {ok === "lost" && <div className="banner-ok">Closed as lost. Nobody was awarded.</div>}

        <div className="kicker">
          <span className={`tag ${p.status === "open" ? "tag-accent" : tone(p.status)}`}>{p.status}</span>
          {p.reply_by ? ` · reply by ${shortDate(p.reply_by)}` : ""}
          {p.trade && p.trade !== p.category ? ` · ${p.trade}` : ""}
        </div>

        <div className="tiles quad" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
          <Stat n={String(p.bids.length)} label="invited" />
          <Stat n={String(replied.length)} label="replied" />
          <Stat n={money(lowest) ?? "—"} label="lowest in" />
        </div>

        {/* The target, when the person looking is allowed to see money. */}
        {p.budget_amount != null && (
          <Card soft pad>
            <div className="between">
              <span className="small">Target for this package</span>
              <strong>{money(p.budget_amount)}</strong>
            </div>
            <div className="tiny text-muted" style={{ marginTop: 4 }}>
              {p.budget_visible ? "Bidders can see this number." : "Yours only — bidders do not see it."}
            </div>
          </Card>
        )}

        {/* SIDE BY SIDE. Shahar (2026-09-17): "a quick way to compare them
            one to another. Table, showing cost, and things included or
            missing." The rows are the scope lines, the columns are the
            bidders, cheapest normalised first. Normalised is the honest
            comparison: his number plus what the lines he left out cost,
            priced at what the others charge for them. */}
        {cmp && cmp.bids.length > 0 && (
          <section className="stack" style={{ gap: 8 }}>
            <div className="divider-label">Side by side · {cmp.bids.length} price{cmp.bids.length === 1 ? "" : "s"}</div>
            <div className="cmp-scroll">
              <table className="cmp">
                <thead>
                  <tr>
                    <th className="cmp-lbl" scope="col">Line</th>
                    {cmp.bids.map((b) => (
                      <th key={b.id} scope="col">
                        <span className="who">{b.bidder ?? "—"}</span>
                        {b.person && b.person !== b.bidder && <span className="sub">{b.person}</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cmp.items.map((it) => (
                    <tr key={it.scope_item_id}>
                      <th className="cmp-lbl" scope="row">
                        {it.item}
                        {!it.is_required && <span className="sub">optional</span>}
                      </th>
                      {cmp.bids.map((b) => {
                        const c = (it.cells ?? []).find((x) => x.bid_id === b.id);
                        const inc = c?.included ?? false;
                        return (
                          <td key={b.id} className={inc ? "yes" : it.is_required ? "no" : "meh"}>
                            <span aria-hidden>{inc ? "✓" : "✕"}</span>
                            <span className="sr-only">{inc ? "included" : "not included"}</span>
                            {inc && c?.price != null && <span className="sub">{money(c.price)}</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th className="cmp-lbl" scope="row">His number</th>
                    {cmp.bids.map((b) => (
                      <td key={b.id} className="fig">{b.amount != null ? money(b.amount) : "—"}</td>
                    ))}
                  </tr>
                  {/* With no scope lines there is nothing to be missing, and
                      "like for like" would only repeat his number. */}
                  {cmp.items.length > 0 && (
                    <>
                      <tr>
                        <th className="cmp-lbl" scope="row">Missing</th>
                        {cmp.bids.map((b) => (
                          <td key={b.id} className={b.gaps > 0 ? "no" : "yes"}>
                            {b.gaps === 0 ? "nothing" : `${b.gaps} line${b.gaps === 1 ? "" : "s"}`}
                            {b.gaps > 0 && b.gap_cost > 0 && <span className="sub">+{money(b.gap_cost)}</span>}
                          </td>
                        ))}
                      </tr>
                      <tr className="tot">
                        <th className="cmp-lbl" scope="row">Like for like</th>
                        {cmp.bids.map((b) => (
                          <td key={b.id} className={b.id === best ? "fig best" : "fig"}>
                            {b.amount == null ? "—" : money(b.normalized)}
                          </td>
                        ))}
                      </tr>
                    </>
                  )}
                </tfoot>
              </table>
            </div>
            <p className="tiny text-muted" style={{ margin: 0 }}>
              {cmp.items.length === 0
                ? "No scope lines yet, so these are bare numbers — each man priced whatever he thought you meant. Write the scope below and the table fills in line by line."
                : <><strong>Like for like</strong> is his number plus what the lines he left out cost — priced at what the others charge for them. It is the only column worth comparing straight across.</>}
            </p>
          </section>
        )}

        {/* WHAT WAS ASKED FOR. A bidder prices these lines; a reply that
            leaves a required one out is a gap, and the database says so. */}
        <section className="stack" style={{ gap: 8 }}>
          <div className="divider-label">
            Scope · {p.items.length} line{p.items.length === 1 ? "" : "s"}{required.length > 0 ? ` · ${required.length} required` : ""}
          </div>
          {p.scope_summary && <Card soft pad><div className="small">{p.scope_summary}</div></Card>}
          {p.items.length === 0 && !canWrite && (
            <Card soft pad><div className="small">No scope lines on this package yet.</div></Card>
          )}
          {p.items.map((i) => (
            <div className="home-row" key={i.id} style={{ cursor: "default", alignItems: "flex-start" }}>
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="t" style={{ fontWeight: 600 }}>{i.item}</span>
                {i.category && <span className="m" style={{ display: "block" }}>{i.category}</span>}
              </span>
              {i.is_required && <span className="tag tag-outline" style={{ whiteSpace: "nowrap" }}>required</span>}
            </div>
          ))}

          {/* THE SCOPE IS WRITTEN IN THE ROOM (Shahar's choice, 2026-09-17).
              One line per line. These lines are the project's scope for the
              trade, not a copy of it, and they are the rows of the table
              above - so what you type here is what every bid is judged
              against. Saving the box back is safe: a line already written is
              matched, never written twice. */}
          {canWrite && (
            <details className="card pad" open={p.items.length === 0}>
              <summary className="small" style={{ cursor: "pointer", fontWeight: 700 }}>
                {p.items.length === 0 ? "Write the scope" : "Change the scope"}
              </summary>
              <form action={setScope.bind(null, id, pkgId)} className="stack" style={{ gap: 8, marginTop: 10 }}>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="scope-lines">One line per line</label>
                  <textarea id="scope-lines" name="lines" className="input" rows={Math.max(6, p.items.length + 2)}
                    defaultValue={p.items.map((i) => i.item).join("\n")}
                    placeholder={"Tear off to deck\nIce and water at eaves and valleys\nArchitectural shingles, 30 year\nDrip edge all around\nHaul away and dumpster"} />
                </div>
                <button className="btn btn-secondary btn-block">Save the scope</button>
                <p className="tiny text-muted" style={{ margin: 0 }}>
                  Every line counts as required. Taking a line out of the box leaves it on the job — it only
                  stops being one of the rows here.
                </p>
              </form>
            </details>
          )}
        </section>

        {/* Terms worth knowing on site, when they are set. */}
        {(p.deposit_pct != null || p.retainage_pct != null || p.net_days != null || p.insurance_workers_comp || p.coi_required) && (
          <Card soft pad>
            <div className="small" style={{ fontWeight: 700, marginBottom: 4 }}>Terms</div>
            <div className="tiny text-muted">
              {[
                p.deposit_pct != null ? `${p.deposit_pct}% deposit` : null,
                p.retainage_pct != null ? `${p.retainage_pct}% retainage` : null,
                p.net_days != null ? `net ${p.net_days}` : null,
                p.insurance_workers_comp ? "workers' comp required" : null,
                p.coi_required ? "COI naming you" : null,
              ].filter(Boolean).join(" · ")}
            </div>
          </Card>
        )}

        {p.docs.length > 0 && (
          <section className="stack" style={{ gap: 8 }}>
            <div className="divider-label">Documents · {p.docs.length}</div>
            {p.docs.map((d) => {
              const u = docUrls.get(d.path);
              return u ? (
                <a key={d.id} className="home-row" href={u} target="_blank" rel="noreferrer">
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="t">{d.kind === "photo" ? "🖼 " : "📄 "}{d.file_name}</span>
                  </span>
                </a>
              ) : (
                <div className="home-row" key={d.id} style={{ cursor: "default" }}><span className="t">{d.file_name}</span></div>
              );
            })}
          </section>
        )}

        {/* THE BIDDERS. One card each: where they got to, and the two things
            you do to them - write the number down, then ask again. */}
        <section className="stack" style={{ gap: 10 }}>
          <div className="divider-label">Bidders · {p.bids.length}</div>
          {p.bids.length === 0 && (
            <Card soft pad>
              <div className="small">Nobody in the room yet.</div>
              <div className="tiny text-muted" style={{ marginTop: 4 }}>
                Put the man you met this morning in it — his firm and his name are enough.
              </div>
            </Card>
          )}
          {p.bids.map((b) => {
            const isAwarded = b.id === p.awarded_bid_id;
            const hasNumber = b.amount != null;
            const canAward = canWrite && REPLIED.includes(b.status) && b.status !== "not awarded";
            const sheet = open === b.id;
            return (
              <Card pad key={b.id}>
                <div className="between" style={{ alignItems: "flex-start" }}>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="card-title" style={{ fontSize: 15 }}>{b.bidder ?? "—"}</div>
                    {b.person && b.person !== b.bidder && <div className="tiny text-muted">{b.person}</div>}
                    <div className="small text-muted">
                      {[
                        hasNumber ? money(b.amount) : "no number yet",
                        b.received_on ? `in ${shortDate(b.received_on)}` : null,
                        b.rounds_run > 0 ? `${b.rounds_run} round${b.rounds_run === 1 ? "" : "s"} run` : null,
                      ].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <span className={`tag ${tone(b.status)}`} style={{ whiteSpace: "nowrap" }}>{isAwarded ? "awarded" : b.status}</span>
                </div>

                {b.is_like_for_like === false && b.scope_gaps && (
                  <div className="tiny" style={{ color: "var(--color-danger)", marginTop: 6 }}>
                    Not like for like — missing: {b.scope_gaps}
                  </div>
                )}
                {hasNumber && b.rounds_run < 2 && !isAwarded && (
                  <div className="tiny text-muted" style={{ marginTop: 6 }}>
                    {b.rounds_run === 0
                      ? "Not negotiated yet. Round one is the open ask: is that the best you can do?"
                      : "One round run. Round two is best and final, against a number."}
                  </div>
                )}
                {b.notes && (
                  <details style={{ marginTop: 8 }}>
                    <summary className="tiny text-muted" style={{ cursor: "pointer" }}>What was said</summary>
                    <div className="tiny" style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{b.notes}</div>
                  </details>
                )}

                {/* PATH 2: his own link. It sits above the two buttons
                    because sending it is what you do FIRST - writing his
                    number down yourself (path 1) is what you do when he rings
                    instead of tapping. A settled bid needs neither. */}
                {canWrite && b.link_token && !b.link_revoked && !isAwarded && b.status !== "not awarded" && (
                  <BidLink token={b.link_token} who={b.bidder} phone={b.link_phone} email={b.link_email}
                    message={b.link_message ?? "Here is the scope. You can put your price straight in, no login needed."}
                    sentAt={b.link_sent_at} openedAt={b.link_opened_at}
                    onSent={markLinkSent.bind(null, id, pkgId, b.id)} />
                )}

                {canWrite && (
                  <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                    {!sheet && (
                      <Link href={`/project/${id}/bids/${pkgId}?open=${b.id}#${b.id}`} className="btn btn-secondary small" scroll={false}>
                        {hasNumber ? "Update his number" : "Write down his number"}
                      </Link>
                    )}
                    {sheet && (
                      <Link href={`/project/${id}/bids/${pkgId}`} className="btn btn-ghost small">Close</Link>
                    )}
                  </div>
                )}

                {/* Taking the number down, and running a round - both open in
                    place so a thumb never leaves the card. */}
                {canWrite && sheet && (
                  <div id={b.id} className="stack" style={{ gap: 14, marginTop: 12 }}>
                    <form action={recordReply.bind(null, id, pkgId, b.id)} className="stack" style={{ gap: 8 }}>
                      <input type="hidden" name="items" value={itemIds} />
                      <div className="small" style={{ fontWeight: 700 }}>His number</div>
                      <div className="row" style={{ gap: 8 }}>
                        <div className="field grow" style={{ marginBottom: 0 }}>
                          <label htmlFor={`amt-${b.id}`}>Amount ($)</label>
                          <input id={`amt-${b.id}`} name="amount" className="input" inputMode="decimal"
                            defaultValue={b.amount != null ? String(Math.round(b.amount)) : ""} placeholder="14,000" />
                        </div>
                        <div className="field grow" style={{ marginBottom: 0 }}>
                          <label htmlFor={`val-${b.id}`}>Good until</label>
                          <input id={`val-${b.id}`} name="valid_until" type="date" className="input" defaultValue={b.valid_until ?? ""} />
                        </div>
                      </div>
                      {p.items.length > 0 && (
                        <details>
                          <summary className="tiny text-muted" style={{ cursor: "pointer" }}>
                            What his price covers — everything, unless you say otherwise
                          </summary>
                          <div className="stack" style={{ gap: 6, marginTop: 8 }}>
                            {p.items.map((i) => (
                              <label key={i.id} className="row small" style={{ gap: 8, alignItems: "flex-start" }}>
                                <input type="checkbox" name={`inc_${i.scope_item_id}`} defaultChecked style={{ marginTop: 3 }} />
                                <span className="grow" style={{ minWidth: 0 }}>
                                  {i.item}{i.is_required ? "" : " (optional)"}
                                </span>
                              </label>
                            ))}
                          </div>
                        </details>
                      )}
                      <div className="field" style={{ marginBottom: 0 }}>
                        <label htmlFor={`note-${b.id}`}>What he said</label>
                        <input id={`note-${b.id}`} name="notes" className="input" placeholder="Optional — anything worth remembering" />
                      </div>
                      <button className="btn btn-primary btn-block">Save his number</button>
                    </form>

                    {hasNumber && (
                      <form action={negotiate.bind(null, id, pkgId, b.id)} className="stack" style={{ gap: 8 }}>
                        <div className="small" style={{ fontWeight: 700 }}>
                          Round {b.rounds_run + 1} — {b.rounds_run === 0 ? "the open ask" : b.rounds_run === 1 ? "best and final" : "another conversation"}
                        </div>
                        <div className="tiny text-muted">
                          {b.rounds_run === 0
                            ? "Ask plainly: is that the best you can do? Nothing more. Leave the amount empty if he held his price."
                            : "Tell him the gap in dollars and ask for his best and final."}
                        </div>
                        <div className="row" style={{ gap: 8 }}>
                          <div className="field grow" style={{ marginBottom: 0 }}>
                            <label htmlFor={`nam-${b.id}`}>New number ($), if it moved</label>
                            <input id={`nam-${b.id}`} name="amount" className="input" inputMode="decimal" placeholder="Leave empty if unchanged" />
                          </div>
                        </div>
                        <div className="field" style={{ marginBottom: 0 }}>
                          <label htmlFor={`nnote-${b.id}`}>How it went</label>
                          <input id={`nnote-${b.id}`} name="note" className="input" placeholder="Optional" />
                        </div>
                        <button className="btn btn-secondary btn-block">Record round {b.rounds_run + 1}</button>
                      </form>
                    )}

                    {canAward && (
                      <form action={award.bind(null, id, pkgId, b.id)} className="stack" style={{ gap: 8 }}>
                        <div className="small" style={{ fontWeight: 700 }}>Award the job to {b.bidder ?? "him"}</div>
                        {b.rounds_run < 2 && (
                          <div className="tiny" style={{ color: "var(--color-status)" }}>
                            Only {b.rounds_run} of the two rounds has been run. Every bid gets asked twice before it is awarded — the downside is zero.
                          </div>
                        )}
                        <div className="field" style={{ marginBottom: 0 }}>
                          <label htmlFor={`why-${b.id}`}>Why him</label>
                          <input id={`why-${b.id}`} name="reason" className="input" placeholder="Recorded against the bid" />
                        </div>
                        <button className="btn btn-secondary btn-block">Award this package</button>
                      </form>
                    )}

                    {/* OUT, WITHOUT ANYBODY WINNING. Shahar, on HVAC:
                        "Jacob / Mario is closed as lost on the bidding." A
                        bidder drops out, or never comes back with a number,
                        long before the winner is picked. */}
                    {b.status !== "not awarded" && !isAwarded && (
                      <form action={markLost.bind(null, id, pkgId, b.id)} className="stack" style={{ gap: 8 }}>
                        <div className="small" style={{ fontWeight: 700 }}>Or close {b.bidder ?? "him"} as lost</div>
                        <div className="field" style={{ marginBottom: 0 }}>
                          <label htmlFor={`lost-${b.id}`}>Why he is out</label>
                          <input id={`lost-${b.id}`} name="reason" className="input" placeholder="Optional — never came back, too high, went quiet" />
                        </div>
                        <button className="btn btn-ghost btn-block">Close as lost</button>
                      </form>
                    )}
                  </div>
                )}
              </Card>
            );
          })}

          {/* ANYBODY, NOT JUST SOMEBODY ALREADY ON THE JOB. Shahar met Diego
              about roofing this morning: Diego is in nothing, his firm is in
              nothing, and going to a contacts screen first is a step nobody
              takes in a driveway. Company first, person named - the database
              creates whichever half is new, joins a second man from the same
              firm to the row already there, and remembers the trade against
              him for next time. */}
          {canWrite && (
            <details className="card pad" open={p.bids.length === 0}>
              <summary className="small" style={{ cursor: "pointer", fontWeight: 700 }}>Put somebody in the room</summary>
              <form action={addToRoom.bind(null, id, pkgId)} className="stack" style={{ gap: 8, marginTop: 10 }}>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="co">Company</label>
                  <input id="co" name="company_name" className="input" placeholder="Bergen Roofing" />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="pn">Who you spoke to</label>
                  <input id="pn" name="person_name" className="input" placeholder="Diego" />
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <div className="field grow" style={{ marginBottom: 0 }}>
                    <label htmlFor="ph">Phone</label>
                    <input id="ph" name="phone" className="input" inputMode="tel" placeholder="201-555-0134" />
                  </div>
                  <div className="field grow" style={{ marginBottom: 0 }}>
                    <label htmlFor="em">Email</label>
                    <input id="em" name="email" className="input" inputMode="email" placeholder="Optional" />
                  </div>
                </div>
                <button className="btn btn-primary btn-block">Put them in the room</button>
                <p className="tiny text-muted" style={{ margin: 0 }}>
                  Either half will do — a firm on its own, or a name and a number. A second man from a firm
                  already in here joins that row rather than opening a second price.
                </p>
              </form>
            </details>
          )}
        </section>

        {/* One more person on the package. They must already be on the
            project — the portal's Invite is where someone new gets a seat. */}
        {canWrite && uninvited.length > 0 && (
          <details className="card pad">
            <summary className="small" style={{ cursor: "pointer", fontWeight: 700 }}>Invite someone else on this project</summary>
            <form action={invite.bind(null, id, pkgId)} className="stack" style={{ gap: 8, marginTop: 10 }}>
              {uninvited.map((m) => (
                <label key={m.contact_id} className="row small" style={{ gap: 8, alignItems: "center" }}>
                  <input type="checkbox" name="contact" value={m.contact_id}
                    defaultChecked={!!p.trade && !!m.trade && m.trade.toLowerCase() === p.trade.toLowerCase()} />
                  <span className="grow" style={{ minWidth: 0 }}>{m.name}</span>
                  <span className="tiny text-muted">{m.trade ?? "—"}</span>
                </label>
              ))}
              <button className="btn btn-secondary btn-block">Invite them</button>
            </form>
          </details>
        )}

        {closed && (
          <Notice title="This package is closed.">
            {p.awarded_bid_id
              ? "It is awarded. The contract and its payment schedule live on the money page."
              : "Reopen it from the portal if replies should come back in."}
          </Notice>
        )}

        <p className="tiny text-muted" style={{ margin: 0 }}>
          Invited trades see the <strong>town</strong> until the job is awarded to them.
          Awarding closes the room, marks the rest, and puts the winner on the job — nobody else joins it.
          The full terms sheet and the AI review are on the desk version of this package.
        </p>
      </div>
    </Screen>
  );
}

function Stat({ n, label }: { n: string; label: string }) {
  return (
    <div className="tile" style={{ minHeight: 0, alignItems: "flex-start", textAlign: "left", gap: 2, padding: "12px 12px 10px" }}>
      <div className="mono" style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 22 }}>{n}</div>
      <div className="tiny text-muted">{label}</div>
    </div>
  );
}
