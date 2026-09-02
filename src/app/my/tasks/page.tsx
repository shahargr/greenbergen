import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { TasksTable, type TableTask } from "../TasksTable";
import { AddTaskForm } from "../AddTaskForm";

export const dynamic = "force-dynamic";

type Lead = {
  id: string; action: string; name: string; phone: string | null; email: string | null;
  preferred_date: string | null; message: string | null;
};
type PortalTask = {
  id: string; action: string; status: string; priority: string | null;
  target_date: string | null; last_updated: string | null; notes: string | null;
  project: string | null; domain: string | null; state: "open" | "closed";
  assignee_id: string | null; assignee: string | null; trade: string | null;
};
type Membership = {
  role: string;
  projects: { id: string; project_name: string; is_template: boolean } | null;
};
type MemberPayRow = {
  project_id: string; role: string; contact_id: string | null;
  contacts: { name: string | null; person_name: string | null } | null;
};
type ProjectOverview = { id: string; last_activity: string };

// The tasks window: create-and-assign up top (PM and above), leads pending
// review, then the full filterable trade-tiled table.
export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const { error, ok } = await searchParams;
  const supabase = await createClient();
  const { data: me } = await supabase.rpc("me");
  const myContact: string | null = me?.contact_id ?? null;

  const [{ data: portalData }, { data: leadData }, { data: membershipRows }] = await Promise.all([
    supabase.rpc("portal_tasks"),
    supabase.rpc("my_lead_actions"),
    me?.app_user_id
      ? supabase
          .from("project_members")
          .select("role, projects(id, project_name, is_template)")
          .eq("app_user_id", me.app_user_id)
          .eq("status", "active")
          .in("role", ["owner", "manager"])
      : Promise.resolve({ data: [] }),
  ]);
  const leads: Lead[] = (leadData as Lead[]) ?? [];
  const pmProjects = (((membershipRows ?? []) as unknown as Membership[]))
    .filter((m) => m.projects && !m.projects.is_template)
    .map((m) => m.projects!)
    .filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i);

  const tableTasks: TableTask[] = (((portalData ?? []) as PortalTask[])).map((t) => ({
    id: t.id, action: t.action, status: t.status, priority: t.priority,
    target_date: t.target_date, last_updated: t.last_updated, notes: t.notes,
    project: t.project,
    who: (myContact && t.assignee_id === myContact ? "you" : "others") as "you" | "others",
    domain: t.domain,
    state: t.state, trade: t.trade, assignee: t.assignee,
  }));

  // Data for the create form: projects by activity, people by recency.
  let taskProjects: { id: string; name: string }[] = [];
  let taskMembers: { projectId: string; contactId: string; name: string; canPay: boolean }[] = [];
  if (pmProjects.length > 0) {
    const pmIds = pmProjects.map((p) => p.id);
    const [{ data: memberRows }, { data: overviewRows }, { data: recentAssign }] = await Promise.all([
      supabase
        .from("project_members")
        .select("project_id, role, contact_id, contacts(name, person_name)")
        .in("project_id", pmIds)
        .eq("status", "active")
        .not("contact_id", "is", null),
      supabase.rpc("portal_projects_overview"),
      supabase
        .from("actions")
        .select("project_id, assigned_to_contact_id, last_updated")
        .in("project_id", pmIds)
        .not("assigned_to_contact_id", "is", null)
        .order("last_updated", { ascending: false })
        .limit(500),
    ]);
    const rank = new Map(((overviewRows ?? []) as ProjectOverview[]).map((p, i) => [p.id, i]));
    taskProjects = [...pmProjects]
      .sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999))
      .map((p) => ({ id: p.id, name: p.project_name }));
    const lastWith = new Map<string, string>();
    for (const r of (recentAssign ?? []) as { project_id: string; assigned_to_contact_id: string; last_updated: string | null }[]) {
      const k = `${r.project_id}:${r.assigned_to_contact_id}`;
      if (!lastWith.has(k)) lastWith.set(k, r.last_updated ?? "");
    }
    taskMembers = (((memberRows ?? []) as unknown as MemberPayRow[]))
      .filter((m) => m.contact_id && m.contacts)
      .map((m) => ({
        projectId: m.project_id,
        contactId: m.contact_id as string,
        name: m.contacts!.person_name ?? m.contacts!.name ?? "Unnamed",
        canPay: m.role === "owner" || m.role === "manager",
      }))
      .filter((m, i, arr) => arr.findIndex((x) => x.projectId === m.projectId && x.contactId === m.contactId) === i)
      .sort((a, b) =>
        (lastWith.get(`${b.projectId}:${b.contactId}`) ?? "").localeCompare(
          lastWith.get(`${a.projectId}:${a.contactId}`) ?? "") ||
        a.name.localeCompare(b.name));
  }

  return (
    <main className="wrap" style={{ paddingTop: 24, paddingBottom: 96, maxWidth: 720 }}>
      <p className="small" style={{ margin: "0 0 6px" }}><Link href="/my">← Home</Link></p>
      <h1 style={{ fontSize: 26, margin: "0 0 12px" }}>Tasks</h1>

      {ok && <p className="banner" style={{ background: "#2f6b4f" }}>{ok}</p>}
      {error && <p className="error small">{error}</p>}

      {pmProjects.length > 0 && (
        <details className="card" style={{ marginBottom: 14 }}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>＋ Add a task</summary>
          <div style={{ marginTop: 12 }}>
            <AddTaskForm projects={taskProjects} members={taskMembers} />
          </div>
        </details>
      )}

      {leads.length > 0 && (
        <>
          <h2 className="section-title">Leads pending your review · {leads.length}</h2>
          <div style={{ display: "grid", gap: 8, marginBottom: 18 }}>
            {leads.map((l) => (
              <Link key={l.id} href={`/my/task/${l.id}`} className="card statlink" style={{ padding: "12px 14px", borderLeft: "3px solid var(--brand)", display: "block" }}>
                <strong style={{ fontSize: 15 }}>{l.action}</strong>
                <div className="small" style={{ marginTop: 4, display: "grid", gap: 2 }}>
                  <span>
                    {l.name}
                    {l.phone && <> · <a href={`tel:${l.phone}`}>{l.phone}</a></>}
                    {l.email && <> · <a href={`mailto:${l.email}`}>{l.email}</a></>}
                  </span>
                  {l.preferred_date && <span className="muted">Preferred date: {l.preferred_date}</span>}
                  {l.message && <span className="muted">&ldquo;{l.message}&rdquo;</span>}
                </div>
              </Link>
            ))}
          </div>
        </>
      )}

      <TasksTable tasks={tableTasks} todayIso={new Date().toISOString().slice(0, 10)} />
    </main>
  );
}
