import Link from "next/link";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { TasksTable, type TableTask } from "../my/TasksTable";

export const dynamic = "force-dynamic";

// The work surface wears the picked hat (admin mask cookie; everyone else
// gets the contractor lens):
//   Contractor - projects where you hold a collaborator seat, and the
//     contract-backed construction tasks assigned to YOU there. PM and
//     homeowner to-dos never leak in.
//   PM / GC - projects where you hold the site-PM (manager) seat, and
//     EVERY open construction task on them - the whole board you run,
//     not just what is assigned to you.
type Membership = {
  role: string;
  project_role: string | null;
  projects: {
    id: string;
    project_name: string;
    address: string | null;
    status: string;
    is_template: boolean;
  } | null;
};

type PortalTask = {
  id: string; action: string; status: string; priority: string | null;
  target_date: string | null; last_updated: string | null; notes: string | null;
  project: string | null; project_id: string | null; domain: string | null;
  has_contract: boolean; state: "open" | "closed";
  assignee_id: string | null; assignee: string | null; trade: string | null;
};

export default async function WorkHome() {
  const supabase = await createClient();
  const jar = await cookies();
  const { data: me } = await supabase.rpc("me");
  const isAdmin: boolean = me?.is_superadmin ?? false;
  const picked = isAdmin ? jar.get("gb_view")?.value : undefined;
  const hat = picked === "PM" || picked === "GC" ? picked : "Contractor";
  const myContact: string | null = me?.contact_id ?? null;

  const wantedRole = hat === "Contractor" ? "collaborator" : "manager";
  const [{ data: rows }, { data: taskData }] = await Promise.all([
    me?.app_user_id
      ? supabase
          .from("project_members")
          .select("role, project_role, projects(id, project_name, address, status, is_template)")
          .eq("app_user_id", me.app_user_id)
          .eq("status", "active")
          .eq("role", wantedRole)
      : Promise.resolve({ data: [] }),
    supabase.rpc("portal_tasks", { p_domain: "construction", p_closed_limit: 0 }),
  ]);

  const seats = (((rows ?? []) as unknown as Membership[]))
    .filter((m) => m.projects && !m.projects.is_template)
    .filter((m, i, arr) => arr.findIndex((x) => x.projects!.id === m.projects!.id) === i);
  const seatIds = new Set(seats.map((s) => s.projects!.id));

  const all = ((taskData ?? []) as PortalTask[]).filter(
    (t) => t.project_id && seatIds.has(t.project_id)
  );
  // Contractor: only YOUR contract-backed work. PM/GC: the whole board.
  const scoped = hat === "Contractor"
    ? all.filter((t) => myContact && t.assignee_id === myContact && t.has_contract)
    : all;

  const tableTasks: TableTask[] = scoped.map((t) => ({
    id: t.id, action: t.action, status: t.status, priority: t.priority,
    target_date: t.target_date, last_updated: t.last_updated, notes: t.notes,
    project: t.project, domain: t.domain,
    who: (myContact && t.assignee_id === myContact ? "you" : "others") as "you" | "others",
    state: t.state, trade: t.trade, assignee: t.assignee,
  }));

  const openByProject = new Map<string, number>();
  for (const t of scoped) {
    if (t.project_id) openByProject.set(t.project_id, (openByProject.get(t.project_id) ?? 0) + 1);
  }
  const visibleSeats = hat === "Contractor"
    ? seats.filter((s) => (openByProject.get(s.projects!.id) ?? 0) > 0)
    : seats;

  return (
    <main className="wrap" style={{ paddingTop: 32, paddingBottom: 96, maxWidth: 720 }}>
      <span className="kicker">{hat === "Contractor" ? "Contractor" : `${hat} — site view`}</span>
      <h1 style={{ fontSize: 26, margin: "6px 0 10px" }}>Your work</h1>

      <h2 className="section-title">
        {hat === "Contractor" ? "Projects you work on" : "Projects you run"} · {visibleSeats.length}
      </h2>
      {visibleSeats.length === 0 && (
        <p className="muted small">
          {hat === "Contractor"
            ? "No contract work assigned to you right now — when a project engages you, it shows up here."
            : "No site-PM seats yet — when a project hands you the PM seat, it shows up here."}
        </p>
      )}
      <div style={{ display: "grid", gap: 8, marginBottom: 18 }}>
        {visibleSeats.map((s) => (
          <Link key={s.projects!.id} href={`/my/project/${s.projects!.id}`} className="card statlink" style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
            <span>
              <strong style={{ fontSize: 15 }}>{s.projects!.project_name}</strong>
              <div className="muted small">
                {s.project_role ?? s.role}
                {s.projects!.address && <> · {s.projects!.address}</>} · {s.projects!.status}
              </div>
            </span>
            <span className="extra-chip" style={{ whiteSpace: "nowrap" }}>
              {openByProject.get(s.projects!.id) ?? 0} open
            </span>
          </Link>
        ))}
      </div>

      {tableTasks.length > 0 && (
        <>
          <h2 className="section-title">
            {hat === "Contractor" ? "On you" : "Open on your projects"} · {tableTasks.length}
          </h2>
          <TasksTable tasks={tableTasks} todayIso={new Date().toISOString().slice(0, 10)} />
        </>
      )}
    </main>
  );
}
