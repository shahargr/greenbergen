import { createClient } from "@/lib/supabase/server";
import { saveScopeItem, deleteScopeItem } from "./actions";

type Line = {
  id: string; trade: string | null; item: string; owner_summary: string | null;
  audience: "owner" | "contractor" | "both"; evidence: unknown[];
};

// What the owner wants, said the way they would say it. The trade blueprint
// lives on the contractor's side of the same scope; a line that matters to
// both is written twice, once in each language.
export async function OwnerScope({ projectId, canEdit, add }: {
  projectId: string; canEdit: boolean; add?: boolean;
}) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("portal_scope_evidence", { p_project: projectId });
  const all = ((data ?? []) as Line[]);
  const mine = all.filter((l) => l.audience === "owner" || l.audience === "both");
  const trade = all.filter((l) => l.audience === "contractor").length;

  return (
    <div id="owner-scope" className="card" style={{ display: "grid", gap: 8, minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2 className="section-title" style={{ margin: 0 }}>What you want · {mine.length}</h2>
        {trade > 0 && <span className="muted small">{trade} technical line{trade === 1 ? "" : "s"} sit with the trade</span>}
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        In your words, as the result you are paying for. The trade&apos;s own checklist is separate and goes into the proposal.
      </p>

      {mine.length === 0 && <p className="muted small" style={{ margin: 0 }}>Nothing written yet.</p>}
      {mine.map((l) => (
        <div key={l.id} className="small" style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", borderTop: "1px solid #eef0ec", paddingTop: 6, minWidth: 0 }}>
          <span style={{ minWidth: 0 }}>
            {l.owner_summary ?? l.item}
            {l.audience === "both" && <span className="muted"> · also priced by the trade</span>}
          </span>
          {canEdit && (
            <form action={deleteScopeItem.bind(null, projectId, l.id)} style={{ flex: "none" }}>
              <button className="btn ghost small" style={{ padding: "1px 8px", color: "#c0262d" }} aria-label="Remove this line">✕</button>
            </form>
          )}
        </div>
      ))}

      {canEdit && (
        <form action={saveScopeItem.bind(null, projectId)} style={{ display: "grid", gap: 8, borderTop: "1px solid #eef0ec", paddingTop: 10 }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="os-owner">What you want</label>
            <input id="os-owner" name="owner_summary" className="input" required
              placeholder="The power comes back on by itself when the grid drops" />
          </div>
          <details>
            <summary className="small muted" style={{ cursor: "pointer" }}>Say it in trade terms too (optional)</summary>
            <div className="field" style={{ marginBottom: 0, marginTop: 8 }}>
              <label htmlFor="os-item">What the contractor prices</label>
              <input id="os-item" name="item" className="input"
                placeholder="Automatic transfer switch, service-rated, whole-house" />
              <p className="muted" style={{ fontSize: 11, margin: "4px 0 0" }}>
                Fill this and the line goes to both sides: your words on this page, these words in the proposal.
              </p>
            </div>
          </details>
          <div><button className="btn small">Add to scope</button></div>
        </form>
      )}
    </div>
  );
}
