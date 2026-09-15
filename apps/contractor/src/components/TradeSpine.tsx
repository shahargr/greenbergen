import Link from "next/link";
import { shortDate } from "@shared/format";
import { TradeIllustration } from "@shared/Illustrations";
import { StartTrade } from "@/app/project/[id]/StartTrade";

// A JOB IS ELEVEN TRADES IN ORDER, NOT TWO HUNDRED TASKS.
//
// Shahar (2026-09-15): "What's not working for me here is when I land on
// task, I see a long list of tasks. Instead of that, I would like to start by
// seeing all the trades, the panels for all the different trades and what is
// currently being worked on... I want you to know how the trades are
// sequenced on a project. At the beginning you have demolition and
// excavation, and then you're bringing in the mason guy, and then you're
// bringing in the plumber. And after that, the frame. And after that, again
// the plumber and the electrician and the HVAC guy."
//
// The sequence was already in the database and nothing had ever read it:
// trade_stages orders Buy and Sell, Survey, Site preparation, Rough and
// mechanical, Stairs, Finishing, Outdoor, Suppliers, Others. So the screen
// leads with the build order, each trade in one of four states, and the tasks
// live one tap inside whichever trade owns them.
export type SpineTrade = {
  trade: string;
  stage: string | null;
  art: string | null;
  open: number;
  late: number;
  done: number;
  next_due: string | null;
  /** idle = the job needs it, nobody has started · hiring = choosing ·
   *  working = appointed and under way · loose = open work with nothing behind it */
  state: "idle" | "hiring" | "working" | "loose";
  who: string | null;
  now: { id: string; action: string; target_date: string | null }[];
};

export type Spine = {
  trades: SpineTrade[];
  untagged: { open: number; late: number };
};

// What a state IS, in the word a person on site would use for it. "loose" is
// the honest one: work filed under a trade with no package and no agreement
// behind it, which is most of what a real job accumulates.
const SAY: Record<SpineTrade["state"], string> = {
  working: "on the job",
  hiring: "choosing who",
  loose: "open work",
  idle: "not started",
};

export function TradeSpine({ projectId, spine, manages, back, allTasksHref }: {
  projectId: string;
  spine: Spine;
  /** Whether this person runs the job - only they are offered the idle trades. */
  manages: boolean;
  back: string;
  allTasksHref: string;
}) {
  const live = spine.trades.filter((t) => t.state !== "idle");
  const idle = spine.trades.filter((t) => t.state === "idle");
  if (live.length === 0 && idle.length === 0 && spine.untagged.open === 0) return null;

  // Stages, in the order the database sequences them - which is the order the
  // rows already arrive in, so this only has to notice where one ends.
  const stages: { stage: string; rows: SpineTrade[] }[] = [];
  for (const t of live) {
    const name = t.stage ?? "Everything else";
    const last = stages[stages.length - 1];
    if (last && last.stage === name) last.rows.push(t);
    else stages.push({ stage: name, rows: [t] });
  }

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const totalLate = live.reduce((n, t) => n + t.late, 0) + spine.untagged.late;

  return (
    <section className="stack" style={{ gap: 12 }}>
      <div className="between" style={{ alignItems: "baseline", gap: 10 }}>
        <div className="divider-label" style={{ padding: 0 }}>
          The trades · {live.length}
          {totalLate > 0 && (
            <span style={{ fontWeight: 700, color: "var(--color-status)" }}> · {totalLate} late</span>
          )}
        </div>
        <span className="tiny text-muted">In build order</span>
      </div>

      {live.length === 0 && (
        <div className="card pad">
          <div className="small">Nothing is open on any trade yet.</div>
        </div>
      )}

      {stages.map((s) => (
        <div key={s.stage} className="spine-stage">
          <div className="spine-head">{s.stage}</div>
          <div className="spine-rows">
            {s.rows.map((t) => (
              <Link key={t.trade} className={`spine-row${t.late > 0 ? " late" : ""}`}
                href={`/project/${projectId}/trade/${encodeURIComponent(t.trade)}?back=${encodeURIComponent(back)}`}>
                <span className="art" aria-hidden><TradeIllustration name={t.art} /></span>
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="t">{t.trade}</span>
                  <span className="m">
                    {[SAY[t.state], t.who].filter(Boolean).join(" · ")}
                  </span>
                  {/* WHAT IS ACTUALLY HAPPENING IN IT, not only how much of it
                      there is. One line is enough to recognise the trade's
                      state without opening it; the rest is inside. */}
                  {t.now[0] && (
                    <span className="nx">
                      {t.now[0].action}
                      {t.now.length > 1 ? ` · +${t.open - 1} more` : ""}
                    </span>
                  )}
                </span>
                <span className="nums">
                  <span className="n">{t.open}</span>
                  {t.late > 0 && <span className="lt">{t.late} late</span>}
                  {t.late === 0 && t.next_due && (
                    <span className="due">{t.next_due <= today ? "today" : shortDate(t.next_due)}</span>
                  )}
                </span>
              </Link>
            ))}
          </div>
        </div>
      ))}

      {/* THE TRADES THIS JOB NEEDS AND NOBODY HAS STARTED. The database only
          hands these to somebody who runs the job - the plan is not a trade's
          business - and the screen checks the same thing rather than trusting
          an empty list to mean the right thing. */}
      {manages && idle.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          <div className="divider-label" style={{ padding: 0 }}>Not started · {idle.length}</div>
          <StartTrade projectId={projectId}
            trades={idle.map((t) => ({ trade: t.trade, who: t.who }))} />
        </div>
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
