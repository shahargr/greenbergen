import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Membership = {
  role: string;
  projects: { id: string; project_name: string; is_template: boolean } | null;
};

// Financials: per project, what is contracted (payable) against what has
// actually gone out - the same math as the project page's budget bar,
// across everything you manage. Money visibility stays with RLS.
export default async function FinancialsPage() {
  const supabase = await createClient();
  const { data: me } = await supabase.rpc("me");

  const { data: membershipRows } = me?.app_user_id
    ? await supabase
        .from("project_members")
        .select("role, projects(id, project_name, is_template)")
        .eq("app_user_id", me.app_user_id)
        .eq("status", "active")
        .in("role", ["owner", "manager"])
    : { data: [] };
  const pmProjects = (((membershipRows ?? []) as unknown as Membership[]))
    .filter((m) => m.projects && !m.projects.is_template)
    .map((m) => m.projects!)
    .filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i);

  if (pmProjects.length === 0) {
    return (
      <main className="wrap" style={{ paddingTop: 32, maxWidth: 640 }}>
        <p className="muted">Financials are for project managers and above.</p>
        <p><Link href="/my">← Back home</Link></p>
      </main>
    );
  }

  const pmIds = pmProjects.map((p) => p.id);
  const [{ data: contractRows }, { data: paidRows }] = await Promise.all([
    supabase.from("contracts").select("project_id, amount").in("project_id", pmIds).eq("direction", "payable"),
    supabase
      .from("transactions")
      .select("project_id, amount")
      .in("project_id", pmIds)
      .eq("direction", "out")
      .in("status", ["paid", "paid - receipt filed", "paid - pending confirmation", "settled"]),
  ]);

  const contracted = new Map<string, number>();
  for (const c of (contractRows ?? []) as { project_id: string; amount: number | null }[]) {
    contracted.set(c.project_id, (contracted.get(c.project_id) ?? 0) + Number(c.amount ?? 0));
  }
  const paid = new Map<string, number>();
  for (const t of (paidRows ?? []) as { project_id: string | null; amount: number | null }[]) {
    if (!t.project_id) continue;
    paid.set(t.project_id, (paid.get(t.project_id) ?? 0) + Number(t.amount ?? 0));
  }

  const rows = pmProjects
    .map((p) => ({
      ...p,
      contracted: contracted.get(p.id) ?? 0,
      paid: paid.get(p.id) ?? 0,
    }))
    .filter((p) => p.contracted > 0 || p.paid > 0)
    .sort((a, b) => b.contracted - a.contracted);

  const totalContracted = rows.reduce((s, r) => s + r.contracted, 0);
  const totalPaid = rows.reduce((s, r) => s + r.paid, 0);

  return (
    <main className="wrap" style={{ paddingTop: 24, paddingBottom: 96, maxWidth: 640 }}>
      <p className="small" style={{ margin: "0 0 6px" }}><Link href="/my">← Home</Link></p>
      <h1 style={{ fontSize: 26, margin: "0 0 12px" }}>Financials</h1>

      <div className="card" style={{ marginBottom: 14 }}>
        <div className="small" style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <strong>All projects</strong>
          <span className="muted">
            ${Math.round(totalPaid).toLocaleString()} paid of ${Math.round(totalContracted).toLocaleString()} contracted
          </span>
        </div>
        <div className="progressbar">
          <span style={{ width: `${totalContracted > 0 ? Math.min(100, Math.round((totalPaid / totalContracted) * 100)) : 0}%`, background: "#a8842c" }} />
        </div>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {rows.map((p) => {
          const pct = p.contracted > 0 ? Math.min(100, Math.round((p.paid / p.contracted) * 100)) : 0;
          return (
            <Link key={p.id} href={`/my/project/${p.id}`} className="card statlink" style={{ display: "block", padding: "12px 16px" }}>
              <div className="small" style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
                <strong>{p.project_name}</strong>
                <span className="muted">
                  ${Math.round(p.paid).toLocaleString()} of ${Math.round(p.contracted).toLocaleString()} · {pct}%
                  {p.contracted > 0 && <> · ${Math.round(p.contracted - p.paid).toLocaleString()} open</>}
                </span>
              </div>
              <div className="progressbar"><span style={{ width: `${pct}%`, background: "#a8842c" }} /></div>
            </Link>
          );
        })}
        {rows.length === 0 && <p className="muted small">No contracted money on your projects yet.</p>}
      </div>
    </main>
  );
}
