import Link from "next/link";
import { TradeIllustration } from "@shared/Illustrations";

// A JOB IS ITS TRADES, IN ORDER, ON ONE SCREEN.
//
// Shahar (2026-09-15): "I would like to start by seeing all the trades, the
// panels for all the different trades and what is currently being worked
// on... I want you to know how the trades are sequenced on a project."
//
// And then, looking at the first version of it: "when i log in as a trade
// owner, and see all the panels, its a long list. maybe better to list it as
// 4 by 4 panels, allowing to present 16 trades on one screen. color will help
// me see which are active, which has not started, and which requires a bid."
//
// He is right, and the reason is worth writing down: a row is the right shape
// for a list you READ and the wrong shape for a board you SCAN. Twenty-three
// trades as rows is a page and a half of scrolling to answer "where is this
// house". Twenty-three trades as a four-wide grid is one screen, and the
// answer arrives before you have read a single word - because the state is
// carried by colour and only confirmed by the label.
//
// So: no stage headings breaking the grid into nine stubby rows. The sequence
// is the ORDER, which is what a sequence is; the stage is an eyebrow on each
// tile, so every tile still says where in the build it sits.
export type SpineTrade = {
  trade: string;
  stage: string | null;
  art: string | null;
  open: number;
  late: number;
  done: number;
  next_due: string | null;
  /** idle = the job needs it and nobody has been called · appointed = under a
   *  signed or awarded contract with nothing open · hiring = choosing ·
   *  working = appointed and under way · loose = open work, nothing behind it */
  state: "idle" | "appointed" | "hiring" | "working" | "loose";
  /** Whether a signed or awarded contract covers this trade. */
  awarded: boolean;
  who: string | null;
  now: { id: string; action: string; target_date: string | null }[];
};

export type Spine = {
  trades: SpineTrade[];
  untagged: { open: number; late: number };
};

// THREE THINGS HE ASKED TO SEE AT A GLANCE - "which are active, which has not
// started, and which requires a bid" - and a fourth the data insists on.
//
// `loose` is work happening with no package and no signed agreement behind
// it. It is active, so it is not grey; it is not settled, so it is not green.
// Folding it into either would be the screen telling a comfortable lie about
// a real state of a real job.
const SAY: Record<SpineTrade["state"], string> = {
  working: "on the job",
  appointed: "appointed",
  hiring: "bid out",
  loose: "open work",
  idle: "not started",
};

// A STAGE NAME HAS TO FIT IN EIGHTY PIXELS OR IT IS NOT A LABEL.
//
// The first cut put the whole stage on the tile and every one of them
// truncated: "BUY AND ...", "SITE PRE...", "ROUGH A...", "STAIRS A...". Nine
// tiles wearing an ellipsis is not information, it is texture.
//
// The first word is the whole answer - Buy, Survey, Site, Rough, Stairs,
// Finishing, Outdoor, Suppliers, Others - all of them short, all of them
// distinct, and no map to keep in step with the trade_stages table. The full
// name is on the tile's tooltip for anybody who wants it.
const shortStage = (stage: string) => stage.split(/[\s&]+/)[0];

export function TradeSpine({ projectId, spine, manages, back, allTasksHref }: {
  projectId: string;
  spine: Spine;
  /** Whether this person runs the job - only they are offered the idle trades. */
  manages: boolean;
  back: string;
  allTasksHref: string;
}) {
  // EVERY TILE IS A DOOR.
  //
  // Shahar (2026-09-16): "why am I unable to enter demo panel, and log the
  // work on it. any reason why I cannot enter each of these where tasks are
  // not there to manage?"
  //
  // No reason at all, and the first cut was wrong about it. An idle tile was a
  // BUTTON whose only move was "run the bid", on the assumption that a trade
  // with no tasks has nothing to look at. But the trade screen is exactly
  // where you log the first one - it carries the quick-task box, the scope and
  // the contracts - so refusing entry until work exists means you can never
  // create the work. Every tile is a link now, whatever state it is in, and
  // starting the engagement moved inside where there is room to offer both
  // ways of doing it.
  const live = spine.trades.filter((t) => t.state !== "idle");
  const idle = manages ? spine.trades.filter((t) => t.state === "idle") : [];
  if (live.length === 0 && idle.length === 0 && spine.untagged.open === 0) return null;

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const totalLate = live.reduce((n, t) => n + t.late, 0) + spine.untagged.late;
  const count = (k: SpineTrade["state"]) => live.filter((t) => t.state === k).length;

  const face = (t: SpineTrade) => (
    <>
      <span className="art" aria-hidden><TradeIllustration name={t.art} /></span>
      {t.stage && <span className="st">{shortStage(t.stage)}</span>}
      <span className="t">{t.trade}</span>
      {/* The count and the state stack rather than sitting side by side. At
          four across "60 open work" on one line is a clipped "60 open wor",
          which is how a number stops being a number. */}
      <span className="f">
        {t.open > 0 && <span className="n">{t.open}</span>}
        <span className="say">{SAY[t.state]}</span>
      </span>
      {t.late > 0 && <span className="pip" title={`${t.late} past its date`}>{t.late}</span>}
    </>
  );

  const tile = (t: SpineTrade) => (
    <Link key={t.trade} className={`tp ${t.state}${t.late > 0 ? " late" : ""}`}
      href={`/project/${projectId}/trade/${encodeURIComponent(t.trade)}?back=${encodeURIComponent(back)}`}
      title={[t.stage, t.trade, t.who, t.open > 0 ? `${t.open} open` : SAY[t.state], t.next_due
        ? (t.next_due <= today ? "due today" : `next ${t.next_due}`) : null]
        .filter(Boolean).join(" · ")}>
      {face(t)}
    </Link>
  );

  return (
    <section className="stack" style={{ gap: 10 }}>
      <div className="between" style={{ alignItems: "baseline", gap: 10 }}>
        <div className="divider-label" style={{ padding: 0 }}>
          The trades · {spine.trades.length}
          {totalLate > 0 && (
            <span style={{ fontWeight: 700, color: "var(--color-status)" }}> · {totalLate} late</span>
          )}
        </div>
        <span className="tiny text-muted">In build order</span>
      </div>

      {/* WHAT THE COLOURS MEAN, said once. A colour code nobody was taught is
          decoration; it takes one line to make it readable, and after a week
          nobody reads the line. */}
      <div className="spine-key">
        <span><i className="sw working" />on the job{count("working") > 0 ? ` · ${count("working")}` : ""}</span>
        <span><i className="sw appointed" />appointed{count("appointed") > 0 ? ` · ${count("appointed")}` : ""}</span>
        <span><i className="sw hiring" />bid out{count("hiring") > 0 ? ` · ${count("hiring")}` : ""}</span>
        <span><i className="sw loose" />open work</span>
        {idle.length > 0 && <span><i className="sw idle" />not started · {idle.length}</span>}
      </div>

      <div className="spine-grid">
        {live.map(tile)}
        {/* The trades the job needs and nobody has started, in their own place
            in the sequence rather than exiled to a strip below it - because
            "the plumber has not been called yet" is a fact about THIS point in
            the build and belongs where the plumber belongs. */}
        {idle.map(tile)}
      </div>

      {manages && idle.length > 0 && (
        <p className="tiny text-muted" style={{ margin: 0 }}>
          A dashed tile is a trade this job needs and nobody has started. Open it to log the first
          task, run a bid, or award it straight to somebody you have already picked.
        </p>
      )}

      {manages && idle.length > 0 && (
        <p className="tiny text-muted" style={{ margin: 0 }}>
          A dashed tile is a trade this job needs and nobody has started. Tapping one writes a single
          line on you — <em>Run the bid for …</em> — filed under the trade and invisible to the trades.
        </p>
      )}

      {/* Whatever the spine could not place. Never folded into a trade that
          does not own it, never hidden - counted, named, and one tap away. */}
      {spine.untagged.open > 0 && (
        <Link href={allTasksHref} className="home-row">
          <span className="grow" style={{ minWidth: 0 }}>
            <span className="t">Not filed under a trade</span>
            <span className="m" style={{ display: "block" }}>
              {spine.untagged.late > 0
                ? `${spine.untagged.late} of them past its date`
                : "Running the job, permits, money, everything else"}
            </span>
          </span>
          <span className="tag tag-outline" style={{ whiteSpace: "nowrap" }}>
            {spine.untagged.open} open
          </span>
        </Link>
      )}
    </section>
  );
}
