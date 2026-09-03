import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ProjectEditor } from "./ProjectEditor";
import { projectPerms } from "./actions";
import { TasksTable, type TableTask } from "../../TasksTable";
import { ConfiguratorForm, GENERATOR_FIELDS } from "./ConfiguratorForm";
import { deleteProject } from "./actions";

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

  const [{ data: parent }, perms, { data: memberRows }, { data: fileRows }, { data: taskData }, { data: configRows }, { data: configValueRows }, { data: contractAmountRows }, { data: paidRows }] =
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
      supabase.rpc("portal_tasks", { p_project_id: id, p_open_limit: 200, p_closed_limit: 200 }),
      supabase
        .from("actions")
        .select("id, action, status, requires_photo_evidence, notes")
        .eq("project_id", id)
        .eq("scope_milestone", "Configuration")
        .order("created_at"),
      supabase
        .from("project_config_values")
        .select("key, value")
        .eq("project_id", id),
      supabase
        .from("contracts")
        .select("amount")
        .eq("project_id", id)
        .eq("direction", "payable"),
      supabase
        .from("transactions")
        .select("amount")
        .eq("project_id", id)
        .eq("direction", "out")
        .in("status", ["paid", "paid - receipt filed", "paid - pending confirmation", "settled"]),
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
  type PortalTask = {
    id: string; action: string; status: string; priority: string | null;
    target_date: string | null; last_updated: string | null; notes: string | null;
    project: string | null; domain: string | null; state: "open" | "closed";
    assignee_id: string | null; assignee: string | null; trade: string | null;
  };
  const { data: meRow } = await supabase.rpc("me");
  const myContactId: string | null = meRow?.contact_id ?? null;
  const projectTasks: TableTask[] = (((taskData ?? []) as PortalTask[])).map((t) => ({
    id: t.id, action: t.action, status: t.status, priority: t.priority,
    target_date: t.target_date, last_updated: t.last_updated, notes: t.notes,
    project: t.project,
    who: (myContactId && t.assignee_id === myContactId ? "you" : "others") as "you" | "others",
    domain: t.domain,
    state: t.state, trade: t.trade, assignee: t.assignee,
  }));
  const openCount = projectTasks.filter((t) => t.state === "open").length;
  const doneCount = projectTasks.filter((t) => t.state === "closed").length;
  const deliveryPct = openCount + doneCount > 0 ? Math.round((doneCount / (openCount + doneCount)) * 100) : 0;
  const contracted = ((contractAmountRows ?? []) as { amount: number | null }[])
    .reduce((sum, c) => sum + Number(c.amount ?? 0), 0);
  const paid = ((paidRows ?? []) as { amount: number | null }[])
    .reduce((sum, t) => sum + Number(t.amount ?? 0), 0);
  const budgetPct = contracted > 0 ? Math.min(100, Math.round((paid / contracted) * 100)) : null;

  type ConfigRow = { id: string; action: string; status: string; requires_photo_evidence: boolean | null; notes: string | null };
  const config = ((configRows ?? []) as ConfigRow[]);
  const configDone = config.filter((c) => ["Completed"].includes(c.status)).length;
  const configValues: Record<string, string> = {};
  for (const r of (configValueRows ?? []) as { key: string; value: string | null }[]) {
    if (r.value != null) configValues[r.key] = r.value;
  }

  return (
    <main className="wrap" style={{ paddingTop: 32, paddingBottom: 96, maxWidth: 640 }}>
      <p className="small" style={{ margin: "0 0 6px" }}>
        <Link href="/my">← Your projects</Link>
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

        <div className="card" style={{ display: "grid", gap: 12 }}>
          <div>
            <div className="small" style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <strong>Deliveries</strong>
              <span className="muted">{doneCount} of {openCount + doneCount} tasks done · {deliveryPct}%</span>
            </div>
            <div className="progressbar"><span style={{ width: `${deliveryPct}%` }} /></div>
          </div>
          {budgetPct !== null && (
            <div>
              <div className="small" style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <strong>Funds / budget</strong>
                <span className="muted">
                  ${Math.round(paid).toLocaleString()} paid of ${Math.round(contracted).toLocaleString()} contracted · {budgetPct}%
                </span>
              </div>
              <div className="progressbar"><span style={{ width: `${budgetPct}%`, background: "#a8842c" }} /></div>
            </div>
          )}
        </div>

        {config.length > 0 && (
          <div className="card" style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <h2 className="section-title" style={{ margin: 0 }}>Configuration · {configDone} of {config.length} done</h2>
              <span className="muted small">Complete these so the work can be priced and scheduled.</span>
            </div>
            <div className="progressbar">
              <span style={{ width: `${config.length ? Math.round((configDone / config.length) * 100) : 0}%` }} />
            </div>
            <details open={Object.keys(configValues).length === 0}>
              <summary className="small" style={{ cursor: "pointer", fontWeight: 700 }}>
                Parameters {Object.keys(configValues).length > 0 ? `· ${Object.keys(configValues).length} filled` : "— fill these in"}
              </summary>
              <div style={{ marginTop: 10 }}>
                <ConfiguratorForm projectId={project.id} fields={GENERATOR_FIELDS} values={configValues} />
              </div>
            </details>
            <div style={{ display: "grid", gap: 6 }}>
              {config.map((c) => (
                <Link key={c.id} href={`/my/task/${c.id}`} className="card statlink"
                  style={{ padding: "9px 12px", display: "flex", gap: 10, alignItems: "center" }}>
                  <span style={{ fontSize: 17, flex: "none" }}>{c.status === "Completed" ? "✅" : "⬜"}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ fontSize: 14 }}>{c.action.replace(/^Config: /, "")}</strong>
                    <div className="muted small">
                      {c.requires_photo_evidence ? "Photo required · " : ""}{c.status}
                    </div>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}

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
          <h2 className="section-title">Tasks · {openCount} open · {doneCount} done</h2>
          {projectTasks.length === 0 && <p className="muted small" style={{ margin: 0 }}>Nothing here yet.</p>}
          {projectTasks.length > 0 && (
            <TasksTable tasks={projectTasks} todayIso={new Date().toISOString().slice(0, 10)} />
          )}
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

        {perms.rank >= 70 && (
          <details className="card" style={{ borderColor: "#e3b7ba" }}>
            <summary className="small" style={{ cursor: "pointer", fontWeight: 700, color: "#c0262d" }}>
              Delete this project
            </summary>
            <p className="muted small" style={{ margin: "10px 0 8px" }}>
              Removes the project, its tasks and its media files for good.
              Only possible while nothing depends on it — no projects
              underneath, no contracts, no ledger transactions.
            </p>
            <form action={deleteProject.bind(null, project.id)}>
              <button className="btn" style={{ background: "#c0262d" }}>Delete permanently</button>
            </form>
          </details>
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
