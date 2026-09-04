import { createClient } from "@/lib/supabase/server";
import { FileDrop } from "@/components/FileDrop";
import { saveScopeDescription, uploadScopeFiles, deleteScopeFile } from "./actions";
import { acceptFor, type Caps } from "@/lib/caps";

type BriefFile = {
  id: string; file_name: string; kind: string | null; mime: string | null;
  bucket: string; path: string; caption: string | null;
  size_bytes: number | null; created_at: string;
};

const size = (n: number | null) =>
  n == null ? "" : n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

// Where the scope starts: what the owner wants, in their own words, and the
// pictures and plans that go with it. Both travel into every bid package, so
// this is the one place that decides what a bidder is pricing.
export async function ScopeBrief({ projectId, description, caps, canEdit }: {
  projectId: string; description: string | null; caps: Caps; canEdit: boolean;
}) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("portal_brief_files", { p_project: projectId });
  const files = ((data ?? []) as BriefFile[]);
  const urls = new Map<string, string>();
  await Promise.all(files.map(async (f) => {
    const { data: s } = await supabase.storage.from(f.bucket).createSignedUrl(f.path, 3600);
    if (s?.signedUrl) urls.set(f.id, s.signedUrl);
  }));

  return (
    <div id="brief" className="card" style={{ display: "grid", gap: 10, minWidth: 0 }}>
      <h2 className="section-title" style={{ margin: 0 }}>Project description &amp; files</h2>

      {canEdit ? (
        <form action={saveScopeDescription.bind(null, projectId)} style={{ display: "grid", gap: 8 }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="sb-desc">What this job is</label>
            <textarea id="sb-desc" name="description" className="input" rows={5} defaultValue={description ?? ""}
              placeholder="What you want done, where, and anything a bidder must know before pricing it." />
            <p className="muted" style={{ fontSize: 11, margin: "4px 0 0" }}>
              This travels with every bid package — bidders price from these words.
            </p>
          </div>
          <div><button className="btn small">Save description</button></div>
        </form>
      ) : (
        <p className="small" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
          {description ?? <span className="muted">No description written yet.</span>}
        </p>
      )}

      {canEdit && (caps.image || caps.video || caps.document) && (
        <form action={uploadScopeFiles.bind(null, projectId)} style={{ display: "grid", gap: 8, borderTop: "1px solid #eef0ec", paddingTop: 10 }}>
          <FileDrop name="files" videoName="videos" docName="docs" accept={acceptFor(caps)}
            label="Add photos, plans or PDFs" camera={caps.image} />
          <div><button className="btn small">Upload</button></div>
        </form>
      )}

      <div style={{ display: "grid", gap: 4, borderTop: "1px solid #eef0ec", paddingTop: 8 }}>
        <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4 }}>
          Files · {files.length}
        </div>
        {files.length === 0 && <p className="muted small" style={{ margin: 0 }}>Nothing attached yet.</p>}
        {files.map((f) => {
          const u = urls.get(f.id);
          const isImg = (f.mime ?? "").startsWith("image/") || f.kind === "photo";
          return (
            <div key={f.id} className="small" style={{ display: "flex", gap: 8, alignItems: "center", borderTop: "1px solid #f4f5f2", paddingTop: 4, minWidth: 0 }}>
              {isImg && u
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={u} alt="" style={{ width: 32, height: 32, objectFit: "cover", borderRadius: 6, border: "1px solid #e7e9e4", flex: "none" }} />
                : <span style={{ width: 32, height: 32, display: "grid", placeItems: "center", borderRadius: 6, border: "1px solid #e7e9e4", background: "#f7f8f5", flex: "none" }}>
                    {f.kind === "video" ? "🎬" : f.kind === "audio" ? "🎙" : "📄"}
                  </span>}
              <span style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {u ? <a href={u} target="_blank" rel="noreferrer">{f.file_name}</a> : f.file_name}
                <span className="muted"> · {size(f.size_bytes)}</span>
              </span>
              {canEdit && (
                <form action={deleteScopeFile.bind(null, projectId, f.id)} style={{ flex: "none" }}>
                  <button className="btn ghost small" style={{ padding: "1px 8px", color: "#c0262d" }}
                    aria-label={`Delete ${f.file_name}`} title="Delete this file">✕</button>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
