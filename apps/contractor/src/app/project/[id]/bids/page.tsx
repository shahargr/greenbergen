import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";
import { shortDate } from "@shared/format";
import { stopwatch } from "@shared/perf";
import { AppBar, Card, ChevronIcon, Notice, Screen } from "@shared/ui";
import { getBoard, money, runs } from "@/lib/board";
import { openRoom, dropTrade } from "./actions";

export const dynamic = "force-dynamic";

// EVERY TRADE REQUIRES A BID, AND THE BOARD SAYS WHERE EACH ONE GOT TO.
//
// Shahar (2026-09-17): "every trade by default requires a bid. if work
// started flag the bid as completed... for open bids, we need to start by
// adding people or companies into the bid room."
//
// The state is derived, never stored (portal_bid_board): WON when a contract
// or a working line names somebody, OPEN when a room is running, NOT STARTED
// otherwise. The job's trade list already is the bid list (migration 164), so
// "every trade requires a bid" needed no new bookkeeping - only somewhere to
// see it.
//
// The order is the order of attention: what is running, then what has not
// been started, then the settled ones folded away. A won trade is a fact you
// look up, not a thing you act on.
type Row = {
  trade: string;
  stage: string | null;
  panel: string | null;
  state: "won" | "open" | "none";
  who: string | null;
  amount: number | null;
  awarded_on: string | null;
  contract_id: string | null;
  package_id: string | null;
  reply_by: string | null;
  invited: number;
  replied: number;
  scope_lines: number;
  // Every project_bid_needs row behind this trade, across the family - a
  // trade the job needs twice is two rows, and dropping it has to take both.
  need_ids: string[] | null;
};

export default async function BidBoardPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; add?: string; drop?: string; who?: string }>;
}) {
  const { id } = await params;
  const { ok, error, add, drop, who } = await searchParams;

  const w = stopwatch("/project/[id]/bids");
  const supabase = await createClient();
  const [board, { data }] = await Promise.all([
    w.step("board", () => getBoard()),
    w.step("bids", () => rpc<{ trades: Row[] }>(supabase, "portal_bid_board", { p_project: id })),
  ]);
  w.done();
  if (!board.signed_in) redirect(`/login?next=${encodeURIComponent(`/project/${id}/bids`)}`);
  const seat = board.seats.find((s) => s.project_id === id);
  if (!seat) notFound();
  // portal_bid_board returns nothing at all to somebody who may not run a
  // bid, so an empty read and a refusal look the same - and both mean go back.
  if (!data || !Array.isArray(data.trades)) redirect(`/project/${id}`);
  const manages = runs(seat);

  const rows = data.trades;
  const open = rows.filter((r) => r.state === "open");
  const none = rows.filter((r) => r.state === "none");
  const won = rows.filter((r) => r.state === "won");
  const waiting = open.reduce((n, r) => n + (r.invited - r.replied), 0);

  return (
    <Screen>
      <AppBar back={`/project/${id}`} title={
        <span className="crumbs">
          <Link href={`/project/${id}`}>{seat.project_name}</Link>
          <span className="sep" aria-hidden>›</span>
          <span className="leaf">Bids</span>
        </span>
      } />
      <div className="body">
        {error && <Notice kind="error">{error}</Notice>}
        {ok === "opened" && <div className="banner-ok">Room opened. Put somebody in it.</div>}
        {ok === "dropped" && <div className="banner-ok">{who || "That trade"} is off this job&apos;s board.</div>}

        <div className="tiles quad" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
          <Stat n={String(open.length)} label="out to bid" tone={open.length > 0 ? "bid" : undefined} />
          <Stat n={String(none.length)} label="not started" />
          <Stat n={String(won.length)} label="awarded" />
        </div>

        {/* OUT TO BID. The rooms that are running, and how far each got. */}
        {open.length > 0 && (
          <section className="stack" style={{ gap: 8 }}>
            <div className="divider-label">
              Out to bid · {open.length}
              {waiting > 0 && <span style={{ fontWeight: 700 }}>&nbsp;· {waiting} yet to reply</span>}
            </div>
            {open.map((r) => (
              <Link key={r.trade} className="home-row" href={`/project/${id}/bids/${r.package_id}`}>
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="t">{r.trade}</span>
                  <span className="m" style={{ display: "block" }}>
                    {[
                      r.invited === 0 ? "nobody in the room yet"
                        : `${r.invited} in the room · ${r.replied} replied`,
                      r.scope_lines > 0 ? `${r.scope_lines} scope line${r.scope_lines === 1 ? "" : "s"}` : "no scope written",
                      r.reply_by ? `reply by ${shortDate(r.reply_by)}` : null,
                    ].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {r.invited === 0
                  ? <span className="tag tag-status" style={{ whiteSpace: "nowrap" }}>empty</span>
                  : r.replied === 0
                    ? <span className="tag tag-outline" style={{ whiteSpace: "nowrap" }}>waiting</span>
                    : <span className="tag tag-accent" style={{ whiteSpace: "nowrap" }}>{r.replied} in</span>}
                <ChevronIcon />
              </Link>
            ))}
          </section>
        )}

        {/* NOT STARTED. A trade the job needs with nobody approached. One
            tap opens the room; the form is one line because standing on site
            after meeting somebody is when this gets pressed. */}
        {none.length > 0 && (
          <section className="stack" style={{ gap: 8 }}>
            <div className="divider-label">Not started · {none.length}</div>
            {none.map((r) => {
              const opening = add === r.trade;
              const dropping = drop === r.trade;
              return (
                <div key={r.trade} className={opening || dropping ? "card pad stack" : undefined}
                  style={opening || dropping ? { gap: 10 } : undefined}>
                  {dropping && (
                    <form action={dropTrade.bind(null, id)} className="stack" style={{ gap: 8 }}>
                      <input type="hidden" name="trade" value={r.trade} />
                      <div className="small" style={{ fontWeight: 800 }}>Take {r.trade} off this board?</div>
                      <p className="tiny text-muted" style={{ margin: 0 }}>
                        The job stops saying it needs {r.trade.toLowerCase()}.
                        {r.scope_lines > 0
                          ? ` The ${r.scope_lines} scope line${r.scope_lines === 1 ? "" : "s"} written for it stay on the job — this is the bid board, not the scope.`
                          : " Nothing else is touched."}
                        {" "}Nobody has been approached and nothing has been let, so there is no price to lose. Add it
                        back any time.
                      </p>
                      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                        <button className="btn btn-secondary" style={{ flex: "1 1 auto" }}>Take it off</button>
                        <Link href={`/project/${id}/bids`} className="btn btn-ghost" scroll={false}>Keep it</Link>
                      </div>
                    </form>
                  )}
                  {!opening && !dropping && (
                    <div className="home-row" style={{ cursor: "default" }}>
                      <span className="grow" style={{ minWidth: 0 }}>
                        <span className="t">{r.trade}</span>
                        <span className="m" style={{ display: "block" }}>
                          {r.scope_lines > 0
                            ? `${r.scope_lines} scope line${r.scope_lines === 1 ? "" : "s"} written, nobody approached`
                            : "Nobody approached, no scope written"}
                        </span>
                      </span>
                      {manages && (
                        <span className="row" style={{ gap: 6, flex: "none" }}>
                          <Link href={`/project/${id}/bids?add=${encodeURIComponent(r.trade)}`}
                            className="btn btn-secondary" style={{ minHeight: 34, padding: "4px 12px", fontSize: 12 }}
                            scroll={false}>
                            Open a room
                          </Link>
                          {/* OFF THE BOARD (188d). A trade nobody has been
                              approached about and nothing was let on is a line
                              somebody typed, not work - and it asks to be
                              acted on forever until it can be taken off. */}
                          <Link href={`/project/${id}/bids?drop=${encodeURIComponent(r.trade)}`}
                            className="btn btn-ghost" style={{ minHeight: 34, padding: "4px 10px", fontSize: 12 }}
                            title={`Take ${r.trade} off this board`} aria-label={`Take ${r.trade} off this board`}
                            scroll={false}>✕</Link>
                        </span>
                      )}
                    </div>
                  )}
                  {opening && (
                    <form action={openRoom.bind(null, id)} className="stack" style={{ gap: 8 }}>
                      <input type="hidden" name="trade" value={r.trade} />
                      <div className="small" style={{ fontWeight: 800 }}>Open the {r.trade.toLowerCase()} room</div>
                      <p className="tiny text-muted" style={{ margin: 0 }}>
                        {r.scope_lines > 0
                          ? `The ${r.scope_lines} scope line${r.scope_lines === 1 ? "" : "s"} already written for this trade become the rows every bid is judged against.`
                          : "No scope is written for this trade yet. Open the room and write it there — the lines you type become the rows of the comparison."}
                      </p>
                      <div className="nb-two">
                        <label className="nb-fld">
                          <span>Reply by</span>
                          <input className="input" type="date" name="reply_by" />
                        </label>
                        <label className="nb-fld">
                          <span>What it is for</span>
                          <input className="input" name="summary" placeholder="Optional — one line" />
                        </label>
                      </div>
                      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                        <button className="btn btn-primary" style={{ flex: "1 1 auto" }}>Open it</button>
                        <Link href={`/project/${id}/bids`} className="btn btn-ghost" scroll={false}>Cancel</Link>
                      </div>
                    </form>
                  )}
                </div>
              );
            })}
          </section>
        )}

        {/* AWARDED. Folded, because a settled trade is a fact you look up
            rather than a thing you act on. */}
        {won.length > 0 && (
          <details className="home-panel">
            <summary className="home-row">
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="t">Awarded · {won.length}</span>
                <span className="m" style={{ display: "block" }}>
                  {money(won.reduce((n, r) => n + (r.amount ?? 0), 0))} across the trades that carry a number
                </span>
              </span>
              <span className="chev"><ChevronIcon /></span>
            </summary>
            <div className="drawer stack" style={{ gap: 0, paddingTop: 10 }}>
              <div className="bucket-rows">
                {/* A settled trade opens its room when it had one - that is
                    where the prices and who lost are written down - and the
                    trade screen when the work was let without a room. */}
                {won.map((r) => (
                  <Link key={r.trade}
                    href={r.package_id ? `/project/${id}/bids/${r.package_id}` : `/project/${id}/trade/${encodeURIComponent(r.trade)}`}>
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="t">{r.trade}</span>
                      <span className="m">
                        {[r.who ?? "nobody named", r.awarded_on ? shortDate(r.awarded_on) : null].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    {r.amount != null && (
                      <span className="tag tag-neutral" style={{ whiteSpace: "nowrap" }}>{money(r.amount)}</span>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          </details>
        )}

        {rows.length === 0 && (
          <Card soft pad>
            <div className="small">No trades on this job yet.</div>
            <div className="tiny text-muted" style={{ marginTop: 4 }}>
              A trade joins the job when it is named on a task, a contract or a bid room.
            </div>
          </Card>
        )}

        <p className="tiny text-muted" style={{ margin: 0 }}>
          A trade counts as awarded when a contract or a working line names somebody on it. Nothing is stored twice:
          this is the same trade list the job screen draws.
        </p>
      </div>
    </Screen>
  );
}

function Stat({ n, label, tone }: { n: string; label: string; tone?: "bid" }) {
  return (
    <div className="tile" style={{ minHeight: 0, alignItems: "flex-start", textAlign: "left", gap: 2, padding: "12px 12px 10px" }}>
      <div className="mono" style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 22,
        color: tone === "bid" ? "var(--color-bid)" : undefined }}>{n}</div>
      <div className="tiny text-muted">{label}</div>
    </div>
  );
}
