"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@shared/supabase/client";
import { friendly } from "@shared/rpc";

// A TRADE JOINS THE JOB FROM ITS PANEL.
//
// Shahar (2026-09-17), on the Rough panel: "i want to start another trade on
// the job, roofing. how would i add it here? i envision adding it, and then
// starting phase 1 designing the scope, moving into vendor selection,
// delivery and inspection."
//
// The last tile in a panel's grid is this one. It opens a picker that leads
// with the trades of the panel you are standing in that are not yet on the
// job, keeps the rest of the build behind it, and one tap later the trade is
// on the job's list with its package open - scope, selection, paperwork,
// delivery, inspection - as five steps under one task (portal_trade_add,
// migration 170). Then it takes you to the trade's own screen, which is
// where phase 1 is done.
export type CatalogueTrade = {
  trade: string; stage: string | null; panel: string; panel_order: number; on_job: boolean;
};
export type JobChoice = { id: string; name: string };

export function AddTrade({ panel, catalogue, jobs, defaultJob, back }: {
  panel: string;
  catalogue: CatalogueTrade[];
  /** The jobs a trade can land on. A property holds no work, its jobs do. */
  jobs: JobChoice[];
  defaultJob: string;
  back: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [trade, setTrade] = useState("");
  const [job, setJob] = useState(defaultJob);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const here = catalogue.filter((t) => t.panel === panel && !t.on_job);
  const elsewhere = catalogue.filter((t) => t.panel !== panel && !t.on_job);

  async function add() {
    if (!trade || !job) return;
    setBusy(true); setErr("");
    const { data, error } = await createClient()
      .rpc("portal_trade_add", { p_project: job, p_trade: trade });
    if (error) { setBusy(false); setErr(friendly(error.message)); return; }
    if (!data?.ok) { setBusy(false); setErr(data?.reason ?? "That could not be added."); return; }
    // Straight to the trade, where phase 1 lives.
    router.push(`/project/${job}/trade/${encodeURIComponent(data.trade as string)}?back=${encodeURIComponent(back)}`);
  }

  return (
    <>
      <button type="button" className={`tp idle add${open ? " asking" : ""}`} aria-expanded={open}
        onClick={() => setOpen((o) => !o)} title={`Add a trade under ${panel}`}>
        <span className="art plus" aria-hidden>+</span>
        <span className="st">{panel}</span>
        <span className="t">Add a trade</span>
        <span className="f">
          <span className="say">{here.length > 0 ? `${here.length} to choose from` : "the rest of the build"}</span>
        </span>
      </button>

      {open && (
        <div className="card pad stack add-trade" style={{ gap: 10 }}>
          <div>
            <div className="small" style={{ fontWeight: 800 }}>Start a trade on this job</div>
            <p className="tiny text-muted" style={{ margin: "2px 0 0" }}>
              It joins the job&rsquo;s list and opens its package: the scope in writing, choosing who
              does it, the paperwork, the work itself, and the punch list and inspection &mdash; five
              steps you close as it goes.
            </p>
          </div>

          {jobs.length > 1 && (
            <label className="field">
              <span className="field-label">On which job</span>
              <select className="input" value={job} onChange={(e) => setJob(e.target.value)}>
                {jobs.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
              </select>
            </label>
          )}

          <label className="field">
            <span className="field-label">Which trade</span>
            <select className="input" value={trade} onChange={(e) => setTrade(e.target.value)}>
              <option value="">Choose a trade…</option>
              {here.length > 0 && (
                <optgroup label={`In ${panel}`}>
                  {here.map((t) => <option key={t.trade} value={t.trade}>{t.trade}</option>)}
                </optgroup>
              )}
              <optgroup label="Elsewhere in the build">
                {elsewhere.map((t) => <option key={t.trade} value={t.trade}>{t.trade} · {t.panel}</option>)}
              </optgroup>
            </select>
          </label>

          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-primary" disabled={!trade || busy}
              style={{ flex: "1 1 auto" }} onClick={() => { void add(); }}>
              {busy ? "Opening…" : trade ? `Add ${trade.toLowerCase()} and open its package` : "Add it"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => { setOpen(false); setErr(""); }}>
              Cancel
            </button>
          </div>
          {err && <p className="tiny" style={{ color: "var(--color-danger)", margin: 0 }}>{err}</p>}
        </div>
      )}
    </>
  );
}
