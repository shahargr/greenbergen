"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@shared/supabase/client";
import { friendly } from "@shared/rpc";
import { shortDate } from "@shared/format";
import { Evidence, type Attached } from "@shared/Evidence";
import { ChevronIcon } from "@shared/ui";
import type { SpineTrade } from "@/components/TradeSpine";

// THE WALK-ROUND (migration 238). Everything Shahar listed for a GC or PM
// standing on site, in the order the visit runs: write it down, see what
// needs you, then go trade by trade.

type Mini = { id: string; action: string; trade: string | null; target_date?: string | null; who?: string | null };
export type OpenTask = {
  id: string; action: string; status: string; target_date: string | null; is_gate: boolean;
  kind: string | null; trade: string | null; project_id: string;
  assignee: string | null; assignee_id: string | null;
};
export type Activity = {
  at: string; what: "done" | "new" | "note" | "permit" | "on_site";
  text: string; id: string; trade: string | null; who: string | null;
};
export type VisitBoard = {
  ok: boolean; reason?: string;
  today: string;
  me: string | null;
  default_job: string | null;
  punch_on: Record<string, string>;
  roster: { contact_id: string; name: string; trades: string[] }[];
  people: { contact_id: string; trade: string; name: string; on_site: boolean }[];
  open: OpenTask[];
  activity: Activity[];
  permits: { id: string; at: string; body: string; became: string | null; who: string | null }[];
  learnings: { id: string; title: string; detail: string | null; trade: string | null; checklist: boolean; at: string }[];
  watch: {
    late: number; waiting: number;
    inspections: Mini[]; deliveries: Mini[]; approve: Mini[]; gates: Mini[];
  };
  bids: { id: string; project_id: string; trade: string; reply_by: string | null; in_room: number; priced: number; low: number | null }[];
};

type Mode = "task" | "punch" | "pay" | "permit" | "learning" | "bid";
const MODES: { key: Mode; label: string; hint: string }[] = [
  { key: "task", label: "Task", hint: "One line, whose it is, when" },
  { key: "punch", label: "Punch", hint: "Something a trade still owes" },
  { key: "pay", label: "Payment", hint: "A check, a receipt, an invoice" },
  { key: "permit", label: "Permit", hint: "Who you spoke to at the town, and what they said" },
  { key: "learning", label: "Learning", hint: "What the next job should do differently" },
  { key: "bid", label: "Bid", hint: "A price or scope a trade gave you" },
];

// Where the town lives in the trade list (migration 237 files Permits beside it).
const PERMITS_TRADE = "Utilities & Municipalities";
const SAY: Record<SpineTrade["state"], string> = {
  working: "on the job", appointed: "appointed", hiring: "bid out",
  loose: "open work", done: "done", idle: "not started",
};
const WHAT: Record<Activity["what"], string> = {
  done: "Done", new: "New", note: "Note", permit: "Permit", on_site: "On site",
};

const dayOf = (iso: string) => iso.slice(0, 10);
const money = (n: number | null) => (n == null ? null : `$${Math.round(n).toLocaleString()}`);

export function VisitDesk({ projectId, back, manages, desk, trades, visit }: {
  projectId: string;
  /** This screen's own address, so every write comes back here. */
  back: string;
  manages: boolean;
  desk: VisitBoard;
  trades: SpineTrade[];
  /** Today's visit - the note and the photos - rendered by the page. */
  visit: ReactNode;
}) {
  const { today } = desk;
  const logRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [trade, setTrade] = useState<string>("");

  // THE TRADES WORTH A CARD: anything live, anybody here, any punch or any
  // word this week. Build order is the spine's; people on site go first.
  const byTrade = useMemo(() => {
    const m = new Map<string, { open: OpenTask[]; punch: OpenTask[]; week: Activity[]; people: VisitBoard["people"] }>();
    const get = (t: string) => {
      if (!m.has(t)) m.set(t, { open: [], punch: [], week: [], people: [] });
      return m.get(t)!;
    };
    for (const o of desk.open) if (o.trade) (o.kind === "punch" ? get(o.trade).punch : get(o.trade).open).push(o);
    for (const a of desk.activity) if (a.trade) get(a.trade).week.push(a);
    for (const p of desk.people) get(p.trade).people.push(p);
    return m;
  }, [desk]);
  const onSite = new Set(desk.people.filter((p) => p.on_site).map((p) => p.trade));
  const spineOf = new Map(trades.map((t) => [t.trade, t]));
  const cardTrades = useMemo(() => {
    const names = new Set<string>();
    for (const t of trades) if (t.open > 0 || ["working", "hiring", "loose", "appointed"].includes(t.state)) names.add(t.trade);
    for (const [t, v] of byTrade) if (v.open.length + v.punch.length + v.week.length > 0 || onSite.has(t)) names.add(t);
    const order = new Map(trades.map((t, i) => [t.trade, i]));
    return [...names].sort((a, b) =>
      Number(onSite.has(b)) - Number(onSite.has(a))
      || (order.get(a) ?? 999) - (order.get(b) ?? 999) || a.localeCompare(b));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trades, byTrade]);

  // Every trade the pickers offer: the job's own first, in build order.
  const tradeNames = useMemo(() => {
    const s = new Set<string>(trades.map((t) => t.trade));
    for (const t of byTrade.keys()) s.add(t);
    s.add(PERMITS_TRADE);
    return [...s];
  }, [trades, byTrade]);

  // WHERE WRITING FOR A TRADE LANDS. A property holds no work of its own, so
  // it goes to the job that trade's work already sits on, else the busiest
  // job beneath - the same answer the trade screen gives.
  const jobFor = (t: string) => spineOf.get(t)?.lands_on?.id ?? desk.default_job ?? projectId;

  const open = (m: Mode, t?: string) => {
    setMode(m);
    if (t !== undefined) setTrade(t);
    else if (m === "permit") setTrade(PERMITS_TRADE);
    requestAnimationFrame(() => logRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const late = desk.open.filter((o) => o.target_date && o.target_date < today);
  const punchCount = desk.open.filter((o) => o.kind === "punch").length;

  return (
    <div className="stack sv" style={{ gap: 14 }}>
      {/* THE DAY IN ONE LINE: who is here, what is open, what is late. */}
      <div className="sv-stats">
        <Stat n={desk.roster.length} label="on site today" />
        <Stat n={cardTrades.length} label="live trades" />
        <Stat n={desk.open.length - punchCount} label="open tasks" />
        <Stat n={late.length} label="late" tone={late.length > 0 ? "late" : undefined} />
        <Stat n={punchCount} label="punch items" />
      </div>

      {/* LOG. One row of what you write down on a walk-round; each opens its
          own short form here. */}
      <section className="stack" style={{ gap: 8 }} ref={logRef}>
        <div className="divider-label" style={{ padding: 0 }}>Log</div>
        <div className="sv-modes" role="tablist">
          {MODES.filter((m) => manages || m.key === "task" || m.key === "punch").map((m) => (
            <button key={m.key} type="button" role="tab" aria-selected={mode === m.key}
              className={`sv-mode${mode === m.key ? " on" : ""}`}
              onClick={() => (mode === m.key ? setMode(null) : open(m.key))}>
              {m.label}
            </button>
          ))}
        </div>
        {mode && (
          <div className="card pad tight">
            <p className="tiny text-muted" style={{ margin: "0 0 8px" }}>{MODES.find((m) => m.key === mode)?.hint}</p>
            {(mode === "task" || mode === "punch") && (
              <TaskForm key={mode} kind={mode} projectId={projectId} desk={desk} tradeNames={tradeNames}
                trade={trade} setTrade={setTrade} jobFor={jobFor} />
            )}
            {mode === "pay" && <PayLink projectId={projectId} back={back} trade={trade} setTrade={setTrade} tradeNames={tradeNames} />}
            {mode === "permit" && <PermitForm desk={desk} jobFor={jobFor} />}
            {mode === "learning" && <LearningForm projectId={projectId} tradeNames={tradeNames} trade={trade} setTrade={setTrade} />}
            {mode === "bid" && (
              <BidForm desk={desk} tradeNames={tradeNames} trade={trade} setTrade={setTrade} jobFor={jobFor} />
            )}
          </div>
        )}
      </section>

      {/* TODAY'S VISIT: the note and the photos. */}
      <section className="stack" style={{ gap: 8 }}>
        {visit}
      </section>

      <Watch desk={desk} projectId={projectId} back={back} late={late.length} />

      {/* WHO IS HERE TODAY - from check-ins and logged visits. */}
      <section className="stack" style={{ gap: 8 }}>
        <div className="divider-label" style={{ padding: 0 }}>On site today · {desk.roster.length}</div>
        {desk.roster.length === 0
          ? <p className="tiny text-muted" style={{ margin: 0 }}>Nobody has checked in today. Logging your visit puts you on the roster.</p>
          : (
            <div className="sv-chips">
              {desk.roster.map((r) => (
                <span key={r.contact_id} className="sv-chip">
                  <span className="dot" aria-hidden />{r.name}
                  {r.trades.length > 0 && <span className="m"> · {r.trades.slice(0, 2).join(", ")}</span>}
                </span>
              ))}
            </div>
          )}
      </section>

      {/* EVERY LIVE TRADE: its state, its people, its open work, its punch
          list and its week. Tap to open; each carries its own buttons. */}
      <section className="stack" style={{ gap: 8 }}>
        <div className="divider-label" style={{ padding: 0 }}>Trades · {cardTrades.length}</div>
        {cardTrades.length === 0 && (
          <p className="tiny text-muted" style={{ margin: 0 }}>No trade has work open here yet.</p>
        )}
        {cardTrades.map((t) => (
          <TradeCard key={t} name={t} spine={spineOf.get(t) ?? null} data={byTrade.get(t)}
            here={onSite.has(t)} today={today} projectId={projectId} back={back} manages={manages}
            onLog={(m) => open(m, t)} />
        ))}
      </section>

      <Records desk={desk} />

      {/* THE WEEK, WHOEVER DID IT - including what carries no trade. */}
      {desk.activity.length > 0 && (
        <details className="visit-prev">
          <summary>
            <span className="grow" style={{ minWidth: 0 }}>This week on site · {desk.activity.length}</span>
            <span className="mark" aria-hidden />
          </summary>
          <div style={{ padding: "0 12px 12px" }}>
            <Feed rows={desk.activity.slice(0, 40)} showTrade back={back} />
          </div>
        </details>
      )}
    </div>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone?: "late" }) {
  return (
    <div className={`sv-stat${tone ? ` ${tone}` : ""}`}>
      <span className="n">{n}</span>
      <span className="l">{label}</span>
    </div>
  );
}

// ── WHAT NEEDS AN EYE ───────────────────────────────────────────────────────
function Watch({ desk, projectId, back, late }: { desk: VisitBoard; projectId: string; back: string; late: number }) {
  const w = desk.watch;
  const task = (id: string) => `/task/${id}?back=${encodeURIComponent(back)}`;
  type Row = { key: string; title: string; items: Mini[]; say: (m: Mini) => string };
  const rows = ([
    { key: "gates", title: "Gates holding work", items: w.gates, say: (m) => [m.trade, m.target_date ? `due ${shortDate(m.target_date)}` : null].filter(Boolean).join(" · ") },
    { key: "insp", title: "Inspections this week", items: w.inspections, say: (m) => [m.trade, m.target_date ? shortDate(m.target_date) : null].filter(Boolean).join(" · ") },
    { key: "deliv", title: "Deliveries due", items: w.deliveries, say: (m) => [m.trade, m.target_date ? shortDate(m.target_date) : null].filter(Boolean).join(" · ") },
    { key: "approve", title: "Done - waiting on your approval", items: w.approve, say: (m) => [m.trade, m.who].filter(Boolean).join(" · ") },
  ] as Row[]).filter((r) => r.items.length > 0);
  const nothing = rows.length === 0 && desk.bids.length === 0 && late === 0 && w.waiting === 0;

  return (
    <section className="stack" style={{ gap: 8 }}>
      <div className="divider-label" style={{ padding: 0 }}>Needs your eye</div>
      {nothing && <p className="tiny text-muted" style={{ margin: 0 }}>Nothing is late, waiting or due. A quiet site.</p>}
      {(late > 0 || w.waiting > 0) && (
        <p className="small" style={{ margin: 0 }}>
          {late > 0 && <><strong className="sv-late">{late} late</strong>{w.waiting > 0 ? " · " : ""}</>}
          {w.waiting > 0 && <>{w.waiting} waiting on somebody else</>}
          {" · "}
          <Link href={`/tasks?project=${projectId}&back=${encodeURIComponent(back)}`} style={{ fontWeight: 700 }}>see them</Link>
        </p>
      )}
      {rows.map((r) => (
        <details key={r.key} className="visit-prev" open={r.key !== "gates"}>
          <summary>
            <span className="grow" style={{ minWidth: 0 }}>{r.title} · {r.items.length}</span>
            <span className="mark" aria-hidden />
          </summary>
          <div className="stack" style={{ gap: 4, padding: "0 12px 10px" }}>
            {r.items.slice(0, 8).map((m) => (
              <Link key={m.id} href={task(m.id)} className="sv-line">
                <span className="t">{m.action}</span>
                <span className="m">{r.say(m)}</span>
              </Link>
            ))}
          </div>
        </details>
      ))}
      {desk.bids.length > 0 && (
        <details className="visit-prev">
          <summary>
            <span className="grow" style={{ minWidth: 0 }}>Bid rooms waiting · {desk.bids.length}</span>
            <span className="mark" aria-hidden />
          </summary>
          <div className="stack" style={{ gap: 4, padding: "0 12px 10px" }}>
            {desk.bids.map((b) => (
              <Link key={b.id} href={`/project/${b.project_id}/bids/${b.id}`} className="sv-line">
                <span className="t">{b.trade}</span>
                <span className="m">
                  {[`${b.priced} of ${b.in_room} priced`, money(b.low) ? `low ${money(b.low)}` : null,
                    b.reply_by ? `reply by ${shortDate(b.reply_by)}` : null].filter(Boolean).join(" · ")}
                </span>
              </Link>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

// ── ONE TRADE ───────────────────────────────────────────────────────────────
function TradeCard({ name, spine, data, here, today, projectId, back, manages, onLog }: {
  name: string; spine: SpineTrade | null;
  data: { open: OpenTask[]; punch: OpenTask[]; week: Activity[]; people: VisitBoard["people"] } | undefined;
  here: boolean; today: string; projectId: string; back: string; manages: boolean;
  onLog: (m: Mode) => void;
}) {
  const open = data?.open ?? [];
  const punch = data?.punch ?? [];
  const week = data?.week ?? [];
  const people = data?.people ?? [];
  const late = open.filter((o) => o.target_date && o.target_date < today).length;
  const task = (id: string) => `/task/${id}?back=${encodeURIComponent(back)}`;
  const who = spine?.who ?? people[0]?.name ?? null;

  return (
    <details className="sv-trade">
      <summary>
        <span className="grow" style={{ minWidth: 0 }}>
          <span className="t">
            {here && <span className="dot" title="On site today" aria-label="On site today" />}
            {name}
          </span>
          <span className="m">
            {[spine ? SAY[spine.state] : null, who].filter(Boolean).join(" · ")}
          </span>
        </span>
        <span className="sv-counts">
          <span>{open.length} open</span>
          {late > 0 && <span className="late">{late} late</span>}
          {punch.length > 0 && <span className="punch">{punch.length} punch</span>}
        </span>
        <span className="chev"><ChevronIcon /></span>
      </summary>

      <div className="stack" style={{ gap: 10, padding: "4px 12px 12px" }}>
        <div className="sv-acts">
          <button type="button" className="btn btn-ghost small" onClick={() => onLog("task")}>+ Task</button>
          <button type="button" className="btn btn-ghost small" onClick={() => onLog("punch")}>+ Punch</button>
          {manages && <button type="button" className="btn btn-ghost small" onClick={() => onLog("bid")}>+ Bid</button>}
          {manages && <button type="button" className="btn btn-ghost small" onClick={() => onLog("pay")}>Pay</button>}
        </div>

        {people.length > 0 && (
          <p className="tiny text-muted" style={{ margin: 0 }}>
            {people.map((p) => `${p.name}${p.on_site ? " (here today)" : ""}`).join(" · ")}
          </p>
        )}

        <Block title="Open tasks" n={open.length} empty="Nothing open.">
          {open.slice(0, 8).map((o) => (
            <Link key={o.id} href={task(o.id)} className="sv-line">
              <span className="t">{o.is_gate ? "⛔ " : ""}{o.action}</span>
              <span className="m">
                {[o.assignee ?? "nobody holds it",
                  o.target_date ? `${o.target_date < today ? "was due" : "due"} ${shortDate(o.target_date)}` : null,
                  o.status !== "Not Started" ? o.status : null].filter(Boolean).join(" · ")}
              </span>
            </Link>
          ))}
          {open.length > 8 && (
            <Link href={`/project/${projectId}/trade/${encodeURIComponent(name)}`} className="tiny" style={{ fontWeight: 700 }}>
              All {open.length} on the trade screen
            </Link>
          )}
        </Block>

        <Block title="Punch list" n={punch.length} empty="No punch items.">
          {punch.map((o) => (
            <Link key={o.id} href={task(o.id)} className="sv-line">
              <span className="t">{o.action}</span>
              <span className="m">{[o.assignee, o.target_date ? `by ${shortDate(o.target_date)}` : null].filter(Boolean).join(" · ") || "photo closes it"}</span>
            </Link>
          ))}
        </Block>

        <Block title="This week" n={week.length} empty="Nothing logged this week.">
          <Feed rows={week.slice(0, 8)} back={back} />
        </Block>

        <Link href={`/project/${projectId}/trade/${encodeURIComponent(name)}`} className="home-row">
          <span className="grow" style={{ minWidth: 0 }}>
            <span className="t">Open {name}</span>
            <span className="m" style={{ display: "block" }}>Contracts, money, gates and every task</span>
          </span>
          <ChevronIcon />
        </Link>
      </div>
    </details>
  );
}

function Block({ title, n, empty, children }: { title: string; n: number; empty: string; children: ReactNode }) {
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="tiny" style={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em" }}>
        {title}{n > 0 ? ` · ${n}` : ""}
      </div>
      {n === 0 ? <p className="tiny text-muted" style={{ margin: 0 }}>{empty}</p> : children}
    </div>
  );
}

function Feed({ rows, showTrade = false, back }: { rows: Activity[]; showTrade?: boolean; back: string }) {
  return (
    <div className="stack" style={{ gap: 4 }}>
      {rows.map((a, i) => {
        const body = (
          <>
            <span className={`sv-what ${a.what}`}>{WHAT[a.what]}</span>
            <span className="grow" style={{ minWidth: 0 }}>
              <span className="t">{a.text}</span>
              <span className="m">
                {[shortDate(dayOf(a.at)), showTrade ? a.trade : null, a.who].filter(Boolean).join(" · ")}
              </span>
            </span>
          </>
        );
        return a.what === "done" || a.what === "new"
          ? <Link key={`${a.id}-${i}`} href={`/task/${a.id}?back=${encodeURIComponent(back)}`} className="sv-feed">{body}</Link>
          : <div key={`${a.id}-${i}`} className="sv-feed">{body}</div>;
      })}
    </div>
  );
}

function Records({ desk }: { desk: VisitBoard }) {
  if (desk.permits.length === 0 && desk.learnings.length === 0) return null;
  return (
    <section className="stack" style={{ gap: 8 }}>
      {desk.permits.length > 0 && (
        <details className="visit-prev">
          <summary>
            <span className="grow" style={{ minWidth: 0 }}>Permit conversations · {desk.permits.length}</span>
            <span className="mark" aria-hidden />
          </summary>
          <div className="stack" style={{ gap: 8, padding: "0 12px 12px" }}>
            {desk.permits.map((p) => (
              <div key={p.id}>
                <div className="tiny text-muted">{shortDate(dayOf(p.at))} · {p.who ?? "someone"}{p.became ? " · follow-up task made" : ""}</div>
                <p className="small" style={{ margin: "2px 0 0", whiteSpace: "pre-wrap" }}>{p.body}</p>
              </div>
            ))}
          </div>
        </details>
      )}
      {desk.learnings.length > 0 && (
        <details className="visit-prev">
          <summary>
            <span className="grow" style={{ minWidth: 0 }}>Learnings from this job · {desk.learnings.length}</span>
            <span className="mark" aria-hidden />
          </summary>
          <div className="stack" style={{ gap: 8, padding: "0 12px 12px" }}>
            {desk.learnings.map((l) => (
              <div key={l.id}>
                <div className="tiny text-muted">{[shortDate(dayOf(l.at)), l.trade, l.checklist ? "on the checklist" : null].filter(Boolean).join(" · ")}</div>
                <p className="small" style={{ margin: "2px 0 0" }}><strong>{l.title}</strong>{l.detail ? ` — ${l.detail}` : ""}</p>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

// ── THE FORMS ───────────────────────────────────────────────────────────────

function useSend() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");
  async function send(fn: string, args: Record<string, unknown>, said: string) {
    setBusy(true); setErr(""); setDone("");
    const { data, error } = await createClient().rpc(fn, args);
    setBusy(false);
    if (error) { setErr(friendly(error.message)); return null; }
    if (!data?.ok) { setErr(data?.reason ?? "That did not save."); return null; }
    setDone(said);
    router.refresh();
    return data as Record<string, unknown>;
  }
  return { busy, err, done, send, setErr };
}

function Said({ err, done }: { err: string; done: string }) {
  return (
    <>
      {err && <p className="tiny" style={{ color: "var(--color-danger)", margin: 0 }}>{err}</p>}
      {done && <p className="tiny" style={{ color: "var(--color-ok)", margin: 0 }}>{done}</p>}
    </>
  );
}

function TradePick({ value, onChange, names, blank }: {
  value: string; onChange: (t: string) => void; names: string[]; blank?: string;
}) {
  return (
    <label className="nb-fld" style={{ flex: "1 1 160px" }}>
      <span>Trade</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{blank ?? "Choose the trade…"}</option>
        {names.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
    </label>
  );
}

// WHO HOLDS IT: you, the people on that trade (here today first), then
// whoever else is on site today.
function WhoPick({ desk, trade, value, onChange }: {
  desk: VisitBoard; trade: string; value: string; onChange: (v: string) => void;
}) {
  const onTrade = desk.people.filter((p) => p.trade === trade && p.contact_id !== desk.me)
    .sort((a, b) => Number(b.on_site) - Number(a.on_site) || a.name.localeCompare(b.name));
  const seen = new Set([desk.me, ...onTrade.map((p) => p.contact_id)]);
  const others = desk.roster.filter((r) => !seen.has(r.contact_id));
  return (
    <label className="nb-fld" style={{ flex: "1 1 160px" }}>
      <span>Who</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Nobody yet</option>
        {desk.me && <option value={desk.me}>Me</option>}
        {onTrade.length > 0 && (
          <optgroup label={trade ? `On ${trade.toLowerCase()}` : "On this trade"}>
            {onTrade.map((p) => <option key={p.contact_id} value={p.contact_id}>{p.name}{p.on_site ? " · here today" : ""}</option>)}
          </optgroup>
        )}
        {others.length > 0 && (
          <optgroup label="Also on site today">
            {others.map((r) => <option key={r.contact_id} value={r.contact_id}>{r.name}</option>)}
          </optgroup>
        )}
      </select>
    </label>
  );
}

function TaskForm({ kind, projectId, desk, tradeNames, trade, setTrade, jobFor }: {
  kind: "task" | "punch"; projectId: string; desk: VisitBoard; tradeNames: string[];
  trade: string; setTrade: (t: string) => void; jobFor: (t: string) => string;
}) {
  const [what, setWhat] = useState("");
  const [who, setWho] = useState("");
  const [due, setDue] = useState("");
  const [files, setFiles] = useState<Attached[]>([]);
  const [round, setRound] = useState(0);
  const { busy, err, done, send } = useSend();
  // A punch item under an existing punch-list step lands on that step's job,
  // so its photo is uploaded there.
  const job = kind === "punch" ? (desk.punch_on[trade] ?? jobFor(trade)) : (trade ? jobFor(trade) : desk.default_job ?? projectId);
  const ready = what.trim().length > 0 && (kind === "task" || trade.length > 0);

  async function add() {
    if (!ready || busy) return;
    const ids = files.length > 0 ? files.map((f) => f.id) : null;
    const r = kind === "punch"
      ? await send("portal_punch_add", {
          p_project: projectId, p_trade: trade, p_what: what.trim(), p_assignee: who || null,
          p_target_date: due || null, p_file_ids: ids, p_job: jobFor(trade),
        }, `Added to the ${trade.toLowerCase()} punch list.`)
      : await send("portal_task_quick", {
          p_project: job, p_action: what.trim(), p_trade: trade || null, p_target_date: due || null,
          p_assignee: who || null, p_file_ids: ids,
        }, `Added “${what.trim()}”.`);
    if (r) { setWhat(""); setDue(""); setFiles([]); setRound((n) => n + 1); }
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <input className="input" value={what} maxLength={300} onChange={(e) => setWhat(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } }}
        placeholder={kind === "punch" ? "Caulk missing at the kitchen window" : "Call the framer about the landing"}
        aria-label={kind === "punch" ? "The punch item" : "The task"} />
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <TradePick value={trade} onChange={setTrade} names={tradeNames}
          blank={kind === "task" ? "No trade" : undefined} />
        <WhoPick desk={desk} trade={trade} value={who} onChange={setWho} />
        <label className="nb-fld" style={{ flex: "1 1 140px" }}>
          <span>{kind === "punch" ? "Fixed by" : "Due"}</span>
          <input className="input" type="date" value={due} min={desk.today} onChange={(e) => setDue(e.target.value)} />
        </label>
      </div>
      {(kind === "task" || trade) && (
        <Evidence key={`${job}-${round}`} projectId={job} caption={kind === "punch" ? "Punch item" : "Site visit task"}
          onChange={setFiles} />
      )}
      <button type="button" className="btn btn-primary" disabled={!ready || busy} onClick={() => { void add(); }}>
        {busy ? "…" : kind === "punch" ? "Add to punch list" : "Add task"}
      </button>
      {kind === "punch" && !trade && <p className="tiny text-muted" style={{ margin: 0 }}>A punch item belongs to a trade — pick whose it is.</p>}
      <Said err={err} done={done} />
    </div>
  );
}

function PayLink({ projectId, back, trade, setTrade, tradeNames }: {
  projectId: string; back: string; trade: string; setTrade: (t: string) => void; tradeNames: string[];
}) {
  const q = new URLSearchParams({ back, ...(trade ? { trade } : {}) }).toString();
  return (
    <div className="stack" style={{ gap: 8 }}>
      <TradePick value={trade} onChange={setTrade} names={tradeNames} blank="Any trade" />
      {/* The payment screen already files money against a task, a contract
          and a budget line; this only takes you there with the trade chosen
          and brings you back afterwards. */}
      <Link href={`/project/${projectId}/pay?${q}`} className="btn btn-primary">Log the payment</Link>
    </div>
  );
}

function PermitForm({ desk, jobFor }: {
  desk: VisitBoard; jobFor: (t: string) => string;
}) {
  const [body, setBody] = useState("");
  const [follow, setFollow] = useState(false);
  const [task, setTask] = useState("");
  const [due, setDue] = useState("");
  const [who, setWho] = useState(desk.me ?? "");
  const [files, setFiles] = useState<Attached[]>([]);
  const [round, setRound] = useState(0);
  const { busy, err, done, send, setErr } = useSend();
  // The note sits on the job the town's work lands on, so its follow-up task
  // can land there too.
  const job = jobFor(PERMITS_TRADE);
  const ready = body.trim().length > 0 && (!follow || task.trim().length > 0);

  async function add() {
    if (!ready || busy) return;
    const n = await send("portal_note_add", {
      p_body: body.trim(), p_project: job, p_trade: PERMITS_TRADE, p_screen: "site-visit:permit",
      p_intent: "note", p_file_ids: files.length > 0 ? files.map((f) => f.id) : null,
    }, "Permit conversation logged.");
    if (!n) return;
    if (follow) {
      const { data, error } = await createClient().rpc("portal_note_to_task", {
        p_note: n.id, p_action: task.trim(), p_target_date: due || null, p_assignee: who || null, p_project: job,
      });
      if (error || !data?.ok) { setErr(`The note is saved, but the follow-up was not: ${error ? friendly(error.message) : data?.reason}`); return; }
    }
    setBody(""); setTask(""); setDue(""); setFollow(false); setFiles([]); setRound((r) => r + 1);
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <textarea className="input" rows={3} value={body} onChange={(e) => setBody(e.target.value)}
        placeholder="Spoke to the zoning officer - plot plan needs the new setback. Resubmit, 2-week review." />
      <Evidence key={round} projectId={job} caption="Permit conversation" onChange={setFiles} />
      <label className="row" style={{ gap: 6, alignItems: "center", margin: 0, cursor: "pointer" }}>
        <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
        <span className="small" style={{ fontWeight: 700 }}>Needs a follow-up</span>
      </label>
      {follow && (
        <div className="stack" style={{ gap: 8 }}>
          <input className="input" value={task} maxLength={300} onChange={(e) => setTask(e.target.value)}
            placeholder="Resubmit the plot plan" aria-label="The follow-up" />
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <WhoPick desk={desk} trade={PERMITS_TRADE} value={who} onChange={setWho} />
            <label className="nb-fld" style={{ flex: "1 1 140px" }}>
              <span>By</span>
              <input className="input" type="date" value={due} min={desk.today} onChange={(e) => setDue(e.target.value)} />
            </label>
          </div>
        </div>
      )}
      <button type="button" className="btn btn-primary" disabled={!ready || busy} onClick={() => { void add(); }}>
        {busy ? "…" : follow ? "Log it and make the follow-up" : "Log the conversation"}
      </button>
      <p className="tiny text-muted" style={{ margin: 0 }}>Filed under <strong>{PERMITS_TRADE}</strong>, and on the Permits shelf of the library when it carries a file.</p>
      <Said err={err} done={done} />
    </div>
  );
}

function LearningForm({ projectId, tradeNames, trade, setTrade }: {
  projectId: string; tradeNames: string[]; trade: string; setTrade: (t: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [checklist, setChecklist] = useState(true);
  const { busy, err, done, send } = useSend();
  async function add() {
    if (!title.trim() || busy) return;
    const r = await send("portal_learning_add", {
      p_project: projectId, p_title: title.trim(), p_detail: detail.trim() || null,
      p_trade: trade || null, p_checklist: checklist,
    }, "Learning kept.");
    if (r) { setTitle(""); setDetail(""); }
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <input className="input" value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)}
        placeholder="Set the window bucks before the sheathing crew arrives" aria-label="What was learned" />
      <textarea className="input" rows={2} value={detail} onChange={(e) => setDetail(e.target.value)}
        placeholder="Why, and what it cost this time (optional)" />
      <TradePick value={trade} onChange={setTrade} names={tradeNames} blank="Any trade" />
      <label className="row" style={{ gap: 6, alignItems: "center", margin: 0, cursor: "pointer" }}>
        <input type="checkbox" checked={checklist} onChange={(e) => setChecklist(e.target.checked)} />
        <span className="small">Put it on the checklist when this trade is scoped on the next job</span>
      </label>
      <button type="button" className="btn btn-primary" disabled={!title.trim() || busy} onClick={() => { void add(); }}>
        {busy ? "…" : "Keep this learning"}
      </button>
      <Said err={err} done={done} />
    </div>
  );
}

const NEW = "__new__";

function BidForm({ desk, tradeNames, trade, setTrade, jobFor }: {
  desk: VisitBoard; tradeNames: string[]; trade: string; setTrade: (t: string) => void; jobFor: (t: string) => string;
}) {
  const [who, setWho] = useState("");
  const [company, setCompany] = useState("");
  const [person, setPerson] = useState("");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [scope, setScope] = useState("");
  const [until, setUntil] = useState("");
  const { busy, err, done, send } = useSend();
  const onTrade = desk.people.filter((p) => p.trade === trade);
  const n = Number(amount.replace(/[$,\s]/g, ""));
  const priced = amount.trim().length > 0 && Number.isFinite(n) && n >= 0;
  const named = who && (who !== NEW || company.trim() || person.trim());
  const ready = !!trade && !!named && (priced || scope.trim().length > 0);

  async function add() {
    if (!ready || busy) return;
    const r = await send("portal_site_bid_log", {
      p_job: jobFor(trade), p_trade: trade,
      p_contact: who === NEW ? null : who,
      p_company_name: who === NEW ? company.trim() || null : null,
      p_person_name: who === NEW ? person.trim() || null : null,
      p_phone: who === NEW ? phone.trim() || null : null,
      p_amount: priced ? n : null, p_scope: scope.trim() || null, p_valid_until: until || null,
    }, `In the ${trade.toLowerCase()} bid room.`);
    if (r) { setAmount(""); setScope(""); setUntil(""); }
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <TradePick value={trade} onChange={(t) => { setTrade(t); setWho(""); }} names={tradeNames} />
        <label className="nb-fld" style={{ flex: "1 1 160px" }}>
          <span>Who priced it</span>
          <select className="input" value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="" disabled>Choose who…</option>
            {onTrade.map((p) => <option key={p.contact_id} value={p.contact_id}>{p.name}</option>)}
            <option value={NEW}>Someone else — type the name</option>
          </select>
        </label>
      </div>
      {who === NEW && (
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <input className="input" style={{ flex: "1 1 160px" }} value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company" />
          <input className="input" style={{ flex: "1 1 140px" }} value={person} onChange={(e) => setPerson(e.target.value)} placeholder="Person" />
          <input className="input" style={{ flex: "1 1 120px" }} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" inputMode="tel" />
        </div>
      )}
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <label className="nb-fld" style={{ flex: "1 1 120px" }}>
          <span>Price</span>
          <input className="input" inputMode="decimal" value={amount} placeholder="$" onChange={(e) => setAmount(e.target.value)} />
        </label>
        <label className="nb-fld" style={{ flex: "1 1 140px" }}>
          <span>Good until</span>
          <input className="input" type="date" value={until} min={desk.today} onChange={(e) => setUntil(e.target.value)} />
        </label>
      </div>
      <textarea className="input" rows={2} value={scope} onChange={(e) => setScope(e.target.value)}
        placeholder="What it covers - and what it leaves out" />
      <button type="button" className="btn btn-primary" disabled={!ready || busy} onClick={() => { void add(); }}>
        {busy ? "…" : "Put it in the bid room"}
      </button>
      <p className="tiny text-muted" style={{ margin: 0 }}>
        Opens or joins the {trade ? trade.toLowerCase() : "trade's"} bid package, adds them as a bidder and records the number — it compares and awards like any other bid.
      </p>
      <Said err={err} done={done} />
    </div>
  );
}
