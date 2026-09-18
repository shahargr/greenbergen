import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";
import { shortDate } from "@shared/format";
import { stopwatch } from "@shared/perf";
import { AppBar, Card, Notice, Screen } from "@shared/ui";
import { money } from "@/lib/board";
import { recordReply, negotiate, award, invite, addToRoom, setScope, markLost, markLinkSent, showPhoto, hidePhoto,
  attachUploads, attachExisting, detachDoc, shareDoc } from "./actions";
import { BidPapers } from "@/components/BidPapers";
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
type Item = { id: string; scope_item_id: string; item: string; category: string | null; is_required: boolean; sort: number;
  // base = part of the price; option = an extra he prices on its own line (185).
  kind: "base" | "option" };
type Shot = { id: string; path: string; caption: string | null; file_id: string | null; sort: number };
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
// THE PAPERS (186). One copy in the file store, as many attachments as it
// deserves: the room everybody prices from, the bid it came back with, the
// deal once it is awarded - and everything else on the job, ready to attach.
type Paper = { file_id: string; name: string | null; kind: string | null; bucket: string; path: string;
  shared?: boolean; at: string | null; who?: string | null; bid_id?: string; project?: string | null };
type Papers = { package_id: string; contract_id: string | null; q: string | null;
  on_the_room: Paper[]; on_the_bids: Paper[]; on_the_deal: Paper[]; elsewhere: Paper[] };
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
type CmpOpt = { scope_item_id: string; item: string; cells: { bid_id: string; price: number | null }[] | null };
type Cmp = { items: CmpItem[]; options: CmpOpt[]; bids: CmpBid[] };
type Pkg = {
  id: string; project_id: string; project_name: string | null;
  phase: string | null; category: string | null; trade: string | null; scope_summary: string | null;
  budget_amount: number | null; budget_visible: boolean;
  deposit_pct: number | null; retainage_pct: number | null; net_days: number | null;
  insurance_workers_comp: boolean | null; coi_required: boolean | null;
  reply_by: string | null; status: string; awarded_bid_id: string | null; can_edit: boolean;
  items: Item[]; photos: Shot[]; docs: Doc[]; bids: Bid[]; members: Member[];
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
  searchParams: Promise<{ ok?: string; error?: string; open?: string; held?: string; docq?: string }>;
}) {
  const { id, pkg: pkgId } = await params;
  const { ok, error, open, held, docq } = await searchParams;
  const w = stopwatch("/project/[id]/bids/[pkg]");
  const supabase = await createClient();

  const { data: claims } = await w.step("claims", () => supabase.auth.getClaims());
  if (!claims?.claims?.sub) redirect(`/login?next=${encodeURIComponent(`/project/${id}/bids/${pkgId}`)}`);

  const [{ data }, { data: cmpData }, { data: docData }] = await Promise.all([
    w.step("package", () => rpc<Pkg>(supabase, "portal_bid_package", { p_pkg: pkgId })),
    w.step("compare", () => rpc<Cmp>(supabase, "portal_bid_compare", { p_pkg: pkgId })),
    w.step("papers", () => rpc<Papers>(supabase, "portal_bid_docs", { p_package: pkgId, p_q: docq ?? null })),
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
  const papers = (docData ?? null) as Papers | null;

  // EVERY PAPER IS PRIVATE and needs signing to be opened from this screen -
  // the room's own, each bidder's, the deal's, and the ones on the job you
  // might attach. One call, all of them.
  const docUrls = new Map<string, string>();
  const allPaths = [...new Set([
    ...p.docs.map((d) => d.path),
    ...(papers ? [...papers.on_the_room, ...papers.on_the_bids, ...papers.on_the_deal, ...papers.elsewhere]
        .filter((d) => d.bucket === "project-media").map((d) => d.path) : []),
  ])];
  if (allPaths.length > 0) {
    const { data: signed } = await w.step("docs", () =>
      supabase.storage.from("project-media").createSignedUrls(allPaths, 3600));
    for (const row of signed ?? []) if (row.path && row.signedUrl) docUrls.set(row.path, row.signedUrl);
  }
  // THE PHOTOGRAPHS. What is already shown to bidders is a public copy; what
  // you can pick from is the job's own, private and signed for this screen.
  const pub = supabase.storage.from("public-media").getPublicUrl("").data.publicUrl.replace(/\/$/, "");
  const thumbs = new Map<string, string>();
  let pickable: { id: string; file_name: string | null; bucket: string; path: string }[] = [];
  if (p.can_edit && !p.awarded_bid_id) {
    const { data: imgs } = await w.step("photos", async () => await supabase
      .from("files")
      .select("id, file_name, bucket, path, mime_type, taken_at, created_at")
      .eq("project_id", p.project_id)
      .like("mime_type", "image/%")
      .order("created_at", { ascending: false })
      .limit(24));
    pickable = (imgs ?? []) as typeof pickable;
    if (pickable.length > 0) {
      const { data: signed } = await supabase.storage.from("project-media")
        .createSignedUrls(pickable.filter((f) => f.bucket === "project-media").map((f) => f.path), 3600);
      for (const row of signed ?? []) if (row.path && row.signedUrl) thumbs.set(row.path, row.signedUrl);
    }
  }
  w.done();

  const replied = p.bids.filter((b) => REPLIED.includes(b.status));
  // BASE LINES AND OPTIONS ARE TWO LISTS (185). The base lines are what the
  // price covers and what a gap is measured against; an option is an extra,
  // priced on its own and never a gap.
  const base = p.items.filter((i) => i.kind !== "option");
  const options = p.items.filter((i) => i.kind === "option");
  const required = base.filter((i) => i.is_required);
  const itemIds = base.map((i) => i.scope_item_id).join(",");
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
                  {/* OPTIONS, each on its own row with what each man would
                      charge. They are outside the like-for-like sum on
                      purpose: an extra nobody bought is not part of the price
                      you are comparing. */}
                  {(cmp.options ?? []).length > 0 && (
                    <>
                      <tr className="cmp-sep">
                        <th className="cmp-lbl" scope="row" colSpan={cmp.bids.length + 1}>Options, priced separately</th>
                      </tr>
                      {(cmp.options ?? []).map((o) => (
                        <tr key={o.scope_item_id}>
                          <th className="cmp-lbl" scope="row">{o.item}</th>
                          {cmp.bids.map((b) => {
                            const c = (o.cells ?? []).find((x) => x.bid_id === b.id);
                            return (
                              <td key={b.id} className={c?.price != null ? "fig" : "meh"}>
                                {c?.price != null ? money(c.price) : "not quoted"}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </>
                  )}
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
            Scope · {base.length} line{base.length === 1 ? "" : "s"}{required.length > 0 ? ` · ${required.length} required` : ""}
          </div>
          {p.scope_summary && <Card soft pad><div className="small">{p.scope_summary}</div></Card>}
          {base.length === 0 && !canWrite && (
            <Card soft pad><div className="small">No scope lines on this package yet.</div></Card>
          )}
          {base.map((i) => (
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
            <details className="card pad" open={base.length === 0}>
              <summary className="small" style={{ cursor: "pointer", fontWeight: 700 }}>
                {base.length === 0 ? "Write the scope" : "Change the scope"}
              </summary>
              <form action={setScope.bind(null, id, pkgId)} className="stack" style={{ gap: 8, marginTop: 10 }}>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="scope-lines">One line per line</label>
                  <textarea id="scope-lines" name="lines" className="input" rows={Math.max(6, base.length + 2)}
                    defaultValue={base.map((i) => i.item).join("\n")}
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
          {/* OPTIONS THEY PRICE SEPARATELY (Shahar, 2026-09-17: "there are
              options i'd like them to include in their bid, as separate line
              item"). Its own box, because an option is not scope: it is not
              part of the number, it is never a gap, and every bidder is asked
              what it would cost on top. */}
          {canWrite && (
            <details className="card pad" open={options.length > 0}>
              <summary className="small" style={{ cursor: "pointer", fontWeight: 700 }}>
                Options they price separately{options.length > 0 ? ` · ${options.length}` : ""}
              </summary>
              <form action={setScope.bind(null, id, pkgId)} className="stack" style={{ gap: 8, marginTop: 10 }}>
                <input type="hidden" name="kind" value="option" />
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="option-lines">One option per line</label>
                  <textarea id="option-lines" name="lines" className="input" rows={Math.max(4, options.length + 2)}
                    defaultValue={options.map((i) => i.item).join("\n")}
                    placeholder={"Copper valley metal instead of galvanized\nStrip and replace the porch roof as well\nGutters and leaders"} />
                </div>
                <button className="btn btn-secondary btn-block">Save the options</button>
                <p className="tiny text-muted" style={{ margin: 0 }}>
                  Each one gets a price box of its own on the bidder&apos;s page. Leaving one unpriced is a
                  fair answer and never counts against him.
                </p>
              </form>
            </details>
          )}
          {!canWrite && options.length > 0 && (
            <div className="stack" style={{ gap: 6 }}>
              <div className="divider-label">Options, priced separately · {options.length}</div>
              {options.map((i) => (
                <div className="home-row" key={i.id} style={{ cursor: "default" }}>
                  <span className="t">{i.item}</span>
                </div>
              ))}
            </div>
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

        {/* THE PAPERS (migration 186). Shahar: "the user can upload as many
            documents as needed, and attach them as needed to the bid, and or
            to the awarded deal... access to other documents in the projects
            should be possible as well, for access to survey or architect
            plans."

            One copy in the file store, as many attachments as it deserves.
            Three places a paper can sit - the room everybody prices from, one
            man's bid, the deal once it is awarded - and a fourth list of
            everything already on the job, ready to be filed here without
            being uploaded twice. */}
        {papers && (
          <section className="stack" style={{ gap: 8 }}>
            <div className="divider-label">
              Papers · {papers.on_the_room.length} on the room
              {papers.on_the_bids.length > 0 && ` · ${papers.on_the_bids.length} from bidders`}
              {papers.on_the_deal.length > 0 && ` · ${papers.on_the_deal.length} on the deal`}
            </div>

            {papers.on_the_room.map((d) => (
              <div className="home-row" key={d.file_id} style={{ cursor: "default", alignItems: "flex-start" }}>
                <span className="grow" style={{ minWidth: 0 }}>
                  {docUrls.get(d.path)
                    ? <a className="t" href={docUrls.get(d.path)} target="_blank" rel="noreferrer">{d.name}</a>
                    : <span className="t">{d.name}</span>}
                  <span className="m" style={{ display: "block" }}>
                    {d.shared ? "Bidders can open this one" : "Ours — bidders do not see it"}
                  </span>
                </span>
                {canWrite && !d.shared && (
                  <form action={shareDoc.bind(null, id, pkgId)}>
                    <input type="hidden" name="file_id" value={d.file_id} />
                    <input type="hidden" name="bucket" value={d.bucket} />
                    <input type="hidden" name="path" value={d.path} />
                    <input type="hidden" name="name" value={d.name ?? ""} />
                    <button className="btn btn-ghost small">Show bidders</button>
                  </form>
                )}
                {canWrite && (
                  <form action={detachDoc.bind(null, id, pkgId, d.file_id)}>
                    <button className="btn btn-ghost small" aria-label="Take it off the room">×</button>
                  </form>
                )}
              </div>
            ))}

            {papers.on_the_bids.length > 0 && (
              <div className="stack" style={{ gap: 6 }}>
                <div className="tiny text-muted" style={{ fontWeight: 800 }}>What came back</div>
                {papers.on_the_bids.map((d) => (
                  <div className="home-row" key={`${d.bid_id}-${d.file_id}`} style={{ cursor: "default" }}>
                    <span className="grow" style={{ minWidth: 0 }}>
                      {docUrls.get(d.path)
                        ? <a className="t" href={docUrls.get(d.path)} target="_blank" rel="noreferrer">{d.name}</a>
                        : <span className="t">{d.name}</span>}
                      <span className="m" style={{ display: "block" }}>{d.who ?? "a bidder"}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}

            {papers.on_the_deal.length > 0 && (
              <div className="stack" style={{ gap: 6 }}>
                <div className="tiny text-muted" style={{ fontWeight: 800 }}>On the deal</div>
                {papers.on_the_deal.map((d) => (
                  <div className="home-row" key={`deal-${d.file_id}`} style={{ cursor: "default" }}>
                    <span className="grow" style={{ minWidth: 0 }}>
                      {docUrls.get(d.path)
                        ? <a className="t" href={docUrls.get(d.path)} target="_blank" rel="noreferrer">{d.name}</a>
                        : <span className="t">{d.name}</span>}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Held OPEN while a search is running: the search box submits the
                page, and a panel that closes on reload throws the results away
                behind another tap - the opposite of "faster to find the
                necessary documents". */}
            {canWrite && (
              <details className="card pad" open={!!docq}>
                <summary className="small" style={{ cursor: "pointer", fontWeight: 700 }}>Add papers</summary>
                <div className="stack" style={{ gap: 14, marginTop: 10 }}>
                  <div>
                    <div className="small" style={{ fontWeight: 700, marginBottom: 6 }}>Upload</div>
                    <BidPapers projectId={p.project_id} label="Bid paper"
                      action={attachUploads.bind(null, id, pkgId)} />
                  </div>

                  {/* FROM THE JOB. The survey and the architect's plans are
                      already here; attaching beats uploading them again. */}
                  <div>
                    <div className="small" style={{ fontWeight: 700, marginBottom: 6 }}>From this job</div>
                    <form className="row" style={{ gap: 6, marginBottom: 8 }}>
                      <input name="docq" className="input grow" defaultValue={docq ?? ""}
                        placeholder="survey, plan, permit…" aria-label="Find a document" />
                      <button className="btn btn-secondary small">Find</button>
                    </form>
                    <div className="stack" style={{ gap: 4 }}>
                      {papers.elsewhere.length === 0 && (
                        <p className="tiny text-muted" style={{ margin: 0 }}>
                          {docq ? `Nothing on this job matches “${docq}”.` : "Nothing else on this job yet."}
                        </p>
                      )}
                      {docq && papers.elsewhere.length > 0 && (
                        <p className="tiny text-muted" style={{ margin: "0 0 2px" }}>
                          {papers.elsewhere.length} match{papers.elsewhere.length === 1 ? "" : "es"} for “{docq}”
                          {" · "}<a href={`/project/${id}/bids/${pkgId}`}>show the recent ones</a>
                        </p>
                      )}
                      {papers.elsewhere.map((d) => (
                        <form key={d.file_id} action={attachExisting.bind(null, id, pkgId)} className="home-row"
                          style={{ cursor: "default" }}>
                          <input type="hidden" name="file_id" value={d.file_id} />
                          <span className="grow" style={{ minWidth: 0 }}>
                            <span className="t">{d.name}</span>
                            <span className="m" style={{ display: "block" }}>{d.project}</span>
                          </span>
                          <button className="btn btn-ghost small">Attach</button>
                        </form>
                      ))}
                    </div>
                  </div>
                </div>
              </details>
            )}

            <p className="tiny text-muted" style={{ margin: 0 }}>
              Attaching files a paper here for us. <strong>Show bidders</strong> publishes a copy anybody with a
              bid link can open — worth a thought on a survey or a plan, which usually carry the address.
            </p>
          </section>
        )}

        {/* WHAT THEY SEE BEFORE THEY PRICE (Shahar, 2026-09-17: "when i plan
            it i'd like to include a photo, and have the contractors see it
            before they plug in their number"). A man who has seen the roof
            prices the roof; a man who has not is guessing, and the guess gets
            revised upward once he is standing on it.

            The job's photographs are private and a bidder has no session to
            sign a URL with, so picking one COPIES it to the public bucket -
            which is why this is a deliberate act per photograph rather than
            "the folder is visible". */}
        {(p.photos.length > 0 || (canWrite && pickable.length > 0)) && (
          <section className="stack" style={{ gap: 8 }}>
            <div className="divider-label">
              What they see · {p.photos.length} photograph{p.photos.length === 1 ? "" : "s"}
            </div>
            {p.photos.length > 0 && (
              <div className="bp-grid">
                {p.photos.map((ph) => (
                  <div className="bp-cell" key={ph.id}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`${pub}/${ph.path}`} alt={ph.caption ?? "On the job"} />
                    {canWrite && (
                      <form action={hidePhoto.bind(null, id, pkgId, ph.id)} className="bp-off">
                        <button className="bp-btn" aria-label="Take it down">×</button>
                      </form>
                    )}
                  </div>
                ))}
              </div>
            )}
            {canWrite && pickable.length > 0 && (
              <details className="card pad">
                <summary className="small" style={{ cursor: "pointer", fontWeight: 700 }}>
                  {p.photos.length > 0 ? "Show another" : "Show them a photograph"}
                </summary>
                <p className="tiny text-muted" style={{ margin: "8px 0" }}>
                  From this job&apos;s own photographs. Picking one publishes a copy that anybody with the
                  bid link can see — so pick what helps them price it, not what is private.
                </p>
                <div className="bp-grid">
                  {pickable.filter((f) => !p.photos.some((ph) => ph.file_id === f.id)).map((f) => (
                    <form key={f.id} action={showPhoto.bind(null, id, pkgId)} className="bp-cell">
                      <input type="hidden" name="file_id" value={f.id} />
                      <input type="hidden" name="bucket" value={f.bucket} />
                      <input type="hidden" name="path" value={f.path} />
                      {thumbs.get(f.path)
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={thumbs.get(f.path)} alt={f.file_name ?? "Photograph"} />
                        : <div className="bp-blank">{f.file_name}</div>}
                      <button className="bp-pick">Show it</button>
                    </form>
                  ))}
                </div>
              </details>
            )}
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

                {/* HIS PROPOSAL, filed against his bid - and once he wins, it
                    follows him onto the deal on its own (186). */}
                {canWrite && sheet && (
                  <div style={{ marginTop: 10 }}>
                    <div className="small" style={{ fontWeight: 700, marginBottom: 6 }}>His proposal</div>
                    <BidPapers projectId={p.project_id} bidId={b.id} label="Proposal"
                      action={attachUploads.bind(null, id, pkgId)} />
                  </div>
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
                      {base.length > 0 && (
                        <details>
                          <summary className="tiny text-muted" style={{ cursor: "pointer" }}>
                            What his price covers — everything, unless you say otherwise
                          </summary>
                          <div className="stack" style={{ gap: 6, marginTop: 8 }}>
                            {base.map((i) => (
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
