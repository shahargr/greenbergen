import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";
import { shortDate } from "@shared/format";
import { stopwatch } from "@shared/perf";
import { AppBar, Card, Notice, Screen } from "@shared/ui";
import { money } from "@/lib/board";
import { recordReply, negotiate, award, invite, addToRoom, setScope, markLost, markLinkSent, showPhoto, hidePhoto,
  attachUploads, attachExisting, detachDoc, shareDoc,
  removeBidder, editBidder, addKnownToRoom, setTemplate, setMeasures, refineLines,
  stepOut, unaward } from "./actions";
import { BidPapers } from "@/components/BidPapers";
import { BidLink } from "@/components/BidLink";
import { BidRowMenu } from "@/components/BidRowMenu";
import { RoomPeople } from "@/components/RoomPeople";

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
  kind: "base" | "option";
  // THE MEASUREMENT (188). How much of this line there is, in the trade's own
  // word - 32 squares, 140 linear feet. Shown to every bidder so they all
  // price the same quantity, and what turns three quotes into a rate.
  qty: number | null; unit: string | null;
  // IN OR OUT OF THIS PROPOSAL (192). A line the room is not asking for -
  // tear-off on a new build - stays here with its reason so the decision can
  // be read and undone; no bidder sees it and no bid is short for it.
  is_included: boolean; excluded_why: string | null };
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
type CmpItem = { scope_item_id: string; item: string; is_required: boolean; qty: number | null; unit: string | null; cells: Cell[] | null };
type CmpBid = {
  id: string; bidder: string | null; person: string | null; status: string;
  amount: number | null; gaps: number; gap_cost: number; normalized: number;
  terms_ok: boolean; insurance_ok: boolean;
  // What his LINES add up to, when the room asked for a price on each (188).
  // Kept apart from the number he wrote at the bottom on purpose: when the
  // two disagree, that is the thing worth seeing.
  lines_total: number | null; lines_priced: number;
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
  // The room asks for a price against every line rather than one lump sum (188).
  price_per_line: boolean;
  items: Item[]; photos: Shot[]; docs: Doc[]; bids: Bid[]; members: Member[];
};

// A reply that is in, whatever stage it reached.
const REPLIED = ["received", "under negotiation", "awarded", "not awarded"];
// ALREADY OUT, however he got there - turned down, or gone of his own accord
// (212). The three buttons that take somebody out are hidden once any of
// them has been pressed; the row menu is where a mistake gets corrected.
const OUT = ["not awarded", "declined", "withdrawn"];
const tone = (s: string) =>
  s === "awarded" ? "tag-ok"
  : s === "received" || s === "under negotiation" ? "tag-outline"
  : s === "not awarded" || s === "declined" || s === "withdrawn" || s === "expired" ? "tag-neutral"
  : "tag-neutral";

export default async function BidPackagePage({
  params, searchParams,
}: {
  params: Promise<{ id: string; pkg: string }>;
  searchParams: Promise<{ ok?: string; error?: string; open?: string; held?: string; docq?: string; who?: string;
    n?: string; how?: string; back?: string; seat?: string }>;
}) {
  const { id, pkg: pkgId } = await params;
  const { ok, error, open, held, docq, who, n, how, back, seat } = await searchParams;
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
  // And a third list, cutting across both: what is being ASKED FOR. Everything
  // below the refine form reads off `asked`, because a line taken out is not a
  // line to price, to compare, or to be missing.
  const asked = base.filter((i) => i.is_included !== false);
  const outOf = p.items.filter((i) => i.is_included === false);
  const askedOptions = options.filter((i) => i.is_included !== false);
  const itemIds = asked.map((i) => i.scope_item_id).join(",");
  const optionIds = askedOptions.map((i) => i.scope_item_id).join(",");
  // What this bidder last put against one line, read out of the comparison -
  // so reopening the sheet to change one number does not blank the rest.
  const priceOf = (b: Bid, scopeItemId: string): number | null => {
    const row = cmp?.items.find((i) => i.scope_item_id === scopeItemId)
      ?? cmp?.options.find((i) => i.scope_item_id === scopeItemId);
    return row?.cells?.find((c) => c.bid_id === b.id)?.price ?? null;
  };
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
        {/* HE TOOK HIMSELF OUT (212) - said back in his words, not as a status. */}
        {ok === "stepout" && (
          <div className="banner-ok">
            {who || "He"} {how === "withdrawn" ? "withdrew his price" : "declined to bid"}. His link is closed, and
            the room records that he stepped out rather than that you turned him down.
          </div>
        )}
        {/* THE AWARD IS UNDONE (210) - and the one thing it deliberately did
            not do is the thing worth saying. */}
        {ok === "unaward" && (
          <div className="banner-ok">
            Award undone. {who || "He"} is back to <strong>{back || "received"}</strong>, the room is open, and the
            contract it created is cancelled.
            {seat === "1" && <> {who || "He"} still holds a seat on this job — take it off the team screen if that is wrong.</>}
          </div>
        )}
        {ok === "invited" && <div className="banner-ok">Invited.</div>}
        {ok === "added" && <div className="banner-ok">In the room. Write his number down when it comes in.</div>}
        {ok === "already" && <div className="banner-ok">That firm was already in this room — nothing doubled up.</div>}
        {ok === "opened" && <div className="banner-ok">Room opened. Put somebody in it.</div>}
        {ok === "existed" && <div className="banner-ok">This room was already open.</div>}
        {ok === "removed" && <div className="banner-ok">{who || "They"} came out of the room. They stay in the address book.</div>}
        {ok === "edited" && <div className="banner-ok">Corrected — in the address book, so it is right everywhere now.</div>}
        {ok === "perline" && <div className="banner-ok">They will be asked for a price against every line. Anybody who already priced keeps what they said.</div>}
        {ok === "lumpsum" && <div className="banner-ok">Back to one number for the job.</div>}
        {ok === "measured" && <div className="banner-ok">{n ? `${n} line${n === "1" ? "" : "s"} measured.` : "Measurements saved."} Every bidder sees them.</div>}
        {ok === "scope" && (
          <div className="banner-ok">
            Scope saved. Those lines are what every bid is judged against.
            {held && ` Kept anyway, because somebody already priced them: ${held}.`}
          </div>
        )}
        {ok === "refined" && (
          <div className="banner-ok">
            Lines saved — {n}. Anybody who left out a line you took out is no longer short of it.
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

        {/* THE ROOM, AS A TABLE, AT THE TOP (Shahar, 2026-09-18: "people in the
            room should be listed in a table on top, with their pricing").

            The comparison below only holds people who have REPLIED, so a room
            where nobody has priced yet showed a wall of cards and no table at
            all - which is exactly the moment you most want to see who was
            asked and whether the link was ever opened. This is the roster:
            everybody in the room, replied or not, what they said, and the
            three things you do to a row - open their sheet, correct them,
            take them out.

            The line-by-line grid stays below. This says WHO, that says WHAT. */}
        {p.bids.length > 0 && (
          <section className="stack" style={{ gap: 8 }}>
            <div className="divider-label">
              In the room · {p.bids.length}
              {replied.length > 0 && <span style={{ fontWeight: 700 }}>&nbsp;· {replied.length} priced</span>}
            </div>
            <div className="cmp-scroll">
              <table className="cmp roster">
                <thead>
                  <tr>
                    <th className="cmp-lbl" scope="col">Who</th>
                    <th scope="col">Their number</th>
                    {p.price_per_line && <th scope="col">Lines</th>}
                    <th scope="col">Missing</th>
                    <th scope="col">Like for like</th>
                    <th scope="col">Where it got to</th>
                    {canWrite && <th scope="col"><span className="sr-only">Actions</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {p.bids.map((b) => {
                    const c = cmp?.bids.find((x) => x.id === b.id) ?? null;
                    const isAwarded = b.id === p.awarded_bid_id;
                    // Where the link got to, in the order it actually happens.
                    const linkState = b.link_revoked ? "link pulled"
                      : b.link_opened_at ? `opened ${shortDate(b.link_opened_at)}`
                      : b.link_sent_at ? `sent ${shortDate(b.link_sent_at)}`
                      : b.link_token ? "link not sent"
                      : "no link";
                    return (
                      <tr key={b.id} className={isAwarded ? "tot" : undefined}>
                        <th className="cmp-lbl" scope="row">
                          <a href={`#${b.id}`}>{b.bidder ?? "Somebody"}</a>
                          {b.person && b.person !== b.bidder && <span className="sub">{b.person}</span>}
                        </th>
                        <td className={b.amount != null ? "fig" : "meh"}>
                          {b.amount != null ? money(b.amount) : "—"}
                          {b.valid_until && <span className="sub">good to {shortDate(b.valid_until)}</span>}
                        </td>
                        {p.price_per_line && (
                          <td className={c?.lines_total != null ? "fig" : "meh"}>
                            {c?.lines_total != null ? money(c.lines_total) : "—"}
                            {/* The one thing worth shouting about: he priced
                                every line and the two numbers do not agree. */}
                            {c?.lines_total != null && b.amount != null && Math.round(c.lines_total) !== Math.round(b.amount) && (
                              <span className="sub" style={{ color: "var(--color-status)" }}>
                                {money(Math.abs(c.lines_total - b.amount))} off his total
                              </span>
                            )}
                            {c != null && c.lines_priced > 0 && c.lines_priced < asked.length && (
                              <span className="sub">{c.lines_priced} of {asked.length}</span>
                            )}
                          </td>
                        )}
                        <td className={c == null ? "meh" : c.gaps > 0 ? "no" : "yes"}>
                          {c == null ? "—" : c.gaps === 0 ? "nothing" : `${c.gaps} line${c.gaps === 1 ? "" : "s"}`}
                          {c != null && c.gap_cost > 0 && <span className="sub">+{money(c.gap_cost)}</span>}
                        </td>
                        <td className={c?.id === best ? "fig best" : c != null ? "fig" : "meh"}>
                          {c != null && b.amount != null ? money(c.normalized) : "—"}
                        </td>
                        <td>
                          <span className={`tag ${tone(isAwarded ? "awarded" : b.status)}`}>
                            {isAwarded ? "awarded" : b.status}
                          </span>
                          <span className="sub">{linkState}</span>
                        </td>
                        {canWrite && (
                          <td className="roster-acts">
                            <Link href={`/project/${id}/bids/${pkgId}?open=${b.id}#${b.id}`} scroll={false}
                              className="btn btn-ghost small">{b.amount != null ? "Edit" : "Price"}</Link>
                            {!isAwarded && (
                              <BidRowMenu who={b.bidder ?? "them"} person={b.person}
                                phone={b.link_phone} email={b.link_email}
                                priced={b.amount != null}
                                onEdit={editBidder.bind(null, id, pkgId, b.id)}
                                onRemove={removeBidder.bind(null, id, pkgId, b.id)} />
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="tiny text-muted" style={{ margin: 0 }}>
              Like for like is his number plus what the lines he left out cost, priced at what the others charge for
              them{p.price_per_line ? " — and Lines is what his own line prices add up to" : ""}. It is the column to
              read, not the one he wrote.
            </p>
          </section>
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

        {/* WHAT WAS ASKED FOR, BEHIND ONE LINE. Shahar (2026-09-19): "make the
            scope foldable, it is too much for no reason on the page." Thirteen
            lines and four editors pushed everything that changes daily - who
            replied, whose number is in - off the bottom of the phone. The
            scope is written once and read rarely, so it lives behind its own
            summary and opens when you want it.

            A bidder prices these lines; a reply that leaves a required one out
            is a gap, and the database says so. */}
        <details className="card pad" open={base.length === 0}>
          <summary className="small" style={{ cursor: "pointer", fontWeight: 700 }}>
            Scope · {asked.length} line{asked.length === 1 ? "" : "s"}
            {outOf.length > 0 ? ` · ${outOf.length} not in it` : ""}
            {askedOptions.length > 0 ? ` · ${askedOptions.length} option${askedOptions.length === 1 ? "" : "s"}` : ""}
          </summary>
          <div className="stack" style={{ gap: 8, marginTop: 10 }}>
            {p.scope_summary && <Card soft pad><div className="small">{p.scope_summary}</div></Card>}
            {base.length === 0 && !canWrite && (
              <Card soft pad><div className="small">No scope lines on this package yet.</div></Card>
            )}
            {asked.map((i) => (
              <div className="home-row" key={i.id} style={{ cursor: "default", alignItems: "flex-start" }}>
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="t" style={{ fontWeight: 600 }}>{i.item}</span>
                  {i.category && <span className="m" style={{ display: "block" }}>{i.category}</span>}
                </span>
                {i.is_required && <span className="tag tag-outline" style={{ whiteSpace: "nowrap" }}>required</span>}
              </div>
            ))}

            {/* TAKEN OUT ON PURPOSE (192). Shown, greyed, with the reason -
                because "did this bid include tear-off?" is a question somebody
                asks a year later, and "we decided it did not apply" is a
                better answer than silence. */}
            {outOf.length > 0 && (
              <>
                <div className="divider-label">Not in this proposal · {outOf.length}</div>
                {outOf.map((i) => (
                  <div className="home-row" key={i.id} style={{ cursor: "default", alignItems: "flex-start", opacity: .62 }}>
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="t" style={{ fontWeight: 600, textDecoration: "line-through" }}>{i.item}</span>
                      {i.excluded_why && <span className="m" style={{ display: "block" }}>{i.excluded_why}</span>}
                    </span>
                    <span className="tag tag-neutral" style={{ whiteSpace: "nowrap" }}>out</span>
                  </div>
                ))}
              </>
            )}

            {/* REFINE (192). Shahar (2026-09-19): "an easy way to include /
                exclude items from the proposal. for example, this image
                reflects a new build, so tear-off existing is not needed...
                maybe a refine button."

                A TICK, NOT A DROPDOWN (Shahar, 2026-09-21: "change UI to
                line, with include +/- checkbox column"). Four states in one
                select meant a select on every row, and on a phone each line
                wrapped onto two - ten lines became twenty rows of furniture
                to read past.

                In or out is the question you actually ask of twenty lines in
                a row, and it is binary, so it is a tick. The two states a
                tick cannot hold - priced separately, and a line that should
                never have been typed - stay in a narrow select that reads
                "—" until you need it. The tick decides in or out; the select
                only overrides it. Nothing can disagree with itself. */}
            {canWrite && p.items.length > 0 && (
              <details className="card pad">
                <summary className="small" style={{ cursor: "pointer", fontWeight: 700 }}>
                  Refine the lines · one at a time
                </summary>
                <form action={refineLines.bind(null, id, pkgId)} className="stack" style={{ gap: 6, marginTop: 10 }}>
                  <input type="hidden" name="ids" value={p.items.map((i) => i.id).join(",")} />
                  {/* The tick column needs a word over it, or the first thing
                      you do is tick one to find out what it does. */}
                  <div className="ref-row ref-head">
                    <span className="tiny text-muted" style={{ textAlign: "center" }}>in</span>
                    <span className="tiny text-muted">the line, as the bidders read it</span>
                    <span className="tiny text-muted">or…</span>
                  </div>
                  {p.items.map((i) => {
                    const isIn = i.is_included !== false;
                    return (
                      <div className="ref-row" key={i.id}>
                        {/* An option is still asked for - it is priced on its
                            own line, not left out - so it ticks in. */}
                        <input type="checkbox" className="ref-in" name={`in__${i.id}`} defaultChecked={isIn}
                          aria-label={`In this proposal: ${i.item}`} title="In this proposal" />
                        <input className="input ref-text" name={`item__${i.id}`} defaultValue={i.item}
                          aria-label={`The wording: ${i.item}`} />
                        <select className="input ref-state" name={`state__${i.id}`}
                          defaultValue={i.kind === "option" ? "option" : ""}
                          aria-label={`Anything special about this line: ${i.item}`}
                          title="Leave as — unless the line is priced separately or should come off the room">
                          <option value="">—</option>
                          <option value="option">Priced separately</option>
                          <option value="drop">Remove the line</option>
                        </select>
                      </div>
                    );
                  })}
                  <label className="field" style={{ marginBottom: 0, marginTop: 4 }}>
                    <span className="field-label">Why the ones you untick are out (optional)</span>
                    <input className="input" name="why" placeholder="New build — nothing to tear off" />
                  </label>
                  <button className="btn btn-secondary btn-block">Save the lines</button>
                  <p className="tiny text-muted" style={{ margin: 0 }}>
                    An <strong>unticked</strong> line stays here with its reason, is hidden from every bidder, and
                    stops counting against anybody who left it out. <strong>Remove the line</strong> takes it off the
                    room for good — it stays on the job, and a line somebody has already priced is kept whatever you
                    pick.
                  </p>
                </form>
              </details>
            )}

            {/* THE SCOPE IS WRITTEN IN THE ROOM (Shahar's choice, 2026-09-17).
                One line per line. These lines are the project's scope for the
                trade, not a copy of it, and they are the rows of the table
                above - so what you type here is what every bid is judged
                against. Saving the box back is safe: a line already written is
                matched, never written twice, and a line taken out on purpose is
                left alone rather than read as a deletion. */}
            {canWrite && (
              <details className="card pad" open={base.length === 0}>
                <summary className="small" style={{ cursor: "pointer", fontWeight: 700 }}>
                  {base.length === 0 ? "Write the scope" : "Add lines, or rewrite the list"}
                </summary>
                <form action={setScope.bind(null, id, pkgId)} className="stack" style={{ gap: 8, marginTop: 10 }}>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label htmlFor="scope-lines">One line per line</label>
                    <textarea id="scope-lines" name="lines" className="input" rows={Math.max(6, asked.length + 2)}
                      defaultValue={asked.map((i) => i.item).join("\n")}
                      placeholder={"Tear off to deck\nIce and water at eaves and valleys\nArchitectural shingles, 30 year\nDrip edge all around\nHaul away and dumpster"} />
                  </div>
                  <button className="btn btn-secondary btn-block">Save the scope</button>
                  <p className="tiny text-muted" style={{ margin: 0 }}>
                    Every line counts as required. Taking a line out of the box leaves it on the job — it only
                    stops being one of the rows here. Lines you set aside above are not in this box and are not
                    touched by saving it.
                  </p>
                </form>
              </details>
            )}
            {/* THE SHEET THEY FILL IN (188b). Shahar (2026-09-18): "when asking
                for pricing i would like to create the template the vendors will
                complete so it is easier to compare them."

                A base line used to be a TICK - in or out - and the whole job one
                lump sum. Three roofers come back with 41,000 / 38,500 / 44,000
                and the only honest thing you can say is which is smaller. Where
                the money went is the question, and nobody could ask it.

                Two halves, and the second is what makes it a bid sheet rather
                than a wish: ask for a price on every line, and say HOW MUCH of
                each line there is. Thirteen prices are comparable; thirteen
                prices against 32 squares and 140 linear feet are a rate. */}
            {canWrite && asked.length > 0 && (
              <details className="card pad" open={p.price_per_line}>
                <summary className="small" style={{ cursor: "pointer", fontWeight: 700 }}>
                  What they fill in{p.price_per_line ? " · a price on every line" : " · one number"}
                </summary>

                <form action={setTemplate.bind(null, id, pkgId)} className="stack" style={{ gap: 8, marginTop: 10 }}>
                  <label className="radio-opt" style={{ marginBottom: 0 }}>
                    <input type="checkbox" name="price_per_line" defaultChecked={p.price_per_line} />
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="t">Ask for a price against every line</span>
                      <span className="m" style={{ display: "block" }}>
                        Their page gets {asked.length} price boxes instead of {asked.length} ticks, and their total is the
                        sum of the lines. The side-by-side then compares line against line.
                      </span>
                    </span>
                  </label>
                  <button className="btn btn-secondary btn-block">
                    {p.price_per_line ? "Save — or go back to one number" : "Ask for a price per line"}
                  </button>
                </form>

                {/* The measurement. Offered whichever way the room is asking,
                    because a quantity is worth stating even against a lump sum:
                    it is how you know everybody priced the same roof. */}
                <div className="divider-label" style={{ marginTop: 14 }}>How much of each line</div>
                <p className="tiny text-muted" style={{ margin: "0 0 8px" }}>
                  Optional, and shown to every bidder. Leave a line blank where you genuinely do not know — a stale
                  number is worse than none.
                </p>
                <form action={setMeasures.bind(null, id, pkgId)} className="stack" style={{ gap: 6 }}>
                  {asked.map((i) => (
                    <div key={i.id} className="meas-row">
                      <span className="meas-item">{i.item}</span>
                      <input className="input meas-qty" name={`qty__${i.id}`} inputMode="decimal"
                        defaultValue={i.qty != null ? String(i.qty) : ""} placeholder="—"
                        aria-label={`How much: ${i.item}`} />
                      <input className="input meas-unit" name={`unit__${i.id}`}
                        defaultValue={i.unit ?? ""} placeholder="squares"
                        aria-label={`Counted in: ${i.item}`} />
                    </div>
                  ))}
                  <button className="btn btn-secondary btn-block">Save the measurements</button>
                </form>
              </details>
            )}

            {/* OPTIONS THEY PRICE SEPARATELY (Shahar, 2026-09-17: "there are
                options i'd like them to include in their bid, as separate line
                item"). Its own box, because an option is not scope: it is not
                part of the number, it is never a gap, and every bidder is asked
                what it would cost on top. */}
            {canWrite && (
              <details className="card pad" open={askedOptions.length > 0}>
                <summary className="small" style={{ cursor: "pointer", fontWeight: 700 }}>
                  Options they price separately{askedOptions.length > 0 ? ` · ${askedOptions.length}` : ""}
                </summary>
                <form action={setScope.bind(null, id, pkgId)} className="stack" style={{ gap: 8, marginTop: 10 }}>
                  <input type="hidden" name="kind" value="option" />
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label htmlFor="option-lines">One option per line</label>
                    <textarea id="option-lines" name="lines" className="input" rows={Math.max(4, askedOptions.length + 2)}
                      defaultValue={askedOptions.map((i) => i.item).join("\n")}
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
            {!canWrite && askedOptions.length > 0 && (
              <div className="stack" style={{ gap: 6 }}>
                <div className="divider-label">Options, priced separately · {askedOptions.length}</div>
                {askedOptions.map((i) => (
                  <div className="home-row" key={i.id} style={{ cursor: "default" }}>
                    <span className="t">{i.item}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </details>

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
                {/* "Add papers" told you the filing cabinet it went into, not
                    what to put in it (Shahar, 2026-09-21). What a bidder
                    actually needs to price a job is the plans and the
                    photographs, so the button asks for those. */}
                <summary className="small" style={{ cursor: "pointer", fontWeight: 700 }}>Attach plans / images</summary>
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
            // A man who declined or withdrew is not awardable either (212) -
            // "not awarded" used to be the only way out, so it was the only
            // one this had to exclude.
            const canAward = canWrite && REPLIED.includes(b.status) && !OUT.includes(b.status);
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
                  {/* CORRECT THEM OR TAKE THEM OUT, WHERE THE THUMB IS.
                      Shahar, 2026-09-21: "i was able to add alex to the room.
                      i should also have a way to remove someone from the
                      room."

                      There always was one - the "…" in the last column of the
                      roster table. On a phone that table scrolls sideways and
                      the column is three swipes past the edge of the screen,
                      so the capability existed and could not be found. The
                      same menu sits on the card now, which is full width and
                      is where you already are when you are looking at one
                      bidder rather than comparing all of them. */}
                  <span className="row" style={{ gap: 6, alignItems: "center", flex: "none" }}>
                    <span className={`tag ${tone(b.status)}`} style={{ whiteSpace: "nowrap" }}>{isAwarded ? "awarded" : b.status}</span>
                    {canWrite && !isAwarded && (
                      <BidRowMenu who={b.bidder ?? "them"} person={b.person}
                        phone={b.link_phone} email={b.link_email}
                        priced={b.amount != null}
                        onEdit={editBidder.bind(null, id, pkgId, b.id)}
                        onRemove={removeBidder.bind(null, id, pkgId, b.id)} />
                    )}
                  </span>
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
                      <input type="hidden" name="options" value={optionIds} />
                      <div className="small" style={{ fontWeight: 700 }}>His number</div>
                      <div className="row" style={{ gap: 8 }}>
                        <div className="field grow" style={{ marginBottom: 0 }}>
                          <label htmlFor={`amt-${b.id}`}>
                            {p.price_per_line ? "Total ($) — or leave it and the lines add up" : "Amount ($)"}
                          </label>
                          <input id={`amt-${b.id}`} name="amount" className="input" inputMode="decimal"
                            defaultValue={b.amount != null ? String(Math.round(b.amount)) : ""} placeholder="14,000" />
                        </div>
                        <div className="field grow" style={{ marginBottom: 0 }}>
                          <label htmlFor={`val-${b.id}`}>Good until</label>
                          <input id={`val-${b.id}`} name="valid_until" type="date" className="input" defaultValue={b.valid_until ?? ""} />
                        </div>
                      </div>
                      {/* THE SAME SHEET FROM EITHER SIDE (188). A room asking
                          for a price per line asks for it here too - a bid
                          taken over the phone has to be comparable with one
                          that came in through the link, and it never was. */}
                      {asked.length > 0 && (
                        <details open={p.price_per_line}>
                          <summary className="tiny text-muted" style={{ cursor: "pointer" }}>
                            {p.price_per_line
                              ? `What he put against each line · ${asked.length}`
                              : "What his price covers — everything, unless you say otherwise"}
                          </summary>
                          <div className="stack" style={{ gap: 6, marginTop: 8 }}>
                            {asked.map((i) => {
                              const said = priceOf(b, i.scope_item_id);
                              return (
                                <label key={i.id} className={p.price_per_line ? "meas-row" : "row small"}
                                  style={p.price_per_line ? undefined : { gap: 8, alignItems: "flex-start" }}>
                                  <input type="checkbox" name={`inc_${i.scope_item_id}`} defaultChecked style={{ marginTop: 3 }} />
                                  <span className="grow meas-item" style={{ minWidth: 0 }}>
                                    {i.item}{i.is_required ? "" : " (optional)"}
                                    {i.qty != null && <span className="tiny text-muted"> · {i.qty}{i.unit ? ` ${i.unit}` : ""}</span>}
                                  </span>
                                  {p.price_per_line && (
                                    <input className="input meas-qty" name={`price_${i.scope_item_id}`} inputMode="decimal"
                                      defaultValue={said != null ? String(Math.round(said)) : ""} placeholder="$"
                                      aria-label={`His price for ${i.item}`} />
                                  )}
                                </label>
                              );
                            })}
                          </div>
                        </details>
                      )}
                      {/* The options, priced on their own. They were only ever
                          collectable through his link; a manager writing the
                          bid down could not record them at all. */}
                      {askedOptions.length > 0 && (
                        <details>
                          <summary className="tiny text-muted" style={{ cursor: "pointer" }}>
                            Options, priced separately · {askedOptions.length}
                          </summary>
                          <div className="stack" style={{ gap: 6, marginTop: 8 }}>
                            {askedOptions.map((i) => {
                              const said = priceOf(b, i.scope_item_id);
                              return (
                                <label key={i.id} className="meas-row">
                                  <span className="meas-item">{i.item}</span>
                                  <input className="input meas-qty" name={`opt_${i.scope_item_id}`} inputMode="decimal"
                                    defaultValue={said != null ? String(Math.round(said)) : ""} placeholder="$"
                                    aria-label={`His price for ${i.item}`} />
                                </label>
                              );
                            })}
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

                    {/* OUT, AND WHICH KIND OF OUT (212). Shahar, on HVAC:
                        "Jacob / Mario is closed as lost on the bidding."

                        That was the only button, and it writes 'not awarded'
                        - which says YOU turned HIM down. A man who rings to
                        say he is booked until spring was not turned down, and
                        filing him that way means the room lies to you next
                        year when you are deciding who to ask again.

                        Three buttons, one form, one reason box. The database
                        refuses "withdrew" on a bid that never carried a
                        number, so the two cannot be crossed by a mis-tap. */}
                    {!OUT.includes(b.status) && !isAwarded && (
                      <form className="stack" style={{ gap: 8 }}>
                        <div className="small" style={{ fontWeight: 700 }}>Or take {b.bidder ?? "him"} out of the room</div>
                        <div className="field" style={{ marginBottom: 0 }}>
                          <label htmlFor={`lost-${b.id}`}>Why he is out</label>
                          <input id={`lost-${b.id}`} name="reason" className="input"
                            placeholder="Optional — never came back, too high, booked until spring" />
                        </div>
                        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                          <button formAction={markLost.bind(null, id, pkgId, b.id)}
                            className="btn btn-ghost small" style={{ flex: "1 1 auto" }}
                            title="You turned his price down">Lost</button>
                          <button formAction={stepOut.bind(null, id, pkgId, b.id, "declined")}
                            className="btn btn-ghost small" style={{ flex: "1 1 auto" }}
                            title="He never priced it">He declined</button>
                          {hasNumber && (
                            <button formAction={stepOut.bind(null, id, pkgId, b.id, "withdrawn")}
                              className="btn btn-ghost small" style={{ flex: "1 1 auto" }}
                              title="He gave a price and pulled it">He withdrew</button>
                          )}
                        </div>
                        <p className="tiny text-muted" style={{ margin: 0 }}>
                          <strong>Lost</strong> is you turning his price down. <strong>Declined</strong> and{" "}
                          <strong>withdrew</strong> are him taking himself out — and they close his link so a price
                          cannot arrive after he has said he is gone.
                        </p>
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

              {/* WHO DOES THIS TRADE (188c). The trade is the question, not
                  "who happens to be a member of this project" - which was the
                  old list, and on a real job is the surveyor, the insurance
                  broker and the portable toilet company. A name search still
                  reaches every contact, because you are often standing in
                  front of somebody whose trade nobody has recorded yet. */}
              <div style={{ marginTop: 10 }}>
                <RoomPeople pkgId={pkgId} roomTrade={p.trade} action={addKnownToRoom.bind(null, id, pkgId)} />
              </div>

              <div className="divider-label" style={{ marginTop: 14 }}>Somebody new</div>
              <form action={addToRoom.bind(null, id, pkgId)} className="stack" style={{ gap: 8, marginTop: 6 }}>
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

        {closed && !p.awarded_bid_id && (
          <Notice title="This package is closed.">
            Nobody won it. Reopen it from the portal if replies should come back in.
          </Notice>
        )}

        {/* AWARDED - AND IT CAN BE TAKEN BACK (210).
            Shahar, 2026-09-21: "fix all gaps."

            Awarding was one-way. portal_bid_award refuses a second award
            with "This package is already awarded" and nothing could clear
            that, so picking the wrong man ended the room. The only way back
            was the portal's package editor, which takes a status and has no
            awarded guard - a back door that leaves the contract, the seat
            and every losing bid still pointing at the award you thought you
            had undone.

            Folded, because undoing an award is rare and pressing it by
            accident is not. What it will and will not do is written above
            the box rather than discovered afterwards: the database refuses
            once money has moved, and the seat stays on purpose. */}
        {p.awarded_bid_id && (
          <>
            <Notice title="This package is awarded.">
              The contract and its payment schedule live on the money page.
            </Notice>
            {canWrite && (
              <details className="card pad">
                <summary className="small" style={{ cursor: "pointer", fontWeight: 700 }}>
                  Awarded the wrong bid?
                </summary>
                <form action={unaward.bind(null, id, pkgId)} className="stack" style={{ gap: 8, marginTop: 10 }}>
                  <p className="tiny text-muted" style={{ margin: 0 }}>
                    This reopens the room, puts every bid back to where it stood before the award, and cancels the
                    contract the award created. It is <strong>refused</strong> once a payment, a claimed payment
                    stage or an open task hangs off that contract — and it will say how many it found.
                  </p>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label htmlFor="unaward-why">Why it is being undone</label>
                    <input id="unaward-why" name="reason" className="input" required
                      placeholder="He cannot start until November" />
                  </div>
                  <button className="btn btn-ghost btn-block">Undo the award</button>
                  <p className="tiny text-muted" style={{ margin: 0 }}>
                    His seat on the job is <strong>left in place</strong> — work may already be assigned to him, and
                    quietly taking a seat away is how a task ends up owned by nobody. Remove it from the team screen
                    if that is what you want.
                  </p>
                </form>
              </details>
            )}
          </>
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
