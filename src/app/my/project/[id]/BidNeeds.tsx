import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { seedBidNeeds, addBidNeed, removeBidNeed } from "./actions";

export type BidNeed = {
  id: string; trade: string | null; label: string; note: string | null;
  kind: "trade" | "permit" | "purchase" | "service";
  is_required: boolean; source: "manual" | "blueprint";
  pkg_id: string | null; pkg_status: string | null; awarded: boolean;
};

const KIND_ICON: Record<string, string> = { trade: "🔧", permit: "🏛", purchase: "🛒", service: "📋" };

// Everything this project has to line up before it can be built: one line per
// trade, permit or purchase. Seeded from the trade blueprint by subject, then
// edited by hand. Each line can become a bid package.
export async function BidNeeds({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("portal_bid_needs", { p_project: projectId });
  const needs = ((data ?? []) as BidNeed[]);
  const covered = needs.filter((n) => n.pkg_id).length;

  return (
    <div id="bid-needs" className="card" style={{ display: "grid", gap: 8, minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2 className="section-title" style={{ margin: 0 }}>
          Bids needed · {needs.length}{needs.length > 0 ? ` · ${covered} with a package` : ""}
        </h2>
        {canEdit && (
          <form action={seedBidNeeds.bind(null, projectId)}>
            <button className={needs.length === 0 ? "btn small" : "btn ghost small"}>
              {needs.length === 0 ? "Fill from the blueprint" : "Check the blueprint again"}
            </button>
          </form>
        )}
      </div>

      {needs.length === 0 && (
        <p className="muted small" style={{ margin: 0 }}>
          Nothing listed yet. The blueprint knows which trades a job like this needs — fill the list from it, then add or drop lines by hand.
        </p>
      )}

      {needs.map((n) => (
        <div key={n.id} className="small" style={{ display: "grid", gap: 2, borderTop: "1px solid #f0f1ee", paddingTop: 6, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", minWidth: 0 }}>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              <span style={{ marginRight: 6 }}>{KIND_ICON[n.kind] ?? "🔧"}</span>
              <strong>{n.label}</strong>
              {n.trade && n.trade !== n.label && <span className="muted"> · {n.trade}</span>}
            </span>
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center", whiteSpace: "nowrap" }}>
              {n.awarded
                ? <span className="extra-chip" style={{ background: "#e6f2ea", color: "#1f6b45" }}>awarded</span>
                : n.pkg_id
                  ? <Link href={`/my/project/${projectId}/bids/${n.pkg_id}`} className="extra-chip" style={{ textDecoration: "none" }}>{n.pkg_status}</Link>
                  : <span className="extra-chip" style={{ background: "#fdf4e3", color: "#a8842c" }}>no package</span>}
              {canEdit && !n.pkg_id && (
                <Link href={`/my/project/${projectId}/bids`} className="btn ghost small" style={{ padding: "2px 8px" }}>Package →</Link>
              )}
              {canEdit && (
                <form action={removeBidNeed.bind(null, projectId, n.id)}>
                  <button className="btn ghost small" title="Remove this line" aria-label={`Remove ${n.label}`}
                    style={{ padding: "2px 8px", color: "#c0262d" }}>✕</button>
                </form>
              )}
            </span>
          </div>
          {n.note && (
            <span className="muted" style={{ fontSize: 11, lineHeight: 1.35, display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>
              {n.note.length > 180 ? `${n.note.slice(0, 180)}…` : n.note}
            </span>
          )}
        </div>
      ))}

      {canEdit && (
        <details style={{ marginTop: 2 }}>
          <summary className="small" style={{ cursor: "pointer", fontWeight: 700 }}>＋ Add a line</summary>
          <form action={addBidNeed.bind(null, projectId)} style={{ display: "grid", gap: 8, marginTop: 8 }}>
            <div className="form-2col">
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="bn-label">What is needed</label>
                <input id="bn-label" name="label" className="input" required placeholder="Concrete pad" />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="bn-trade">Trade (optional)</label>
                <input id="bn-trade" name="trade" className="input" placeholder="Masonry" />
              </div>
            </div>
            <div className="radio-row" style={{ minHeight: 0 }}>
              <label className="radio-opt"><input type="radio" name="kind" value="trade" defaultChecked /> Trade</label>
              <label className="radio-opt"><input type="radio" name="kind" value="permit" /> Permit</label>
              <label className="radio-opt"><input type="radio" name="kind" value="purchase" /> Purchase</label>
              <label className="radio-opt"><input type="radio" name="kind" value="service" /> Service</label>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="bn-note">Note (optional)</label>
              <input id="bn-note" name="note" className="input" placeholder="What the bidder has to cover" />
            </div>
            <div className="btn-row"><button className="btn small">Add to the list</button></div>
          </form>
        </details>
      )}
    </div>
  );
}
