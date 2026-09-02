import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Contractor lens: every project where this user holds a working seat
// (anything but the owner seat). The owner lens lives on /my.
type Membership = {
  role: string;
  project_role: string | null;
  projects: {
    id: string;
    project_name: string;
    address: string | null;
    status: string;
    parent_project_id: string | null;
  } | null;
};

export default async function ContractorHome() {
  const supabase = await createClient();
  const { data: me } = await supabase.rpc("me");

  const { data: rows } = me?.app_user_id
    ? await supabase
        .from("project_members")
        .select("role, project_role, projects(id, project_name, address, status, parent_project_id)")
        .eq("app_user_id", me.app_user_id)
        .eq("status", "active")
        .neq("role", "owner")
    : { data: [] };
  // One card per project - a user can hold several seats (e.g. site PM and
  // viewer); keep the strongest one.
  const seatWeight = (m: Membership) => (m.role === "viewer" ? 0 : m.role === "manager" ? 2 : 1);
  const byProject = new Map<string, Membership>();
  for (const m of ((rows ?? []) as unknown as Membership[]).filter((x) => x.projects)) {
    const prev = byProject.get(m.projects!.id);
    if (!prev || seatWeight(m) > seatWeight(prev)) byProject.set(m.projects!.id, m);
  }
  const seats = [...byProject.values()].sort((a, b) =>
    a.projects!.project_name.localeCompare(b.projects!.project_name));

  // Open tasks assigned to me across those projects.
  const projectIds = seats.map((s) => s.projects!.id);
  const { data: taskRows } = projectIds.length && me?.contact_id
    ? await supabase
        .from("actions")
        .select("id, action, status, priority, target_date, projects(project_name)")
        .in("project_id", projectIds)
        .eq("assigned_to_contact_id", me.contact_id)
        .not("status", "in", "(Completed,Cancelled,Superseded)")
        .order("target_date", { ascending: true, nullsFirst: false })
        .limit(50)
    : { data: [] };
  type TaskRow = {
    id: string; action: string; status: string; priority: string | null;
    target_date: string | null; projects: { project_name: string } | null;
  };
  const tasks = ((taskRows ?? []) as unknown as TaskRow[]);

  return (
    <main className="wrap" style={{ paddingTop: 32, paddingBottom: 96, maxWidth: 640 }}>
      <span className="kicker">Contractor</span>
      <h1 style={{ fontSize: 26, margin: "6px 0 10px" }}>Your work</h1>

      <h2 className="section-title">Projects you work on · {seats.length}</h2>
      {seats.length === 0 && (
        <p className="muted small">
          No projects yet — when an owner or project manager adds you to a
          project, it shows up here.
        </p>
      )}
      <div style={{ display: "grid", gap: 8 }}>
        {seats.map((s) => (
          <div key={s.projects!.id} className="card" style={{ padding: "10px 14px" }}>
            <strong style={{ fontSize: 15 }}>{s.projects!.project_name}</strong>
            <div className="muted small">
              {s.project_role ?? s.role}
              {s.projects!.address && <> · {s.projects!.address}</>} · {s.projects!.status}
            </div>
          </div>
        ))}
      </div>

      {tasks.length > 0 && (
        <>
          <h2 className="section-title" style={{ marginTop: 18 }}>On you · {tasks.length}</h2>
          <div style={{ display: "grid", gap: 8 }}>
            {tasks.map((t) => (
              <Link key={t.id} href={`/my/task/${t.id}`} className="card statlink" style={{ padding: "10px 14px", display: "block" }}>
                <strong style={{ fontSize: 15 }}>{t.action}</strong>
                <div className="muted small">
                  {t.projects?.project_name && <>{t.projects.project_name} · </>}
                  {t.status}
                  {t.target_date && <> · due {t.target_date}</>}
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
