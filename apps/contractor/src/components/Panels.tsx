"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@shared/supabase/client";
import type { SpineTrade } from "./TradeSpine";

// FOUR PANELS IF POSSIBLE, MORE AS NEEDED.
//
// Shahar (2026-09-17): "having a panel for all open bids is needed, where
// there are any. since i am still in rough, i don't need to see panels that
// are completed running (such as finance), or not yet in scope (finish)...
// my goal is to keep four panels if possible visible, and more as needed."
// And: "suppliers should be visible under more panels, and the visibility
// based on stage is a good idea."
//
// THE RULE. A panel earns its place by needing you this week: something in
// it is late or due within a fortnight, a trade in it is on the job, or it
// is the stage the build is in - the panel with the most trades working.
// Bids is its own panel, drawn from every stage, shown only when a bid is
// out. Suppliers never earns a place by the rule; it waits in the line.
//
// THE CONTROL. Under the cards, one line: "Also: Finance & insurance ·
// Finish · ..." as chips with their counts. Tap a chip and the panel comes
// up and stays; the x on a card folds it back. Remembered per person per
// project in the database (project_panel_prefs, migration 173), so a phone
// and a desk agree.
export type PanelPrefs = { shown: string[]; hidden: string[] };

type Panel = { name: string; order: number; trades: SpineTrade[] };

const SAY: Record<SpineTrade["state"], string> = {
  working: "on the job", appointed: "appointed", hiring: "bid out",
  loose: "open work", done: "done", idle: "not started",
};
const LOUD: SpineTrade["state"][] = ["working", "hiring", "loose", "appointed", "done", "idle"];
const BIDS = "Bids";
const SUPPLIERS = "Suppliers";

export function Panels({ projectId, trades, prefs, back, manages, fortnight }: {
  projectId: string;
  trades: SpineTrade[];
  prefs: PanelPrefs;
  back: string;
  manages: boolean;
  /** Fourteen days out, as a date, computed by the server so the render is pure. */
  fortnight: string;
}) {
  const router = useRouter();
  const [shown, setShown] = useState<string[]>(prefs.shown);
  const [hidden, setHidden] = useState<string[]>(prefs.hidden);
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);

  const panelOf = (t: SpineTrade) => t.panel ?? t.stage ?? "Running the job";
  const by = new Map<string, Panel>();
  for (const t of trades) {
    if (t.state === "idle" && !manages) continue;
    const name = panelOf(t);
    const p = by.get(name) ?? { name, order: t.panel_order ?? 999, trades: [] };
    p.order = Math.min(p.order, t.panel_order ?? 999);
    p.trades.push(t);
    by.set(name, p);
  }
  const panels = [...by.values()].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  const bidding = trades.filter((t) => t.state === "hiring");

  // THE STAGE THE BUILD IS IN: the panel with the most trades working;
  // earliest in the build on a tie.
  const stage = panels
    .map((p) => ({ name: p.name, n: p.trades.filter((t) => t.state === "working").length, order: p.order }))
    .filter((p) => p.n > 0)
    .sort((a, b) => b.n - a.n || a.order - b.order)[0]?.name ?? null;

  const earns = (p: Panel) =>
    p.name !== SUPPLIERS && (
      p.name === stage ||
      p.trades.some((t) => t.late > 0) ||
      p.trades.some((t) => t.state === "working") ||
      p.trades.some((t) => !!t.next_due && t.next_due <= fortnight)
    );

  const visible = panels.filter((p) => all || shown.includes(p.name) || (earns(p) && !hidden.includes(p.name)));
  const also = panels.filter((p) => !visible.includes(p));
  const showBids = bidding.length > 0 && (all || !hidden.includes(BIDS));

  async function save(nextShown: string[], nextHidden: string[]) {
    setShown(nextShown); setHidden(nextHidden); setBusy(true);
    await createClient().rpc("portal_panel_prefs_set", { p_project: projectId, p_shown: nextShown, p_hidden: nextHidden });
    setBusy(false);
    router.refresh();
  }
  const pullUp = (name: string) => save([...new Set([...shown, name])], hidden.filter((h) => h !== name));
  const fold = (name: string) => save(shown.filter((s) => s !== name), [...new Set([...hidden, name])]);

  const card = (p: Panel) => {
    const open = p.trades.reduce((n, t) => n + t.open, 0);
    const late = p.trades.reduce((n, t) => n + t.late, 0);
    const state = LOUD.find((k) => p.trades.some((t) => t.state === k)) ?? "idle";
    const active = p.trades.filter((t) => t.state !== "idle");
    const named = (active.length > 0 ? active : p.trades).slice(0, 3).map((t) => t.trade);
    const more = p.trades.length - named.length;
    const who = [...new Set(active.map((t) => t.who).filter(Boolean))] as string[];
    return (
      <div key={p.name} className="sp-wrap">
        <Link className={`sp ${state}${late > 0 ? " late" : ""}${p.name === stage ? " stage" : ""}`}
          href={`/project/${projectId}/group/${encodeURIComponent(p.name)}?back=${encodeURIComponent(back)}`}
          title={[p.name, ...p.trades.map((t) => `${t.trade}: ${SAY[t.state]}`)].join(" · ")}>
          <span className="h">
            <span className="t">{p.name}</span>
            {late > 0 && <span className="pip" title={`${late} past its date`}>{late}</span>}
          </span>
          <span className="f">
            {open > 0 && <span className="n">{open}</span>}
            <span className="say">
              {open > 0 ? "open · " : ""}{active.length > 0
                ? `${active.length} of ${p.trades.length} ${p.trades.length === 1 ? "trade" : "trades"} ${SAY[state]}`
                : `${p.trades.length} ${p.trades.length === 1 ? "trade" : "trades"} not started`}
            </span>
          </span>
          <span className="m">{named.join(" · ")}{more > 0 ? ` · +${more}` : ""}</span>
          {who.length > 0 && <span className="w">{who.slice(0, 2).join(", ")}{who.length > 2 ? ` +${who.length - 2}` : ""}</span>}
        </Link>
        {!all && (
          <button type="button" className="sp-x" aria-label={`Fold ${p.name} away`} title="Fold it away"
            disabled={busy} onClick={() => { void fold(p.name); }}>×</button>
        )}
      </div>
    );
  };

  // THE BIDS PANEL: every trade with a bid out, wherever it sits in the
  // build. It opens the bid board - the one place that says where every
  // trade got to, not a tile screen filtered to some of them.
  const bidsCard = (
    <div key={BIDS} className="sp-wrap">
      <Link className="sp hiring" href={`/project/${projectId}/bids`}
        title={bidding.map((t) => t.trade).join(" · ")}>
        <span className="h"><span className="t">Bids</span></span>
        <span className="f">
          <span className="n">{bidding.length}</span>
          <span className="say">{bidding.length === 1 ? "trade bid out" : "trades bid out"}</span>
        </span>
        <span className="m">{bidding.slice(0, 3).map((t) => t.trade).join(" · ")}{bidding.length > 3 ? ` · +${bidding.length - 3}` : ""}</span>
      </Link>
      {!all && (
        <button type="button" className="sp-x" aria-label="Fold Bids away" title="Fold it away"
          disabled={busy} onClick={() => { void fold(BIDS); }}>×</button>
      )}
    </div>
  );

  const alsoChips = [
    ...(bidding.length > 0 && !showBids ? [{ name: BIDS, open: bidding.length, late: 0 }] : []),
    ...also.map((p) => ({
      name: p.name,
      open: p.trades.reduce((n, t) => n + t.open, 0),
      late: p.trades.reduce((n, t) => n + t.late, 0),
    })),
  ];

  return (
    <>
      <div className="sp-grid">
        {showBids && bidsCard}
        {visible.map(card)}
      </div>
      {(alsoChips.length > 0 || all || shown.length > 0 || hidden.length > 0) && (
        <div className="sp-also">
          {alsoChips.length > 0 && <span className="lbl">Also</span>}
          {alsoChips.map((c) => (
            <button key={c.name} type="button" className={`chip${c.late > 0 ? " late" : ""}`} disabled={busy}
              title={`Pull ${c.name} up`} onClick={() => { void pullUp(c.name); }}>
              {c.name}{c.open > 0 ? ` · ${c.open}` : ""}{c.late > 0 ? ` · ${c.late} late` : ""}
            </button>
          ))}
          <button type="button" className="chip ghost" onClick={() => setAll((a) => !a)}>
            {all ? "Back to what matters now" : "Show all"}
          </button>
          {!all && (shown.length > 0 || hidden.length > 0) && (
            <button type="button" className="chip ghost" disabled={busy} title="Forget what you pulled up or folded away"
              onClick={() => { void save([], []); }}>Reset</button>
          )}
        </div>
      )}
    </>
  );
}
