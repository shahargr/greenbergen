import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";
import { shortDate } from "@shared/format";
import { stopwatch } from "@shared/perf";
import { AppBar, Card, ChevronIcon, Notice, Screen } from "@shared/ui";
import { awardTrade, removeSeat } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Award work" };

// HANDING A TRADE THE WORK.
//
// Shahar (2026-09-14): "as a GC i'd like to award business. how do i do this?"
// then, having watched it done for him once: "i need that screen, as i will
// award a stairs guy soon."
//
// So: the shortest path from "it's yours" to a job that says so. Pick the
// trade, pick the man, press the button. What it writes is a contractor seat
// bounded by a contract - a PLACEHOLDER contract, with no value and nothing
// agreed, because saying the work is his and settling the terms are two
// different conversations and pretending otherwise puts a number in the
// ledger that nobody ever said out loud.
//
// Bidding is the other door, and it is still there: this screen links to it
// rather than replacing it. A GC who already knows who is doing the stairs
// should not have to run a bid round to say so.
type Person = { contact_id: string; name: string; company: string | null; trades: string[]; here: boolean };
type Awarded = {
  member_id: string; contact_id: string | null; name: string; company: string | null;
  seat: string | null; since: string | null; may_remove: boolean;
  contract_id: string | null; contract: string | null; contract_status: string | null; trade: string | null;
  contract_amount: number | null;
};
// A CONTRACT ALREADY ON THE JOB (migration 154). Shahar: "i believe previous
// design allowed me to award to an existing contract, or open a new contract
// if necessary... so i can document few closed contracts, including pest
// control." Closed ones are in the list on purpose - a finished contract with
// nobody seated on it is exactly the past work there is to document.
type Contract = {
  id: string; title: string; status: string | null; type: string | null;
  trade: string | null; trade_known: string | null; amount: number | null;
  signed: string | null; who: string | null; company: string | null; seats: number;
  /** What the contract's party works - how a loan note with no trade on it is a finance contract. */
  party_trades: string[];
};
type Board = {
  project_name: string | null; may_award: boolean; takes_work: boolean;
  needs: string[]; awarded: Awarded[]; people: Person[]; contracts: Contract[];
};

// Running the job is not a thing you put out to bid, so it is never in the
// job's needs - and it is the first thing a GC awards. The two seats live
// here rather than in the database pretending to be needs.
const RUNNING = ["General Contractor", "Project manager"];

// How a person reads in the list. Shahar, awarding a project manager: "why
// it shows framing?" - because the label took the first two trades on file
// alphabetically, and sg.other+2 put Plumbing, Electrical, Framing and
// Handyman on their own profile back in September. So the trade being
// awarded leads, and the rest follow it instead of pushing it out.
function personLabel(p: Person, picked: string) {
  const ts = picked && p.trades.includes(picked)
    ? [picked, ...p.trades.filter((t) => t !== picked)]
    : p.trades;
  const shown = ts.slice(0, 3);
  const more = ts.length - shown.length;
  return [
    p.name,
    p.company && p.company !== p.name ? p.company : null,
    shown.length > 0 ? shown.join(", ") + (more > 0 ? ` +${more}` : "") : null,
    p.here ? "on this job" : null,
  ].filter(Boolean).join(" · ");
}

export default async function AwardPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string; ok?: string; error?: string; trade?: string; all?: string }>;
}) {
  const { id } = await params;
  const { back, ok, error, trade: pickedRaw, all } = await searchParams;
  const showAll = all === "1";
  const to = back && back.startsWith("/") && !back.startsWith("//") ? back : `/project/${id}`;

  const w = stopwatch("/project/[id]/award");
  const supabase = await createClient();
  const { data: claims } = await w.step("claims", () => supabase.auth.getClaims());
  if (!claims?.claims?.sub) redirect(`/login?next=${encodeURIComponent(`/project/${id}/award`)}`);

  const [{ data: boardData }, { data: tradeRows }] = await Promise.all([
    w.step("board", () => rpc<Board>(supabase, "portal_award_board", { p_project: id })),
    w.step("trades", async () => await supabase.from("trades")
      .select("trade, sort_order, is_construction, is_supply")
      .order("sort_order", { ascending: true, nullsFirst: false })),
  ]);
  w.done();

  const b: Board = boardData ?? { project_name: null, may_award: false, takes_work: true, needs: [], awarded: [], people: [], contracts: [] };
  const trades = (tradeRows ?? []).map((t) => t.trade).filter((t) => t !== "ALL" && t !== "Meta");
  const picked = pickedRaw && trades.includes(pickedRaw) ? pickedRaw : "";

  // WHICH TRADES THIS JOB COULD USE. Shahar: "every job needs to have a clear
  // list of possible trade people to award... generator should have
  // electrician, plumber, landscape, GC and project manager." Eighty trades in
  // one row is not a list, it is a haystack - so the job's own answer goes
  // first and everything else stays reachable underneath.
  const inOrder = (names: string[]) => trades.filter((t) => names.includes(t));
  const needs = inOrder(b.needs ?? []);
  const running = inOrder(RUNNING);
  const held = inOrder([...new Set(b.awarded.map((a) => a.trade).filter((t): t is string => !!t))])
    .filter((t) => !needs.includes(t) && !running.includes(t));
  const led = [...needs, ...running, ...held];
  const rest = trades.filter((t) => !led.includes(t));

  // ONLY THE PEOPLE WHO WORK THE TRADE. The first cut sorted everybody with
  // the matches on top, on the grounds that the man who has only ever framed
  // for you may still be the one you hand the stairs to. Shahar, looking at
  // Finance with fifty names under two brokers (2026-09-16): "update this so
  // only people with the right trade are visible." He is right about the
  // common case, so the list is filtered - and the rare case keeps one link,
  // "show everyone", rather than being designed out.
  const everyone = [...b.people].sort((a, c) => a.name.localeCompare(c.name));
  const matches = picked ? everyone.filter((p) => p.trades.includes(picked)).length : 0;
  const people = picked && !showAll && matches > 0
    ? everyone.filter((p) => p.trades.includes(picked))
    : everyone;
  const hereWith = (params: Record<string, string>) =>
    `/project/${id}/award?${new URLSearchParams({ trade: picked, back: to, ...params }).toString()}`;

  // THE CONTRACTS THAT ARE ABOUT THIS TRADE. Named for it, or naming no
  // trade at all but with a party who works it - the construction loan note
  // has no trade on it and belongs under Finance because the lender does
  // finance. Shahar: "i see none related contracts which makes it hard to
  // find the right one." The rest are one link away, same as the people.
  const about = (x: Contract) =>
    !picked || x.trade_known === picked || (x.trade === null && (x.party_trades ?? []).includes(picked));
  const allContracts = [...(b.contracts ?? [])].sort((a, c) => {
    const rank = (x: Contract) =>
      picked && x.trade_known === picked ? 0
      : x.trade === null ? 1
      : x.status === "Cancelled" ? 3 : 2;
    return rank(a) - rank(c) || (a.title ?? "").localeCompare(c.title ?? "");
  });
  const related = allContracts.filter(about);
  const contracts = picked && !showAll ? related : allContracts;
  const contractLabel = (c: Contract) => [
    c.title,
    c.status === "placeholder" ? "placeholder" : c.status?.toLowerCase() ?? null,
    c.amount != null ? `$${Math.round(Number(c.amount)).toLocaleString("en-US")}` : null,
    c.signed ? shortDate(c.signed) : null,
    c.seats > 0 ? `${c.seats} seated` : "nobody seated",
  ].filter(Boolean).join(" · ");
  const forTrade = related.length;

  if (!b.may_award) {
    return (
      <Screen>
        <AppBar back={to} title="Award work" sub={b.project_name ?? undefined} />
        <div className="body">
          <Card soft pad><div className="small">Handing out work on this job is not yours to do.</div></Card>
        </div>
      </Screen>
    );
  }

  return (
    <Screen>
      <AppBar back={to} title="Award work" sub={b.project_name ?? undefined} />
      <div className="body">
        {ok && <div className="banner-ok">{ok}</div>}
        {error && <Notice kind="error" title="Not awarded.">{error}</Notice>}

        {!b.takes_work && (
          <Notice kind="error" title="This is the property, not a job.">
            Work is awarded on one of the projects under it. Open the job and come back.
          </Notice>
        )}

        <div className="hero">
          <h1 style={{ fontSize: 22 }}>Who is doing it?</h1>
          <p className="lead">
            Hand a trade the work and the job says so: they take a seat on it, and a contract opens
            for the two of you to fill in. Nothing here agrees a price.
          </p>
        </div>

        {b.takes_work && (
          <form action={awardTrade.bind(null, id)} className="stack" style={{ gap: 14 }}>
            <div className="task-row">
              <div className="task-row-label">
                Trade
                <div className="text-muted">What the work is</div>
              </div>
              <div className="task-row-value">
                {/* The trade goes in the URL as well as the form, so choosing
                    it re-sorts the people below without JavaScript. */}
                <select name="trade" className="input" defaultValue={picked}>
                  <option value="">Not one of these</option>
                  {needs.length > 0 && (
                    <optgroup label="This job needs">
                      {needs.map((t) => <option key={t} value={t}>{t}</option>)}
                    </optgroup>
                  )}
                  {running.length > 0 && (
                    <optgroup label="Running the job">
                      {running.map((t) => <option key={t} value={t}>{t}</option>)}
                    </optgroup>
                  )}
                  {held.length > 0 && (
                    <optgroup label="Already on this job">
                      {held.map((t) => <option key={t} value={t}>{t}</option>)}
                    </optgroup>
                  )}
                  <optgroup label="Every other trade">
                    {rest.map((t) => <option key={t} value={t}>{t}</option>)}
                  </optgroup>
                </select>
                <p className="hint" style={{ margin: 0 }}>
                  {picked
                    ? matches > 0
                      ? <>{matches} {matches === 1 ? "person you know does" : "people you know do"} {picked.toLowerCase()}
                          {showAll
                            ? <> — everyone is listed. <Link href={hereWith({})}>Only them</Link>.</>
                            : <> — only they are listed. <Link href={hereWith({ all: "1" })}>Show everyone</Link>.</>}</>
                      : `Nobody on your list works ${picked.toLowerCase()} yet, so everyone is listed. Or add them below.`
                    : needs.length > 0
                      ? `This job needs ${needs.length === 1 ? needs[0].toLowerCase() : `${needs.slice(0, -1).join(", ").toLowerCase()} and ${needs[needs.length - 1].toLowerCase()}`}. Every other trade is in the list too.`
                      : "Pick it and the people who work it come to the top."}
                </p>
                {/* Choosing without submitting: a link per trade would be
                    eighty links, so this is the one place the list is asked
                    for by name. */}
                {trades.length > 0 && (
                  <details>
                    <summary className="tiny text-muted" style={{ cursor: "pointer" }}>
                      Sort the people by a trade first
                    </summary>
                    <div className="chips" style={{ marginTop: 8 }}>
                      {trades.map((t) => (
                        <Link key={t} href={`/project/${id}/award?trade=${encodeURIComponent(t)}&back=${encodeURIComponent(to)}`}
                          aria-current={picked === t ? "page" : undefined}
                          className={`tag ${picked === t ? "" : "tag-neutral"}`}
                          style={{ textDecoration: "none", padding: "7px 12px", fontSize: 12 }}>{t}</Link>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </div>

            <div className="task-row">
              <div className="task-row-label">
                Who
                <div className="text-muted">People you already work with</div>
              </div>
              <div className="task-row-value">
                <select name="contact" className="input" defaultValue="">
                  <option value="">Choose someone — or whoever the contract names</option>
                  {people.map((p) => (
                    <option key={p.contact_id} value={p.contact_id}>{personLabel(p, picked)}</option>
                  ))}
                </select>

                {/* THE STAIRS GUY WHO IS NOT ON FILE. Making him on another
                    screen and coming back is two screens and a lost thought. */}
                <details open={!!error}>
                  <summary className="tiny text-muted" style={{ cursor: "pointer" }}>
                    Not on the list? Add them here
                  </summary>
                  <div className="stack" style={{ gap: 8, marginTop: 8 }}>
                    <input className="input" name="name" placeholder="Their name" aria-label="Their name" />
                    <input className="input" name="company" placeholder="Company (optional)" aria-label="Company" />
                    <div className="row" style={{ gap: 8 }}>
                      <input className="input grow" name="phone" inputMode="tel" placeholder="Phone" aria-label="Phone" />
                      <input className="input grow" name="email" type="email" placeholder="Email" aria-label="Email" />
                    </div>
                    <p className="hint" style={{ margin: 0 }}>
                      A name is enough. A name we already have is the same person, not a second one.
                    </p>
                  </div>
                </details>
              </div>
            </div>

            {/* THE CONTRACT IT LANDS ON. "New" opens a placeholder, as it
                always did. Picking one that exists binds the seat to it and
                opens nothing - so the signed Masonry contract stops sharing
                the job with a placeholder twin, and a contract that was
                Complete in May can finally say who did the work. */}
            <div className="task-row">
              <div className="task-row-label">
                Contract
                <div className="text-muted">One that exists, or a new one</div>
              </div>
              <div className="task-row-value">
                <select name="contract" className="input" defaultValue="">
                  <option value="">Open a new one — awarded now, terms agreed later</option>
                  {contracts.length > 0 && (
                    <optgroup label={picked && !showAll ? `About ${picked.toLowerCase()}` : "Already on this job"}>
                      {contracts.map((c) => (
                        <option key={c.id} value={c.id}>{contractLabel(c)}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <p className="hint" style={{ margin: 0 }}>
                  {allContracts.length === 0
                    ? "No contracts on this job yet, so this award opens the first."
                    : picked
                      ? <>{forTrade === 0
                            ? <>No contract on this job is about {picked.toLowerCase()} yet, so a new one opens</>
                            : <>{forTrade} {forTrade === 1 ? "contract on this job is" : "contracts on this job are"} about {picked.toLowerCase()}</>}
                          {showAll
                            ? <> — every contract is listed. <Link href={hereWith({})}>Only those</Link>.</>
                            : <>. <Link href={hereWith({ all: "1" })}>Show every contract</Link>.</>}
                          {" "}Pick one and the seat is bound to it — nothing new opens. A closed contract is how past work
                          gets documented; leave “Who” blank and the person is read off it.</>
                      : "Pick one and the seat is bound to it — nothing new opens. A closed contract is how past work gets documented; leave “Who” blank and the person is read off it."}
                </p>
              </div>
            </div>

            <div className="task-row">
              <div className="task-row-label">
                Note
                <div className="text-muted">Why them, what was said</div>
              </div>
              <div className="task-row-value">
                <textarea className="input" name="note" rows={2}
                  placeholder="Walked it with him Tuesday, holding his number from the framing job…" />
              </div>
            </div>

            <button className="btn btn-primary btn-block">Award it</button>
            <p className="tiny text-muted" style={{ margin: 0, textAlign: "center" }}>
              With no contract picked this opens one, awarded, with no value and no scope yet. Agree the terms on{" "}
              <Link href={`/project/${id}/money`}>the job&apos;s money screen</Link>.
            </p>
          </form>
        )}

        {/* WHO ALREADY HOLDS WHAT. The answer to "did I already give this to
            someone", which is the question you ask a second before you award
            it twice. */}
        <details className="home-panel" open={b.awarded.length > 0 && b.awarded.length <= 6}>
          <summary className="home-row">
            <span className="grow" style={{ minWidth: 0 }}>
              <span className="t">Already on this job · {b.awarded.length}</span>
              <span className="m" style={{ display: "block" }}>
                {b.awarded.length === 0
                  ? "Nobody holds a contract here yet."
                  : [
                      `${b.awarded.filter((a) => a.contract_id !== null && a.contract_amount == null && a.contract_status !== "Complete").length} with terms still to agree`,
                      b.awarded.some((a) => a.contract_id === null)
                        ? `${b.awarded.filter((a) => a.contract_id === null).length} with no contract at all`
                        : null,
                    ].filter(Boolean).join(" · ")}
              </span>
            </span>
            <span className="chev"><ChevronIcon /></span>
          </summary>
          <div className="drawer stack" style={{ gap: 0, paddingTop: 6 }}>
            {b.awarded.map((a) => (
              <div className="home-row" key={a.member_id}>
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="t">{a.trade ?? a.seat ?? "Work"} — {a.name}</span>
                  <span className="m" style={{ display: "block" }}>
                    {[a.company && a.company !== a.name ? a.company : null,
                      // No contract behind a seat is worth saying plainly, not
                      // leaving blank — it is the thing that needs fixing.
                      // "Terms not agreed" is the EMPTY AMOUNT, not a status:
                      // an award is awarded from the moment you press the
                      // button (migration 155), and the number comes later.
                      a.contract_id === null ? "no contract behind this seat"
                        : a.contract_status === "Complete" ? "contract complete"
                        : a.contract_amount == null ? `${a.contract_status === "placeholder" ? "placeholder" : a.contract_status ?? "contract"} · terms not agreed yet`
                        : a.contract_status,
                      a.since ? `since ${shortDate(a.since)}` : null].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {a.may_remove && (
                  <form action={removeSeat.bind(null, id, a.member_id)}>
                    <button className="btn btn-ghost small" title={`Take ${a.name} off this job`}>Take off</button>
                  </form>
                )}
              </div>
            ))}
          </div>
        </details>

        <Card soft pad>
          <div className="small">
            Don&apos;t know who yet? Put it out to bid instead: write the scope, invite trades, take
            their numbers, award the one you want.{" "}
            <Link href={`/project/${id}?panel=bids`}>Bid packages</Link>
          </div>
        </Card>
      </div>
    </Screen>
  );
}
