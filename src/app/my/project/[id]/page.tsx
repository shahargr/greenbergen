import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ProjectEditor } from "./ProjectEditor";
import { projectPerms } from "./actions";

export const dynamic = "force-dynamic";

type MemberRow = {
  role: string;
  project_role: string | null;
  contacts: { name: string } | null;
};

type FileRow = {
  id: string;
  bucket: string;
  path: string;
  file_name: string;
  mime_type: string | null;
  kind: string | null;
  caption: string | null;
  created_at: string;
};

type TaskRow = {
  id: string;
  action: string;
  status: string;
  priority: string | null;
  target_date: string | null;
};

// Project drill-down: details (unlock-to-edit per rank), the people on it,
// its files - voice notes play right here - and its tasks.
export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { id } = await params;
  const { saved, error } = await searchParams;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, project_name, status, address, notes, parent_project_id, created_at, purchase_date, purchase_amount, sold_date, sold_amount")
    .eq("id", id)
    .maybeSingle();

  if (!project) {
    return (
      <main className="wrap" style={{ paddingTop: 32, maxWidth: 640 }}>
        <p className="muted">This project does not exist — or is not yours to see.</p>
        <p><Link href="/my?panel=projects">← Back to your projects</Link></p>
      </main>
    );
  }

  const [{ data: parent }, perms, { data: memberRows }, { data: fileRows }, { data: openRows }, { count: closedCount }] =
    await Promise.all([
      project.parent_project_id
        ? supabase.from("projects").select("id, project_name").eq("id", project.parent_project_id).maybeSingle()
        : Promise.resolve({ data: null }),
      projectPerms(id),
      supabase
        .from("project_members")
        .select("role, project_role, contacts(name)")
        .eq("project_id", id)
        .eq("status", "active"),
      supabase
        .from("files")
        .select("id, bucket, path, file_name, mime_type, kind, caption, created_at")
        .eq("project_id", id)
        .order("created_at", { ascending: false })
        .limit(24),
      supabase
        .from("actions")
        .select("id, action, status, priority, target_date")
        .eq("project_id", id)
        .not("status", "in", "(Completed,Cancelled,Superseded)")
        .order("target_date", { ascending: true, nullsFirst: false })
        .limit(50),
      supabase
        .from("actions")
        .select("id", { count: "exact", head: true })
        .eq("project_id", id)
        .in("status", ["Completed", "Cancelled", "Superseded"]),
    ]);

  // One line per person - a contact can hold several seats.
  const people = new Map<string, string[]>();
  for (const m of (memberRows ?? []) as unknown as MemberRow[]) {
    const name = m.contacts?.name;
    if (!name) continue;
    const seat = m.project_role ?? m.role;
    const seats = people.get(name) ?? [];
    if (!seats.includes(seat)) seats.push(seat);
    people.set(name, seats);
  }

  // Signed URLs so private project-media renders inline (audio plays here).
  const files = (fileRows ?? []) as FileRow[];
  const signed = new Map<string, string>();
  await Promise.all(
    files.map(async (f) => {
      const { data } = await supabase.storage.from(f.bucket).createSignedUrl(f.path, 3600);
      if (data?.signedUrl) signed.set(f.id, data.signedUrl);
    })
  );
  const openTasks = (openRows ?? []) as TaskRow[];

  return (
    <main className="wrap" style={{ paddingTop: 32, paddingBottom: 96, maxWidth: 640 }}>
      <p className="small" style={{ margin: "0 0 6px" }}>
        <Link href="/my?panel=projects">← Your projects</Link>
      </p>
      <span className="kicker">{project.parent_project_id ? "Job" : "Home"}</span>
      <h1 style={{ fontSize: 26, margin: "6px 0 2px" }}>{project.project_name}</h1>
      {parent && (
        <p className="muted small" style={{ marginTop: 0 }}>
          Under <Link href={`/my/project/${parent.id}`}>{parent.project_name}</Link>
        </p>
      )}

      {saved && <p className="banner" style={{ background: "#2f6b4f" }}>Saved ✓</p>}
      {error && <p className="error small">{error}</p>}

      <div style={{ display: "grid", gap: 14, marginTop: 10 }}>
        <ProjectEditor
          project={{ id: project.id, project_name: project.project_name, status: project.status, address: project.address, notes: project.notes }}
          perms={perms}
        />

        {perms.rank >= 70 && (project.purchase_date || project.purchase_amount || project.sold_date || project.sold_amount) && (
          <div className="card">
            <h2 className="section-title">Purchase &amp; sale</h2>
            <div className="small" style={{ display: "grid", gap: 4 }}>
              {(project.purchase_date || project.purchase_amount) && (
                <span>
                  <span className="muted">Purchased:</span>{" "}
                  {project.purchase_date ?? "—"}
                  {project.purchase_amount && <> · ${Number(project.purchase_amount).toLocaleString()}</>}
                </span>
              )}
              {(project.sold_date || project.sold_amount) && (
                <span>
                  <span className="muted">Sold:</span>{" "}
                  {project.sold_date ?? "—"}
                  {project.sold_amount && <> · ${Number(project.sold_amount).toLocaleString()}</>}
                </span>
              )}
            </div>
          </div>
        )}

        <div className="card">
          <h2 className="section-title">Tasks · {openTasks.length} open{closedCount ? ` · ${closedCount} done` : ""}</h2>
          {openTasks.length === 0 && <p className="muted small" style={{ margin: 0 }}>Nothing open here.</p>}
          <div style={{ display: "grid", gap: 8 }}>
            {openTasks.map((t) => (
              <Link key={t.id} href={`/my/task/${t.id}`} className="card statlink" style={{ padding: "10px 14px", display: "block" }}>
                <strong style={{ fontSize: 15 }}>{t.action}</strong>
                <div className="muted small">
                  {t.status}
                  {t.priority && t.priority !== "Missing" && <> · {t.priority}</>}
                  {t.target_date && <> · due {t.target_date}</>}
                </div>
              </Link>
            ))}
          </div>
        </div>

        {files.length > 0 && (
          <div className="card">
            <h2 className="section-title">Files · {files.length}</h2>
            <div style={{ display: "grid", gap: 10 }}>
              {files.map((f) => {
                const url = signed.get(f.id);
                const isAudio = f.kind === "audio" || (f.mime_type ?? "").startsWith("audio/");
                const isImage = f.kind === "photo" || (f.mime_type ?? "").startsWith("image/");
                return (
                  <div key={f.id} style={{ display: "grid", gap: 4 }}>
                    <span className="small">
                      <strong>{f.caption ?? f.file_name}</strong>
                      <span className="muted"> · {new Date(f.created_at).toLocaleDateString()}</span>
                    </span>
                    {url && isAudio && <audio controls src={url} style={{ width: "100%", maxWidth: 400 }} />}
                    {url && isImage && (
                      <a href={url} target="_blank" rel="noreferrer">
                        {/* Signed URLs expire; next/image caching fights that. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt={f.caption ?? f.file_name} style={{ maxWidth: 180, borderRadius: 8, display: "block" }} />
                      </a>
                    )}
                    {url && !isAudio && !isImage && (
                      <a className="small" href={url} target="_blank" rel="noreferrer">Open {f.file_name}</a>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {people.size > 0 && (
          <div className="card">
            <h2 className="section-title">People · {people.size}</h2>
            <div className="small" style={{ display: "grid", gap: 4 }}>
              {[...people.entries()].map(([name, seats]) => (
                <span key={name}><strong>{name}</strong> <span className="muted">· {seats.join(", ")}</span></span>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
