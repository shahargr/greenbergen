"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@shared/supabase/client";
import { friendly } from "@shared/rpc";

// TWO WAYS TO PUT SOMEBODY ON A TRADE, AND THE SHORTCUT IS THE COMMON ONE.
//
// Shahar (2026-09-16): "if you are waiting on the business to be awarded,
// let's open a wizard to award the business in cases we did a shortcut and
// pre-selected a contractor. in this case for example, you already have a
// contract with Marcel Blanco I believe."
//
// The bid round is the formal path and it is the rarer one. Most trades on a
// real job arrive the other way: you already know who does your masonry, you
// ring them, and the paperwork catches up. Offering only the bid made the
// short path look unsupported when the award screen has existed all along -
// it just had no door from here.
//
// So both, side by side, with the direct award FIRST because it is what
// actually happens. The bid writes one line on whoever runs the job; the
// award opens the screen that writes a seat and a contract, already filtered
// to this trade.
export function Engage({ projectId, trade, back, who, landsOn }: {
  /** The screen you are standing on - which may be a PROPERTY. */
  projectId: string;
  trade: string;
  back: string;
  /** Somebody already named on a contract for this trade, awarded or not. */
  who: string | null;
  // WHERE THE WORK ACTUALLY GOES. A property holds no work, its jobs do, so
  // both buttons have to aim at a job rather than at whatever screen this is.
  // Shahar (2026-09-16) pressed "Award it to someone" from the property and
  // got "This is the property, not a job" - the award screen was right and my
  // link was wrong. Null when the trade has no job yet at all: then there is
  // nothing honest to point at and the card says so instead.
  landsOn: { id: string; name: string | null } | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [went, setWent] = useState(false);
  const [err, setErr] = useState("");

  async function bid() {
    if (!landsOn) return;
    setBusy(true); setErr("");
    const { data, error } = await createClient()
      .rpc("portal_trade_start_bid", { p_project: landsOn.id, p_trade: trade });
    setBusy(false);
    if (error) { setErr(friendly(error.message)); return; }
    if (!data?.ok) { setErr(data?.reason ?? "That could not be started."); return; }
    setWent(true);
    router.refresh();
  }

  return (
    <div className="card pad stack" style={{ gap: 10 }}>
      <div>
        <div className="small" style={{ fontWeight: 800 }}>
          Nobody is appointed for {trade.toLowerCase()} yet.
        </div>
        <div className="tiny text-muted" style={{ marginTop: 2 }}>
          {who
            ? <>You have a contract naming <strong>{who}</strong>, but nothing signed or awarded.
              Award it and the work can start being logged against them.</>
            : <>You can still log tasks here — this only decides who is doing them.</>}
        </div>
      </div>

      {landsOn ? (
        <>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {/* THE SHORTCUT, FIRST. The award screen already takes ?trade= and
                opens filtered to it - including fields for somebody who is not
                on your list yet - it simply had no way in from the trade. */}
            <Link href={`/project/${landsOn.id}/award?trade=${encodeURIComponent(trade)}&back=${encodeURIComponent(back)}`}
              className="btn btn-primary" style={{ flex: "1 1 auto", minWidth: 150 }}>
              Award it to someone
            </Link>
            <button type="button" className="btn btn-secondary" disabled={busy || went}
              style={{ flex: "1 1 auto", minWidth: 150 }}
              onClick={() => { void bid(); }}>
              {went ? "Bid started" : busy ? "…" : "Run a bid instead"}
            </button>
          </div>
          {/* Said out loud when it is not the screen you are on, because
              landing on a different job's award page is otherwise a surprise. */}
          {landsOn.id !== projectId && landsOn.name && (
            <p className="tiny text-muted" style={{ margin: 0 }}>
              This lands on <strong>{landsOn.name}</strong> — a property holds no work, its jobs do.
            </p>
          )}
        </>
      ) : (
        <p className="tiny text-muted" style={{ margin: 0 }}>
          There is no job under this property for {trade.toLowerCase()} yet, and work is awarded on a
          job rather than on the property. Start one and this trade can be awarded on it.
        </p>
      )}

      {went && (
        <p className="tiny" style={{ color: "var(--color-ok)", margin: 0 }}>
          Added <em>Run the bid for {trade}</em> to your list. It is invisible to the trades.
        </p>
      )}
      {err && <p className="tiny" style={{ color: "var(--color-danger)", margin: 0 }}>{err}</p>}
    </div>
  );
}
