import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";
import { shortDate } from "@shared/format";
import { stopwatch } from "@shared/perf";
import { AppBar, Card, Notice, Screen } from "@shared/ui";
import { money } from "@/lib/board";
import { recordReply, negotiate, award, invite } from "./actions";

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
  id: string; bidder: string | null; bidder_contact_id: string; status: string;
  amount: number | null; received_on: string | null; valid_until: string | null;
  is_like_for_like: boolean | null; scope_gaps: string | null;
  round: number; rounds_run: number; notes: string | null;
};
type Member = { contact_id: string; name: string; trade: string | null };
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
  searchParams: Promise<{ ok?: string; error?: string; open?: string }>;
}) {
  const { id, pkg: pkgId } = await params;
  const { ok, error, open } = await searchParams;
  const w = stopwatch("/project/[id]/bids/[pkg]");
  const supabase = await createClient();

  const { data: claims } = await w.step("claims", () => supabase.auth.getClaims());
  if (!claims?.claims?.sub) redirect(`/login?next=${encodeURIComponent(`/project/${id}/bids/${pkgId}`)}`);

  const { data } = await w.step("package", () => rpc<Pkg>(supabase, "portal_bid_package", { p_pkg: pkgId }));
  const p = (data ?? null) as Pkg | null;
  if (!p || p.project_id !== id) notFound();

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

  return (
    <Screen>
      <AppBar back={`/project/${id}`} title={p.category ?? p.trade ?? "Bid package"}
        sub={[p.project_name, p.phase].filter(Boolean).join(" · ") || undefined} />
      <div className="body">
        {error && <Notice kind="error">{error}</Notice>}
        {ok === "reply" && <div className="banner-ok">Number recorded. Ask him if that is his best before you award anything.</div>}
        {ok === "gaps" && <div className="banner-ok">Number recorded — and it does not cover every required line. The gaps are listed under his name.</div>}
        {ok === "round" && <div className="banner-ok">Round recorded.</div>}
        {ok === "award" && <div className="banner-ok">Awarded. The package is closed and the others are marked.</div>}
        {ok === "invited" && <div className="banner-ok">Invited.</div>}

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

        {/* WHAT WAS ASKED FOR. A bidder prices these lines; a reply that
            leaves a required one out is a gap, and the database says so. */}
        <section className="stack" style={{ gap: 8 }}>
          <div className="divider-label">
            Scope · {p.items.length} line{p.items.length === 1 ? "" : "s"}{required.length > 0 ? ` · ${required.length} required` : ""}
          </div>
          {p.scope_summary && <Card soft pad><div className="small">{p.scope_summary}</div></Card>}
          {p.items.length === 0 && (
            <Card soft pad><div className="small">No scope lines on this package yet. Write the scope for this trade on the project, then add the lines from the portal.</div></Card>
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
            <Card soft pad><div className="small">Nobody invited yet.</div></Card>
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
                  </div>
                )}
              </Card>
            );
          })}
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
          The full terms sheet, the line-by-line comparison and the AI review are on the desk version of this package.
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
