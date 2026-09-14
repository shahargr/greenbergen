import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";
import { shortDate } from "@shared/format";
import { stopwatch } from "@shared/perf";
import { AppBar, Card, ChevronIcon, Notice, Screen } from "@shared/ui";
import { awardTrade } from "./actions";

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
  seat: string | null; since: string | null;
  contract_id: string | null; contract: string | null; contract_status: string | null; trade: string | null;
};
type Board = {
  project_name: string | null; may_award: boolean; takes_work: boolean;
  awarded: Awarded[]; people: Person[];
};

export default async function AwardPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string; ok?: string; error?: string; trade?: string }>;
}) {
  const { id } = await params;
  const { back, ok, error, trade: pickedRaw } = await searchParams;
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

  const b: Board = boardData ?? { project_name: null, may_award: false, takes_work: true, awarded: [], people: [] };
  const trades = (tradeRows ?? []).map((t) => t.trade).filter((t) => t !== "ALL" && t !== "Meta");
  const picked = pickedRaw && trades.includes(pickedRaw) ? pickedRaw : "";

  // Whoever works the chosen trade first, then everybody else. Never a
  // filtered list: the man who has only ever framed for you may still be the
  // one you hand the stairs to, and hiding him would make this screen lie
  // about who you know.
  const people = [...b.people].sort((a, c) => {
    const am = picked && a.trades.includes(picked) ? 0 : 1;
    const cm = picked && c.trades.includes(picked) ? 0 : 1;
    return am - cm || a.name.localeCompare(c.name);
  });
  const matches = picked ? people.filter((p) => p.trades.includes(picked)).length : 0;

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
                  {trades.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <p className="hint" style={{ margin: 0 }}>
                  {picked
                    ? matches > 0
                      ? `${matches} ${matches === 1 ? "person you know does" : "people you know do"} ${picked.toLowerCase()} — they are at the top of the list.`
                      : `Nobody on your list works ${picked.toLowerCase()} yet. Add them below.`
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
                  <option value="">Choose someone…</option>
                  {people.map((p) => (
                    <option key={p.contact_id} value={p.contact_id}>
                      {[p.name, p.company && p.company !== p.name ? p.company : null,
                        p.trades.length > 0 ? p.trades.slice(0, 2).join(", ") : null,
                        p.here ? "on this job" : null].filter(Boolean).join(" · ")}
                    </option>
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
              This opens a placeholder contract — no value, no scope. Agree the terms on{" "}
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
                  : `${b.awarded.filter((a) => a.contract_status === "placeholder").length} still on a placeholder contract`}
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
                      a.contract_status === "placeholder" ? "terms not agreed yet" : a.contract_status,
                      a.since ? `since ${shortDate(a.since)}` : null].filter(Boolean).join(" · ")}
                  </span>
                </span>
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
