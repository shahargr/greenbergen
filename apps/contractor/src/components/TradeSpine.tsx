import Link from "next/link";
import type { ReactNode } from "react";
import { TradeIllustration } from "@shared/Illustrations";
import { Panels, type PanelPrefs } from "./Panels";

/** The synthetic panel: every trade with a bid out, wherever it sits. */
export const BIDS_PANEL = "Bids";

// A JOB IS ITS TRADES, IN ORDER, ON ONE SCREEN - GROUPED INTO PANELS.
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
// And then (2026-09-17), at twenty-seven tiles: "can we do one category
// finance & insurance. similar, we can club all rough trades under rough,
// and finish trades under finish. this will reduce the number of panels
// significantly."
//
// So the project screen shows PANELS - Finance & insurance, Inspections,
// Site, Rough, Finish, Outdoor, Suppliers, Running the job - one per group of
// stages (trade_stages.panel, migration 168), in build order, each carrying
// what is on the job inside it. A panel opens to its trades as the four-wide
// TILES the first version drew, and a tile opens the trade. The state is
// still carried by colour first and confirmed by the label second.
export type SpineTrade = {
  trade: string;
  stage: string | null;
  /** The panel the stage sits in (168), and where that panel falls in the build. */
  panel?: string | null;
  panel_order?: number | null;
  art: string | null;
  open: number;
  late: number;
  done: number;
  next_due: string | null;
  /** idle = the job needs it and nobody has been called · appointed = under a
   *  signed or awarded contract with nothing open · hiring = choosing ·
   *  working = appointed and under way · loose = open work, nothing behind it
   *  · done = its contract is Complete and nothing is open (migration 154) */
  state: "idle" | "appointed" | "hiring" | "working" | "loose" | "done";
  /** Whether a signed or awarded contract covers this trade. */
  awarded: boolean;
  /** Whether the only contract behind this trade is Complete. */
  finished: boolean;
  who: string | null;
  now: { id: string; action: string; target_date: string | null }[];
  /** The job this trade's work sits on, when the screen is a property above it. */
  lands_on?: { id: string; name: string | null } | null;
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
//
// `done` is the fifth the data insisted on next (migration 154): asbestos
// was inspected and abated in May, the contract is Complete, and the tile
// said "not started" - the opposite of the truth, and an invitation to
// award it again.
const SAY: Record<SpineTrade["state"], string> = {
  working: "on the job",
  appointed: "appointed",
  hiring: "bid out",
  loose: "open work",
  done: "done",
  idle: "not started",
};

// The state a PANEL wears is the loudest state inside it: work under way
// beats a bid out beats loose work beats an appointment beats done beats
// nothing started. A panel with a plumber on site is green whatever the
// roofer is doing.
const LOUD: SpineTrade["state"][] = ["working", "hiring", "loose", "appointed", "done", "idle"];

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

export function TradeSpine({ projectId, spine, manages, back, allTasksHref, mode = "panels", only = null, tail = null, prefs = null }: {
  projectId: string;
  spine: Spine;
  /** Whether this person runs the job - only they are offered the idle trades. */
  manages: boolean;
  back: string;
  allTasksHref: string;
  /** panels = one card per group of stages (the project screen); tiles = one
   *  tile per trade (a panel's own screen, or the old whole-board view). */
  mode?: "panels" | "tiles";
  /** In tiles mode, show only the trades of this panel. */
  only?: string | null;
  /** In tiles mode, whatever sits after the last trade in the grid - the
   *  "Add a trade" tile (migration 170). */
  tail?: ReactNode;
  /** In panels mode, what this person pulled up or folded away (173). */
  prefs?: PanelPrefs | null;
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
  const panelOf = (t: SpineTrade) => t.panel ?? t.stage ?? "Running the job";
  // The Bids panel is every trade with a bid out, wherever it sits (173).
  const inScope = only === BIDS_PANEL ? spine.trades.filter((t) => t.state === "hiring")
    : only ? spine.trades.filter((t) => panelOf(t) === only) : spine.trades;
  const live = inScope.filter((t) => t.state !== "idle");
  const idle = manages ? inScope.filter((t) => t.state === "idle") : [];
  if (live.length === 0 && idle.length === 0 && (only || spine.untagged.open === 0)) return null;

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const soon = new Date(); soon.setDate(soon.getDate() + 14);
  const fortnight = soon.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const totalLate = live.reduce((n, t) => n + t.late, 0) + (only ? 0 : spine.untagged.late);
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

  // THE PANELS. Each group of stages, in build order, wearing the loudest
  // state inside it, its open and late counts, and the trades in it by name -
  // the ones with something going on first.
  type Panel = { name: string; order: number; trades: SpineTrade[] };
  const panels: Panel[] = [];
  if (mode === "panels") {
    const by = new Map<string, Panel>();
    for (const t of [...live, ...idle]) {
      const name = panelOf(t);
      const p = by.get(name) ?? { name, order: t.panel_order ?? 999, trades: [] };
      p.order = Math.min(p.order, t.panel_order ?? 999);
      p.trades.push(t);
      by.set(name, p);
    }
    panels.push(...[...by.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)));
  }

  const card = (p: Panel) => {
    const open = p.trades.reduce((n, t) => n + t.open, 0);
    const late = p.trades.reduce((n, t) => n + t.late, 0);
    const state = LOUD.find((k) => p.trades.some((t) => t.state === k)) ?? "idle";
    const active = p.trades.filter((t) => t.state !== "idle");
    const named = (active.length > 0 ? active : p.trades).slice(0, 3).map((t) => t.trade);
    const more = p.trades.length - named.length;
    const who = [...new Set(active.map((t) => t.who).filter(Boolean))] as string[];
    return (
      <Link key={p.name} className={`sp ${state}${late > 0 ? " late" : ""}`}
        href={`/project/${projectId}/group/${encodeURIComponent(p.name)}?back=${encodeURIComponent(back)}`}
        title={[p.name, ...p.trades.map((t) => `${t.trade}: ${SAY[t.state]}`)].join(" · ")}>
        <span className="h">
          <span className="t">{p.name}</span>
          {late > 0 && <span className="pip" title={`${late} past its date`}>{late}</span>}
        </span>
        <span className="f">
          {open > 0 && <span className="n">{open}</span>}
          <span className="say">
            {open > 0 ? `open · ` : ""}{active.length > 0
              ? `${active.length} of ${p.trades.length} ${p.trades.length === 1 ? "trade" : "trades"} ${SAY[state]}`
              : `${p.trades.length} ${p.trades.length === 1 ? "trade" : "trades"} not started`}
          </span>
        </span>
        <span className="m">{named.join(" · ")}{more > 0 ? ` · +${more}` : ""}</span>
        {who.length > 0 && <span className="w">{who.slice(0, 2).join(", ")}{who.length > 2 ? ` +${who.length - 2}` : ""}</span>}
      </Link>
    );
  };

  return (
    <section className="stack" style={{ gap: 10 }}>
      <div className="between" style={{ alignItems: "baseline", gap: 10 }}>
        <div className="divider-label" style={{ padding: 0 }}>
          {mode === "panels" ? `The work · ${inScope.length} trades in ${panels.length} panels` : `The trades · ${inScope.length}`}
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
        {count("done") > 0 && <span><i className="sw done" />done · {count("done")}</span>}
        {idle.length > 0 && <span><i className="sw idle" />not started · {idle.length}</span>}
      </div>

      {/* FOUR PANELS IF POSSIBLE (Shahar, 2026-09-17). The rule that picks
          them, the Bids panel and the "Also" line are Panels; the cards it
          draws are the ones below, kept here for the whole-board view. */}
      {mode === "panels" ? (
        prefs
          ? <Panels projectId={projectId} trades={[...live, ...idle]} prefs={prefs} back={back} manages={manages} fortnight={fortnight} />
          : <div className="sp-grid">{panels.map(card)}</div>
      ) : (
        <div className="spine-grid">
          {live.map(tile)}
          {/* The trades the job needs and nobody has started, in their own place
              in the sequence rather than exiled to a strip below it - because
              "the plumber has not been called yet" is a fact about THIS point in
              the build and belongs where the plumber belongs. */}
          {idle.map(tile)}
          {tail}
        </div>
      )}

      {manages && idle.length > 0 && mode === "tiles" && (
        <p className="tiny text-muted" style={{ margin: 0 }}>
          A dashed tile is a trade this job needs and nobody has started. Open it to log the first
          task, run a bid, or award it straight to somebody you have already picked.
        </p>
      )}

      {/* Whatever the spine could not place. Never folded into a trade that
          does not own it, never hidden - counted, named, and one tap away. */}
      {!only && spine.untagged.open > 0 && (
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
