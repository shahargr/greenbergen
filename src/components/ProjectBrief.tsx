import { createClient } from "@/lib/supabase/server";

type Brief = {
  project_id: string; project_name: string;
  description: string | null;
  specs: { key: string; label: string; value: string }[];
  files: { id: string; file_name: string; kind: string | null; mime: string | null; bucket: string; path: string; caption: string | null; transcript: string | null }[];
};

// The project brief: what the owner asked for, the wizard's specs, and the
// photos / documents they attached when starting the project. One block,
// the same on the project page, every bid package, and the bidder's reply —
// so bidders price from the owner's own words and pictures.
export async function ProjectBrief({ projectId, title = "Project brief", collapsible = false, defaultOpen = true }: { projectId: string; title?: string; collapsible?: boolean; defaultOpen?: boolean }) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("portal_project_brief", { p_project: projectId });
  const b = (data ?? null) as Brief | null;
  if (!b) return null;
  const photos = b.files.filter((f) => (f.mime ?? "").startsWith("image/") || f.kind === "photo");
  const others = b.files.filter((f) => !photos.includes(f));
  if (!b.description && b.specs.length === 0 && b.files.length === 0) return null;

  const urls = new Map<string, string>();
  await Promise.all(b.files.map(async (f) => {
    const { data: s } = await supabase.storage.from(f.bucket).createSignedUrl(f.path, 3600);
    if (s?.signedUrl) urls.set(f.id, s.signedUrl);
  }));
  const transcripts = b.files.map((f) => f.transcript).filter((t): t is string => !!t);

  const body = (
    <>
      {b.description && <p className="small" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{b.description}</p>}
      {transcripts.map((t, i) => (
        <p key={i} className="small muted" style={{ margin: 0, whiteSpace: "pre-wrap" }}>🎙 {t}</p>
      ))}
      {b.specs.length > 0 && (
        <div className="small" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
          {b.specs.map((s) => (
            <div key={s.key}>
              <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>{s.label}</div>
              <div style={{ fontWeight: 600 }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}
      {photos.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {photos.map((f) => {
            const u = urls.get(f.id);
            return u ? (
              <a key={f.id} href={u} target="_blank" rel="noreferrer" title={f.caption ?? f.file_name}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={u} alt={f.caption ?? f.file_name} style={{ width: 120, height: 120, objectFit: "cover", borderRadius: 10, border: "1px solid #e7e9e4" }} />
              </a>
            ) : <span key={f.id} className="extra-chip">{f.file_name}</span>;
          })}
        </div>
      )}
      {others.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {others.map((f) => {
            const u = urls.get(f.id);
            const icon = f.kind === "audio" ? "🎙" : "📄";
            return u
              ? <a key={f.id} href={u} target="_blank" rel="noreferrer" className="extra-chip" style={{ textDecoration: "none" }}>{icon} {f.file_name}</a>
              : <span key={f.id} className="extra-chip">{icon} {f.file_name}</span>;
          })}
        </div>
      )}
    </>
  );

  // Collapsible: the brief is the summary of the job, so it opens by
  // default and folds away when the reader wants the workflow below.
  if (collapsible) {
    return (
      <details className="card" open={defaultOpen} style={{ display: "grid", gap: 8 }}>
        <summary className="section-title" style={{ margin: 0, cursor: "pointer", listStyle: "revert" }}>
          {title} · {b.project_name}
          <span className="muted small" style={{ fontWeight: 400, marginLeft: 8 }}>
            {[b.specs.length ? `${b.specs.length} specs` : null, photos.length ? `${photos.length} photo${photos.length === 1 ? "" : "s"}` : null, others.length ? `${others.length} file${others.length === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ")}
          </span>
        </summary>
        <div style={{ display: "grid", gap: 8, marginTop: 8 }}>{body}</div>
      </details>
    );
  }
  return (
    <div className="card" style={{ display: "grid", gap: 8 }}>
      <h2 className="section-title" style={{ margin: 0 }}>{title} · {b.project_name}</h2>
      {body}
    </div>
  );
}
