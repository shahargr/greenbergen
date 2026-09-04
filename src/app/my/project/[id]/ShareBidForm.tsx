"use client";

import { useState } from "react";
import { shareBid } from "./actions";

export type Candidate = {
  contact_id: string; name: string; company: string | null; trades: string[];
  on_this_project: boolean; already_invited: boolean;
};

// Who may answer a bid is decided by what they do. A lumber yard does not get
// asked to install a generator: a contact whose trades are known and do not
// include the one being bid is set aside, with the reason on the screen.
// A contact with no trades on record is not wrong, only unknown — they stay
// selectable and are flagged so the gap gets filled.
export function ShareBidForm({ projectId, candidates, trades }: {
  projectId: string; candidates: Candidate[]; trades: string[];
}) {
  const [trade, setTrade] = useState(trades[0] ?? "");
  const [showOthers, setShowOthers] = useState(false);

  // The whole job is a general contractor's bid, not an open call.
  const wanted = trade || "General Contractor";
  const fits = (c: Candidate) =>
    c.trades.length === 0 ? "unknown"
    : c.trades.some((t) => t.toLowerCase() === wanted.toLowerCase()) ? "match"
    : "other";

  const fresh = candidates.filter((c) => !c.already_invited);
  const match = fresh.filter((c) => fits(c) === "match");
  const unknown = fresh.filter((c) => fits(c) === "unknown");
  const other = fresh.filter((c) => fits(c) === "other");
  const invited = candidates.filter((c) => c.already_invited);

  const row = (c: Candidate, selectable: boolean, why?: string) => (
    <label key={c.contact_id} className="small"
      style={{ display: "flex", gap: 8, alignItems: "baseline", margin: 0, opacity: selectable ? 1 : 0.6 }}>
      <input type="checkbox" name="contact" value={c.contact_id} disabled={!selectable} />
      <span style={{ minWidth: 0 }}>
        <strong>{c.name}</strong>
        {c.company && <span className="muted"> · {c.company}</span>}
        {c.trades.length > 0 && <span className="muted"> · {c.trades.join(", ")}</span>}
        {c.on_this_project && <span className="extra-chip" style={{ marginLeft: 6, fontSize: 10 }}>on this project</span>}
        {why && <span className="muted" style={{ fontSize: 11 }}> · {why}</span>}
      </span>
    </label>
  );

  return (
    <form action={shareBid.bind(null, projectId)} style={{ display: "grid", gap: 8 }}>
      <div className="form-2col">
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="sb-trade">For which trade</label>
          <select id="sb-trade" name="trade" className="input" value={trade}
            onChange={(e) => { setTrade(e.target.value); setShowOthers(false); }}>
            <option value="">The whole job (general contractor)</option>
            {trades.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="sb-by">Answer by</label>
          <input id="sb-by" name="reply_by" className="input" type="date" />
        </div>
      </div>

      <div style={{ display: "grid", gap: 4 }}>
        <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4 }}>
          {wanted} · {match.length} {match.length === 1 ? "match" : "matches"}
        </div>
        {match.length === 0 && (
          <p className="muted small" style={{ margin: 0 }}>
            Nobody on your list does {wanted}. Invite one, or record the trade on someone who does.
          </p>
        )}
        {match.map((c) => row(c, true))}

        {unknown.length > 0 && (
          <>
            <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 6 }}>
              No trades on record · {unknown.length}
            </div>
            {unknown.map((c) => row(c, true, "trade not listed"))}
          </>
        )}
      </div>

      {other.length > 0 && (
        <div style={{ borderTop: "1px solid #eef0ec", paddingTop: 6 }}>
          <button type="button" className="btn ghost small" onClick={() => setShowOthers((v) => !v)}>
            {showOthers ? "Hide" : `${other.length} other${other.length === 1 ? "" : "s"} do different work`}
          </button>
          {showOthers && (
            <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
              <p className="muted small" style={{ margin: 0 }}>
                These do not list {wanted}, so they cannot be sent this bid. Change their trades on their contact page if that is wrong.
              </p>
              {other.map((c) => row(c, false))}
            </div>
          )}
        </div>
      )}

      <div><button className="btn small">Send the brief</button></div>

      {invited.length > 0 && (
        <p className="muted small" style={{ margin: 0, borderTop: "1px solid #eef0ec", paddingTop: 6 }}>
          Already holding this brief: {invited.map((c) => c.name).join(", ")}.
        </p>
      )}
    </form>
  );
}
