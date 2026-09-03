import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type ProjectRow = {
  id: string; project_name: string; address: string | null; status: string;
  parent_project_id: string | null; owner_user_id: string | null; created_at: string;
};

// Every project on the platform, for the administrator. "Enter" opens the
// project with full admin rights — RLS already grants a superadmin access to
// any project. A project you are NOT a member of is entered in god mode, and
// the project page says so.
export default async function AdminProjectsPage() {
  const supabase = await createClient();
  const { data: me } = await supabase.rpc("me");
  if (!me?.is_superadmin) {
    return <p className="muted">Project management is for administrators.</p>;
  }

  const CLOSED = '("Completed","Cancelled","Force Cancelled","Superseded")';
  const [{ data: projectRows }, { data: userRows }, { data: openRows }, { data: memberRows }, { data: myMemberRows }] =
    await Promise.all([
      supabase
        .from("projects")
        .select("id, project_name, address, status, parent_project_id, owner_user_id, created_at")
        .is("trashed_at", null)
        .eq("is_template", false)
        .order("created_at", { ascending: false })
        .limit(300),
      supabase.from("app_users").select("id, full_name, email"),
      supabase.from("actions").select("project_id").not("status", "in", CLOSED).limit(5000),
      supabase.from("project_members").select("project_id").eq("status", "active").limit(5000),
      supabase.from("project_members").select("project_id").eq("app_user_id", me.app_user_id).eq("status", "active"),
    ]);

  const projects = ((projectRows ?? []) as ProjectRow[]);
  const userName = new Map(((userRows ?? []) as { id: string; full_name: string | null; email: string | null }[])
    .map((u) => [u.id, u.full_name ?? u.email ?? "—"]));
  const nameOf = new Map(projects.map((p) => [p.id, p.project_name]));
  const openCount = new Map<string, number>();
  for (const r of (openRows ?? []) as { project_id: string | null }[]) {
    if (r.project_id) openCount.set(r.project_id, (openCount.get(r.project_id) ?? 0) + 1);
  }
  const memberCount = new Map<string, number>();
  for (const r of (memberRows ?? []) as { project_id: string }[]) {
    memberCount.set(r.project_id, (memberCount.get(r.project_id) ?? 0) + 1);
  }
  const mine = new Set(((myMemberRows ?? []) as { project_id: string }[]).map((r) => r.project_id));
  const fmt = (d: string) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div>
        <span className="kicker">Admin</span>
        <h1 style={{ fontSize: 24, margin: "6px 0 4px" }}>Project management</h1>
        <p className="muted small" style={{ margin: 0 }}>
          Every project on the platform · {projects.length}. Entering a project you are not a member of puts you in
          <strong> god mode</strong> — full admin rights, and the project page shows it.
        </p>
      </div>

      <div className="card" style={{ overflowX: "auto" }}>
        <table className="tasktable" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th>Project</th>
              <th>Owner</th>
              <th>Status</th>
              <th style={{ textAlign: "right" }}>Open</th>
              <th style={{ textAlign: "right" }}>People</th>
              <th>Created</th>
              <th aria-label="Enter" />
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => {
              const god = !mine.has(p.id);
              return (
                <tr key={p.id}>
                  <td style={{ minWidth: 0 }}>
                    <strong>{p.project_name}</strong>
                    <div className="muted small">
                      {p.parent_project_id ? `under ${nameOf.get(p.parent_project_id) ?? "—"}` : (p.address ?? "—")}
                    </div>
                  </td>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>{p.owner_user_id ? userName.get(p.owner_user_id) ?? "—" : "—"}</td>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>{p.status}</td>
                  <td style={{ textAlign: "right" }}>{openCount.get(p.id) ?? 0}</td>
                  <td style={{ textAlign: "right" }}>{memberCount.get(p.id) ?? 0}</td>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>{fmt(p.created_at)}</td>
                  <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                    <Link className={god ? "btn small" : "btn ghost small"} href={`/my/project/${p.id}`}
                      style={god ? { background: "#7a1f2b" } : undefined}>
                      {god ? "⚡ Enter (god mode)" : "Open"}
                    </Link>
                  </td>
                </tr>
              );
            })}
            {projects.length === 0 && (
              <tr><td colSpan={7} className="muted small">No projects yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
