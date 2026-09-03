import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ProjectEditor } from "./ProjectEditor";
import { projectPerms } from "./actions";
import { TasksTable, type TableTask } from "../../TasksTable";
import { ConfiguratorForm, GENERATOR_FIELDS } from "./ConfiguratorForm";
import { ConfigChecklist, type ConfigItem } from "./ConfigChecklist";

export const dynamic = "force-dynamic";

type MemberRow = {
  role: string;
  project_role: string | null;
  contacts: { name: string } | null;
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

  const [{ data: parent }, perms, { data: memberRows }, { data: taskData }, { data: configRows }, { data: configValueRows }] =
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

  // People with LATE open tasks on this project - panels appear only for
  // those who actually have overdue work.
  const todayIso = new Date().toISOString().slice(0, 10);
  const lateByPerson = new Map<string, number>();
  for (const t of projectTasks) {
    if (t.state === "open" && t.target_date && t.target_date < todayIso) {
      const who = t.assignee ?? "Unassigned";
      lateByPerson.set(who, (lateByPerson.get(who) ?? 0) + 1);
    }
  }
  const latePeople = [...lateByPerson.entries()].sort((a, b) => b[1] - a[1]);

  type ConfigRow = { id: string; action: string; status: string; requires_photo_evidence: boolean | null; notes: string | null };
  const config = ((configRows ?? []) as ConfigRow[]);
  const configDone = config.filter((c) => ["Completed"].includes(c.status)).length;

  const configIds = config.map((c) => c.id);
  const { data: cfgFileRows } = configIds.length
    ? await supabase
        .from("file_links")
        .select("action_id, files(bucket, path)")
        .in("action_id", configIds)
        .in("role", ["reference", "after", "evidence"])
    : { data: [] };
  const cfgPhotos = new Map<string, string[]>();
  await Promise.all(
    (((cfgFileRows ?? []) as unknown as { action_id: string; files: { bucket: string; path: string } | null }[]))
      .filter((r) => r.files)
      .map(async (r) => {
        const { data } = await supabase.storage.from(r.files!.bucket).createSignedUrl(r.files!.path, 3600);
        if (data?.signedUrl) cfgPhotos.set(r.action_id, [...(cfgPhotos.get(r.action_id) ?? []), data.signedUrl]);
      })
  );
  const configItems: ConfigItem[] = config.map((c) => ({
    id: c.id,
    label: c.action,
    requiresPhoto: !!c.requires_photo_evidence,
    done: c.status === "Completed",
    photos: cfgPhotos.get(c.id) ?? [],
  }));
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

      {saved && <p className="banner" style={{ background: "#2f6b4f" }}>Saved ✓</p>}
      {error && <p className="error small">{error}</p>}

      <div style={{ display: "grid", gap: 14, marginTop: 10 }}>
        <ProjectEditor
          project={{ id: project.id, project_name: project.project_name, status: project.status, address: project.address, notes: project.notes }}
          perms={perms}
        />

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
            <ConfigChecklist projectId={project.id} items={configItems} />
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
          {latePeople.length > 0 && (
            <div className="phase-grid" style={{ marginBottom: 4 }}>
              {latePeople.map(([who, n]) => (
                <div key={who} className="phase-tile" style={{ cursor: "default" }}>
                  <span className="phase-icon" style={{ background: "#fdecec", color: "#c0262d" }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-3.8 3.4-6.5 8-6.5s8 2.7 8 6.5" /></svg>
                  </span>
                  <span className="phase-name" style={{ fontSize: 11 }}>{who}</span>
                  <span className="tradestat-late"><strong>{n}</strong> late</span>
                </div>
              ))}
            </div>
          )}
          {projectTasks.length > 0 && (
            <TasksTable tasks={projectTasks} todayIso={todayIso} />
          )}
        </div>


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
