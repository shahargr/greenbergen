"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@shared/supabase/client";
import { friendly } from "@shared/rpc";

// THE TRADES THIS JOB NEEDS AND NOBODY HAS STARTED.
//
// Shahar (2026-09-15): "what's also important is that you put them in and say
// that right now what you need to do, you need to start an engagement... You
// put on a project manager, a task, run a bid for a framer, a task, run a bid
// for a plumber, etc."
//
// A trade with nothing open is not an empty panel - it is the next decision.
// It costs one tap: the line lands on whoever runs the job, filed under the
// trade, and the trade's own package grows from there. The chip goes quiet
// rather than disappearing, because the row it would leave behind is what
// tells you the tap worked.
export function StartTrade({ projectId, trades }: {
  projectId: string;
  /** Trades the job has - from a contract, a scope line or a bid need - with nothing open. */
  trades: { trade: string; who: string | null }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, true>>({});
  const [err, setErr] = useState("");

  async function start(trade: string) {
    setBusy(trade); setErr("");
    const { data, error } = await createClient()
      .rpc("portal_trade_start_bid", { p_project: projectId, p_trade: trade });
    setBusy(null);
    if (error) { setErr(friendly(error.message)); return; }
    if (!data?.ok) { setErr(data?.reason ?? "That could not be started."); return; }
    setDone((d) => ({ ...d, [trade]: true }));
    router.refresh();
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="idle-trades">
        {trades.map((t) => (
          <div key={t.trade} className={`idle-chip${done[t.trade] ? " went" : ""}`}>
            <span className="grow" style={{ minWidth: 0 }}>
              <span className="t">{t.trade}</span>
              {/* Somebody we have used here before is worth saying - it is
                  often the answer to "who do we call", and it is already in
                  the contracts. It does NOT mean they are appointed. */}
              {t.who && <span className="m">{t.who}</span>}
            </span>
            <button type="button" className="go" disabled={busy === t.trade || !!done[t.trade]}
              onClick={() => { void start(t.trade); }}>
              {done[t.trade] ? "Started" : busy === t.trade ? "…" : "Run the bid"}
            </button>
          </div>
        ))}
      </div>
      {err && <p className="tiny" style={{ color: "var(--color-danger)", margin: 0 }}>{err}</p>}
      <p className="tiny text-muted" style={{ margin: 0 }}>
        Starting one writes a single line on you — <em>Run the bid for …</em> — filed under the trade.
        The scope, the selection, the insurance and the punch list are written when the bid actually begins.
        None of it is visible to the trades.
      </p>
    </div>
  );
}
