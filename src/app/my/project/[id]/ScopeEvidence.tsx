import { createClient } from "@/lib/supabase/server";
import { FileDrop } from "@/components/FileDrop";
import { addScopeEvidence } from "./actions";
import { acceptFor, type Caps } from "@/lib/caps";

type Evidence = {
  file_id: string; file_name: string; kind: string | null; mime: string | null;
  bucket: string; path: string; role: string; at: string; who: string | null;
};
type Line = {
  id: string; trade: string | null; item: string; category: string | null;
  is_required: boolean; authority: string; evidence: Evidence[];
};

// The scope of work, line by line, with the proof against each one. The
// contractor doing the work and the owner who wrote the scope add to the same
// list — a bid is priced from these lines, and this is where they are shown
// to have been delivered.
export async function ScopeEvidence({ projectId, caps, canAdd, openLine }: {
  projectId: string; caps: Caps; canAdd: boolean; openLine?: string;
}) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("portal_scope_evidence", { p_project: projectId });
  const lines = ((data ?? []) as Line[]);
  if (lines.length === 0) return null;

  const urls = new Map<string, string>();
  await Promise.all(lines.flatMap((l) => l.evidence).map(async (e) => {
    const { data: s } = await supabase.storage.from(e.bucket).createSignedUrl(e.path, 3600);
    if (s?.signedUrl) urls.set(e.file_id, s.signedUrl);
  }));

  const withProof = lines.filter((l) => l.evidence.length > 0).length;
  const byTrade = new Map<string, Line[]>();
  for (const l of lines) {
    const k = l.trade ?? "Other";
    byTrade.set(k, [...(byTrade.get(k) ?? []), l]);
  }

  return (
    <div id="scope-evidence" className="card" style={{ display: "grid", gap: 8, minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2 className="section-title" style={{ margin: 0 }}>Scope &amp; evidence · {withProof}/{lines.length} shown done</h2>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Every line the work was priced from. Add a photo against a line and it stands as the proof that line was delivered.
      </p>

      {[...byTrade.entries()].map(([trade, rows]) => (
        <div key={trade} style={{ display: "grid", gap: 6, borderTop: "1px solid #eef0ec", paddingTop: 8 }}>
          <strong className="small">
            {trade} · {rows.filter((r) => r.evidence.length > 0).length}/{rows.length}
          </strong>
          {rows.map((l) => (
            <details key={l.id} open={openLine === l.id} style={{ minWidth: 0 }}>
              <summary className="small" style={{ cursor: "pointer", display: "flex", gap: 8, alignItems: "baseline", minWidth: 0 }}>
                <span style={{ color: l.evidence.length > 0 ? "#1f6b45" : "#c9ccc4" }}>
                  {l.evidence.length > 0 ? "●" : "○"}
                </span>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {l.item.length > 120 ? `${l.item.slice(0, 120)}…` : l.item}
                </span>
                <span className="muted" style={{ marginLeft: "auto", whiteSpace: "nowrap", fontSize: 11 }}>
                  {l.evidence.length > 0 ? `${l.evidence.length} file${l.evidence.length === 1 ? "" : "s"}` : "no proof yet"}
                </span>
              </summary>

              <div style={{ display: "grid", gap: 8, marginTop: 8, paddingLeft: 18 }}>
                {l.evidence.length > 0 && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
                    {l.evidence.map((e) => {
                      const u = urls.get(e.file_id);
                      const isImg = (e.mime ?? "").startsWith("image/") || e.kind === "photo";
                      return (
                        <a key={e.file_id} href={u ?? "#"} target="_blank" rel="noreferrer"
                          title={`${e.file_name} · ${e.role}${e.who ? ` · ${e.who}` : ""}`}
                          style={{ display: "grid", gap: 2, textDecoration: "none", color: "inherit", minWidth: 0 }}>
                          {isImg && u
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={u} alt={e.file_name} style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", borderRadius: 8, border: "1px solid #e7e9e4" }} />
                            : <span style={{ display: "grid", placeItems: "center", width: "100%", aspectRatio: "1 / 1", borderRadius: 8, border: "1px solid #e7e9e4", background: "#f7f8f5", fontSize: 20 }}>
                                {e.kind === "video" ? "🎬" : e.kind === "audio" ? "🎙" : "📄"}
                              </span>}
                          <span className="muted" style={{ fontSize: 10, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {e.role} · {new Date(e.at).toLocaleDateString()}
                          </span>
                        </a>
                      );
                    })}
                  </div>
                )}

                {canAdd && (caps.image || caps.video || caps.document) && (
                  <form action={addScopeEvidence.bind(null, projectId, l.id)} style={{ display: "grid", gap: 6 }}>
                    <div className="radio-row" style={{ minHeight: 0 }}>
                      <label className="radio-opt"><input type="radio" name="role" value="before" /> Before</label>
                      <label className="radio-opt"><input type="radio" name="role" value="progress" /> In progress</label>
                      <label className="radio-opt"><input type="radio" name="role" value="after" defaultChecked /> Done</label>
                    </div>
                    <FileDrop name="files" videoName="videos" docName="docs" accept={acceptFor(caps)}
                      label="Add evidence" camera={caps.image} />
                    <div><button className="btn small">Attach to this line</button></div>
                  </form>
                )}
                {canAdd && !(caps.image || caps.video || caps.document) && (
                  <p className="muted small" style={{ margin: 0 }}>Evidence uploads are not included in your plan.</p>
                )}
              </div>
            </details>
          ))}
        </div>
      ))}
    </div>
  );
}
